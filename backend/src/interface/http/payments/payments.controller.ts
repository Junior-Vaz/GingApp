import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { Public } from '../../../shared/decorators/public.decorator';
import { RequireFeature } from '../../../shared/decorators/require-feature.decorator';
import { MestreOnlyGuard } from '../../../shared/guards/mestre-only.guard';
import { UserThrottlerGuard } from '../../../shared/guards/user-throttler.guard';
import { PaymentAccountService } from './payment-account.service';
import { PaymentsWebhookService } from './payments-webhook.service';
import { PixService } from './pix.service';

// Gerar Pix chama o provedor: 10/min por usuario (e por IP, pelo guard global). Consultar: 60/min. Ajustaveis por env.
const PIX_CREATE_THROTTLE = { default: { limit: Number(process.env.PIX_THROTTLE_LIMIT ?? 10), ttl: 60_000 } };
const PIX_READ_THROTTLE = { default: { limit: Number(process.env.PIX_READ_THROTTLE_LIMIT ?? 60), ttl: 60_000 } };
// Callback do OAuth (publico): poucos acessos legitimos.
const CALLBACK_THROTTLE = { default: { limit: Number(process.env.PAYMENTS_CALLBACK_THROTTLE_LIMIT ?? 30), ttl: 60_000 } };
// Webhook (publico, IPs do Mercado Pago compartilhados por todos os grupos): limite proprio, mais alto que o global.
const WEBHOOK_THROTTLE = { default: { limit: Number(process.env.WEBHOOK_THROTTLE_LIMIT ?? 1200), ttl: 60_000 } };

/**
 * Conexao da conta Mercado Pago DO GRUPO (OAuth do vendedor) - so o MESTRE (PLANO_PROJETO.md 10.52).
 * O callback e PUBLICO (o navegador volta do Mercado Pago sem o nosso JWT): a seguranca vem do `state` assinado.
 */
@Controller('payments/mercadopago')
export class PaymentsConnectionController {
  constructor(
    private readonly accounts: PaymentAccountService,
    private readonly pix: PixService,
  ) {}

  @Get('status')
  @RequireFeature('finance')
  @UseGuards(MestreOnlyGuard)
  status(@CurrentOrganization() organizationId: number) {
    return this.accounts.status(organizationId);
  }

  @Post('connect')
  @RequireFeature('finance')
  @UseGuards(MestreOnlyGuard)
  @HttpCode(HttpStatus.OK)
  connect(@CurrentOrganization() organizationId: number, @CurrentUser('id') userId: number) {
    return this.accounts.connectUrl(organizationId, userId);
  }

  /** Volta do Mercado Pago: 302 para `${PAINEL_URL}/financeiro?mp=ok|erro`. Query lida sem DTO (o provedor pode
   * acrescentar parametros; so `code` e `state` importam). */
  @Public()
  @Get('callback')
  @Throttle(CALLBACK_THROTTLE)
  async callback(@Query() query: Record<string, unknown>, @Res() res: Response): Promise<void> {
    res.redirect(302, await this.accounts.handleCallback(query ?? {}));
  }

  @Delete('disconnect')
  @RequireFeature('finance')
  @UseGuards(MestreOnlyGuard)
  async disconnect(@CurrentOrganization() organizationId: number, @CurrentUser('id') userId: number) {
    // Antes de apagar os tokens: cancela no provedor (best-effort) os Pix ainda pagaveis - depois nao haveria como.
    const openPix = await this.pix.cancelOpenPixOfOrganization(organizationId);
    return this.accounts.disconnect(organizationId, userId, openPix);
  }
}

/**
 * Pix de mensalidade (PLANO_PROJETO.md 10.52). Gestao: mesmo RBAC do financeiro (recurso `finance`: so o MESTRE).
 * "Meu": sem @CanAccess, escopado por construcao ao aluno do proprio usuario ou dependente (mesma regra de /finance/me).
 * Rotas com 2-3 segmentos: nao colidem com `GET /finance/:id` nem com `GET /finance/me`.
 */
@RequireFeature('finance')
@Controller('finance')
export class PixController {
  constructor(private readonly pix: PixService) {}

  @Post('me/:id/pix')
  @UseGuards(UserThrottlerGuard)
  @Throttle(PIX_CREATE_THROTTLE)
  @HttpCode(HttpStatus.OK)
  generateMine(
    @CurrentOrganization() organizationId: number,
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.pix.generateForSelf(organizationId, userId, id);
  }

  @Get('me/:id/pix')
  @UseGuards(UserThrottlerGuard)
  @Throttle(PIX_READ_THROTTLE)
  getMine(
    @CurrentOrganization() organizationId: number,
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.pix.getForSelf(organizationId, userId, id);
  }

  @Post(':id/pix')
  @CanAccess('finance', 'edit')
  @UseGuards(UserThrottlerGuard)
  @Throttle(PIX_CREATE_THROTTLE)
  @HttpCode(HttpStatus.OK)
  generate(
    @CurrentOrganization() organizationId: number,
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.pix.generateForStaff(organizationId, id, userId);
  }

  @Get(':id/pix')
  @CanAccess('finance', 'view')
  @UseGuards(UserThrottlerGuard)
  @Throttle(PIX_READ_THROTTLE)
  get(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number) {
    return this.pix.getForStaff(organizationId, id);
  }
}

/** Webhook do Mercado Pago: PUBLICO (sem JWT), autenticado pela assinatura x-signature. Corpo/query lidos sem DTO. */
@Controller('webhooks')
export class PaymentsWebhookController {
  constructor(private readonly webhook: PaymentsWebhookService) {}

  @Public()
  @Post('mercadopago')
  @Throttle(WEBHOOK_THROTTLE)
  @HttpCode(HttpStatus.OK)
  receive(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query() query: Record<string, unknown>,
    @Body() body: unknown,
  ) {
    return this.webhook.handle({ headers, query: query ?? {}, body });
  }
}
