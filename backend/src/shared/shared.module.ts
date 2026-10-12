import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { PermissionsService } from './access/permissions.service';
import { UnitScopeService } from './access/unit-scope';
import { AuditService } from './audit/audit.service';
import { FeatureAccessService } from './features/feature-access.service';
import { BILLING_GATEWAY_SERVICE } from './billing/billing-gateway.interface';
import { StubBillingGatewayService } from './billing/stub-billing-gateway.service';
import { MAIL_TRANSPORT, MailService } from './mail/mail.service';
import { PasswordResetService } from './security/password-reset.service';
import { FCM_SENDER, PUSH_SENDER, PushService } from './push/push.service';
import { GeocodingService } from './geo/geocoding.service';

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
    PermissionsService,
    UnitScopeService,
    AuditService,
    FeatureAccessService,
    { provide: BILLING_GATEWAY_SERVICE, useClass: StubBillingGatewayService },
    // E-mail transacional opcional (SMTP_* — ver shared/mail). MAIL_TRANSPORT = null em produção; os testes
    // sobrescrevem com um stub em memória (nenhum e-mail real).
    { provide: MAIL_TRANSPORT, useFactory: () => null },
    MailService,
    PasswordResetService,
    // Web Push opcional (VAPID_* — ver shared/push). PUSH_SENDER = null em producao (o remetente real vem das envs);
    // os testes sobrescrevem com um stub em memoria (nenhum push real).
    { provide: PUSH_SENDER, useFactory: () => null },
    // FCM (Firebase Cloud Messaging) opcional, transporte principal do push (FIREBASE_* — ver shared/push/fcm.config).
    // FCM_SENDER = null em producao (o remetente real vem das envs); os testes sobrescrevem com um stub em memoria.
    { provide: FCM_SENDER, useFactory: () => null },
    PushService,
    // Geocodificacao opcional (GOOGLE_MAPS_SERVER_KEY) para o mapa da comunidade — ver shared/geo.
    GeocodingService,
  ],
  exports: [
    PrismaService,
    PermissionsService,
    UnitScopeService,
    AuditService,
    FeatureAccessService,
    BILLING_GATEWAY_SERVICE,
    MailService,
    PasswordResetService,
    PushService,
    GeocodingService,
  ],
})
export class SharedModule {}
