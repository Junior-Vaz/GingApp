import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { BILLING_GATEWAY_SERVICE } from './billing/billing-gateway.interface';
import { StubBillingGatewayService } from './billing/stub-billing-gateway.service';

/**
 * Módulo global (padrão GestorPrint): disponibiliza o PrismaService para todos os módulos
 * de domínio sem precisar reimportar em cada um. Guards/decorators desse diretório não
 * precisam ser providers aqui — são registrados onde são usados (AppModule para o guard
 * global, cada controller para os decorators de parâmetro).
 *
 * BILLING_GATEWAY_SERVICE: injeta StubBillingGatewayService por trás do token da interface
 * (ver shared/billing/billing-gateway.interface.ts) — trocar de gateway no futuro é só mudar
 * este "useClass", nenhum consumidor (SubscriptionsService) referencia a classe concreta.
 */
@Global()
@Module({
  providers: [
    PrismaService,
    { provide: BILLING_GATEWAY_SERVICE, useClass: StubBillingGatewayService },
  ],
  exports: [PrismaService, BILLING_GATEWAY_SERVICE],
})
export class SharedModule {}
