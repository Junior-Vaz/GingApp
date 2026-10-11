import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { Public } from '../../../shared/decorators/public.decorator';
import { JoinedValidationMessageFilter } from '../../../shared/filters/joined-validation-message.filter';
import { UserThrottlerGuard } from '../../../shared/guards/user-throttler.guard';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { AllowDuringGate } from '../../../shared/decorators/allow-during-gate.decorator';
import { TermsStatus } from '../../../shared/legal/legal-types';
import { AccountExportService } from './account-export.service';
import { AccountService, DeletionRequestView, MeResponse } from './account.service';
import { AuthResponse } from './auth-response.interface';
import { AuthService } from './auth.service';
import { AcceptTermsDto } from './dto/accept-terms.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { DeleteRequestDto } from './dto/delete-request.dto';
import { LoginDto } from './dto/login.dto';
import { PlatformLoginDto } from './dto/platform-login.dto';

// Configurável via env para permitir um limite mais alto em testes e2e (que fazem vários
// logins reais em sequência) sem afetar o padrão de produção (5/min).
const LOGIN_THROTTLE_LIMIT = Number(process.env.LOGIN_THROTTLE_LIMIT ?? 5);
const LOGIN_THROTTLE = { default: { limit: LOGIN_THROTTLE_LIMIT, ttl: 60_000 } };

// Trocar a própria senha é raro e é o ponto de um adivinhador com token roubado: 5/min (por IP e por
// usuário). Configurável por env só para os e2e (mesmo padrão de LOGIN_THROTTLE_LIMIT).
export const CHANGE_PASSWORD_THROTTLE_LIMIT = Number(process.env.CHANGE_PASSWORD_THROTTLE_LIMIT ?? 5);
const CHANGE_PASSWORD_THROTTLE = { default: { limit: CHANGE_PASSWORD_THROTTLE_LIMIT, ttl: 60_000 } };

// Exportar os proprios dados / pedir exclusao sao acoes raras e mais caras que uma consulta: 10/min por IP.
const EXPORT_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly accountService: AccountService,
    private readonly exportService: AccountExportService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @UseFilters(JoinedValidationMessageFilter)
  @Throttle(LOGIN_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() dto: LoginDto): Promise<AuthResponse> {
    return this.authService.login(dto);
  }

  @Public()
  @UseFilters(JoinedValidationMessageFilter)
  @Throttle(LOGIN_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('platform-login')
  platformLogin(@Body() dto: PlatformLoginDto, @Req() req: Request): Promise<AuthResponse> {
    this.assertIpAllowed(req);
    return this.authService.platformLogin(dto);
  }

  /**
   * Troca da PRÓPRIA senha (qualquer usuário autenticado, MEMBER ou PLATFORM). Senha atual errada = 400
   * (nunca 401: os frontends tratam 401 como sessão expirada). Revoga todas as outras sessões e devolve
   * um accessToken novo. Limite estrito por IP (ThrottlerGuard global) E por usuário (UserThrottlerGuard,
   * depois da autenticação): ambos usam o @Throttle abaixo.
   */
  @AllowDuringGate('mustChangePassword', 'terms')
  @UseGuards(UserThrottlerGuard)
  @Throttle(CHANGE_PASSWORD_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('change-password')
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<{ accessToken: string }> {
    return this.authService.changePassword(user, dto);
  }

  /**
   * Perfil da PRÓPRIA conta + estado do aceite dos Termos/Política (E10). Liberada mesmo com senha provisória
   * pendente e/ou aceite pendente: é como o frontend descobre o que ainda precisa fazer.
   */
  @AllowDuringGate('mustChangePassword', 'terms')
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): Promise<MeResponse> {
    return this.accountService.me(user);
  }

  /** Aceite da versão vigente dos Termos de Uso + Política de Privacidade (GET /legal -> version). */
  @AllowDuringGate('terms')
  @HttpCode(HttpStatus.OK)
  @Post('accept-terms')
  acceptTerms(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AcceptTermsDto,
    @Req() req: Request,
  ): Promise<TermsStatus> {
    return this.accountService.acceptTerms(user, dto.version, req.ip);
  }

  /** Direito de acesso/portabilidade (LGPD): JSON com todos os dados do próprio usuário. */
  @AllowDuringGate('terms')
  @Throttle(EXPORT_THROTTLE)
  @Header('Content-Disposition', 'attachment; filename="gingapp-meus-dados.json"')
  @Get('me/export')
  exportMyData(@CurrentUser() user: AuthenticatedUser): Promise<Record<string, unknown>> {
    return this.exportService.export(user);
  }

  /** Direito de eliminação/anonimização (LGPD): REGISTRA o pedido; nada é apagado automaticamente. */
  @AllowDuringGate('terms')
  @Throttle(EXPORT_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('me/delete-request')
  requestDeletion(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: DeleteRequestDto,
    @Req() req: Request,
  ): Promise<DeletionRequestView> {
    return this.accountService.requestDeletion(user, dto.reason, req.ip);
  }

  /**
   * Allowlist de IP opcional para platform-login (PLANO_PROJETO.md §3.1), ativada apenas
   * quando PLATFORM_ALLOWED_IPS está definida no ambiente (lista separada por vírgula).
   */
  private assertIpAllowed(req: Request): void {
    const allowedIps = this.config.get<string>('PLATFORM_ALLOWED_IPS');
    if (!allowedIps) {
      return;
    }

    const allowList = allowedIps
      .split(',')
      .map((ip) => ip.trim())
      .filter(Boolean);

    if (allowList.length === 0) {
      return;
    }

    const requestIp = req.ip ?? req.socket.remoteAddress ?? '';
    if (!allowList.includes(requestIp)) {
      throw new ForbiddenException('IP não autorizado para acesso à plataforma.');
    }
  }
}
