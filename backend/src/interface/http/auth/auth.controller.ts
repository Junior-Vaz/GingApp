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
import { AuthResponse, LoginResponse } from './auth-response.interface';
import { DisableTwoFactorDto, EnableTwoFactorDto, VerifyTwoFactorDto } from './dto/two-factor.dto';
import { TwoFactorService, TwoFactorSetupResult } from './two-factor.service';
import { AuthService } from './auth.service';
import { AcceptTermsDto } from './dto/accept-terms.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { DeleteRequestDto } from './dto/delete-request.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { EmailThrottlerGuard } from '../../../shared/guards/email-throttler.guard';
import {
  FORGOT_ACCEPTED_MESSAGE,
  PasswordResetService,
  RESET_DONE_MESSAGE,
} from '../../../shared/security/password-reset.service';
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

// "Esqueci a senha" (envia e-mail) e consumo do token: limites estritos por IP (5/min e 10/min). Configuráveis por
// env só para os e2e. Por e-mail: EmailThrottlerGuard (3 a cada 10 min).
const FORGOT_THROTTLE = { default: { limit: Number(process.env.FORGOT_THROTTLE_LIMIT ?? 5), ttl: 60_000 } };
const RESET_THROTTLE = { default: { limit: Number(process.env.RESET_THROTTLE_LIMIT ?? 10), ttl: 60_000 } };

// 2FA (setup/enable/disable/verify): adivinhar codigo de 6 digitos e' o ataque; 10/min por IP (e por usuario nas
// rotas autenticadas). Configuravel por env so' para os e2e. Alem disso ha o bloqueio por falhas recentes por usuario.
const TWO_FACTOR_THROTTLE = { default: { limit: Number(process.env.TWO_FACTOR_THROTTLE_LIMIT ?? 10), ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly passwordReset: PasswordResetService,
    private readonly authService: AuthService,
    private readonly accountService: AccountService,
    private readonly exportService: AccountExportService,
    private readonly config: ConfigService,
    private readonly twoFactor: TwoFactorService,
  ) {}

  @Public()
  @UseFilters(JoinedValidationMessageFilter)
  @Throttle(LOGIN_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() dto: LoginDto): Promise<LoginResponse> {
    return this.authService.login(dto);
  }

  @Public()
  @UseFilters(JoinedValidationMessageFilter)
  @Throttle(LOGIN_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('platform-login')
  platformLogin(@Body() dto: PlatformLoginDto, @Req() req: Request): Promise<LoginResponse> {
    this.assertIpAllowed(req);
    return this.authService.platformLogin(dto);
  }

  /**
   * 2o passo do login quando o usuario ativou o 2FA: troca o `challengeToken` (devolvido por login/platform-login) +
   * codigo TOTP ou de recuperacao pelo accessToken normal. Limite estrito por IP; por usuario ha o bloqueio por falhas
   * recentes (TwoFactorService). Codigo errado = 400, excesso de tentativas = 429 (nunca 401).
   */
  @Public()
  @UseFilters(JoinedValidationMessageFilter)
  @Throttle(TWO_FACTOR_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('2fa/verify')
  verifyTwoFactor(@Body() dto: VerifyTwoFactorDto): Promise<AuthResponse> {
    // O desafio da plataforma so' e' emitido depois de platform-login (que ja aplica PLATFORM_ALLOWED_IPS).
    return this.authService.verifyTwoFactor(dto);
  }

  /** Inicia a ativacao do 2FA: segredo novo (pendente) + URI otpauth + QR em data URL. So' aqui o segredo e' devolvido. */
  @UseFilters(JoinedValidationMessageFilter)
  @UseGuards(UserThrottlerGuard)
  @Throttle(TWO_FACTOR_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('2fa/setup')
  setupTwoFactor(@CurrentUser() user: AuthenticatedUser): Promise<TwoFactorSetupResult> {
    return this.twoFactor.setup(user);
  }

  /** Confirma o setup com o codigo do aplicativo, ativa o 2FA e devolve os 8 codigos de recuperacao (unica vez). */
  @UseFilters(JoinedValidationMessageFilter)
  @UseGuards(UserThrottlerGuard)
  @Throttle(TWO_FACTOR_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('2fa/enable')
  enableTwoFactor(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: EnableTwoFactorDto,
  ): Promise<{ recoveryCodes: string[] }> {
    return this.twoFactor.enable(user, dto.code);
  }

  /** Desativa o 2FA: senha + (codigo do aplicativo OU codigo de recuperacao). */
  @UseFilters(JoinedValidationMessageFilter)
  @UseGuards(UserThrottlerGuard)
  @Throttle(TWO_FACTOR_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('2fa/disable')
  disableTwoFactor(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: DisableTwoFactorDto,
  ): Promise<{ twoFactorEnabled: false }> {
    return this.twoFactor.disable(user, dto.password, { code: dto.code, recoveryCode: dto.recoveryCode });
  }

  /** O frontend só mostra "Esqueci minha senha" quando o e-mail transacional (SMTP_*) está habilitado. */
  @Public()
  @Get('capabilities')
  capabilities(): { passwordResetByEmail: boolean } {
    return { passwordResetByEmail: this.passwordReset.isEnabled() };
  }

  /**
   * "Esqueci a senha" (E05): responde SEMPRE 202 com a mesma mensagem, exista ou não o e-mail (o envio roda
   * em segundo plano). Sem SMTP configurado: 503 claro. Limite por IP (@Throttle) E por e-mail (EmailThrottlerGuard).
   */
  @Public()
  @UseFilters(JoinedValidationMessageFilter)
  @UseGuards(EmailThrottlerGuard)
  @Throttle(FORGOT_THROTTLE)
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto): { message: string } {
    this.passwordReset.requestReset(dto.email, dto.organizationSlug);
    return { message: FORGOT_ACCEPTED_MESSAGE };
  }

  /** Consome o token do e-mail e grava a senha nova (revoga sessões, zera mustChangePassword). */
  @Public()
  @UseFilters(JoinedValidationMessageFilter)
  @Throttle(RESET_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<{ message: string }> {
    await this.passwordReset.resetPassword(dto.token, dto.newPassword);
    return { message: RESET_DONE_MESSAGE };
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
