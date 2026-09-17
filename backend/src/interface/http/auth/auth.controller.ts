import { Body, Controller, ForbiddenException, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { Public } from '../../../shared/decorators/public.decorator';
import { AuthResponse } from './auth-response.interface';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { PlatformLoginDto } from './dto/platform-login.dto';

// Configurável via env para permitir um limite mais alto em testes e2e (que fazem vários
// logins reais em sequência) sem afetar o padrão de produção (5/min).
const LOGIN_THROTTLE_LIMIT = Number(process.env.LOGIN_THROTTLE_LIMIT ?? 5);
const LOGIN_THROTTLE = { default: { limit: LOGIN_THROTTLE_LIMIT, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Throttle(LOGIN_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() dto: LoginDto): Promise<AuthResponse> {
    return this.authService.login(dto);
  }

  @Public()
  @Throttle(LOGIN_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('platform-login')
  platformLogin(@Body() dto: PlatformLoginDto, @Req() req: Request): Promise<AuthResponse> {
    this.assertIpAllowed(req);
    return this.authService.platformLogin(dto);
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
