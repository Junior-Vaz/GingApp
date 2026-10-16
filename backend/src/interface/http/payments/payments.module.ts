import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FinanceModule } from '../finance/finance.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StudentsModule } from '../students/students.module';
import { PaymentAccountService } from './payment-account.service';
import { PaymentsConnectionController, PaymentsWebhookController, PixController } from './payments.controller';
import { PaymentsWebhookService } from './payments-webhook.service';
import { PixService } from './pix.service';

/**
 * Cobranca de mensalidade por Pix na conta Mercado Pago DO GRUPO (PLANO_PROJETO.md 10.52): conexao OAuth, Pix, webhook
 * e reconciliacao (PixService.reconcilePending, chamado pelo job PixReconcileCronService). O provedor (PAYMENT_PROVIDER)
 * vem do SharedModule (global). AuthModule: TwoFactorService da reautenticacao do PUT /credentials (10.56, M6).
 */
@Module({
  imports: [AuthModule, FinanceModule, NotificationsModule, StudentsModule],
  controllers: [PaymentsConnectionController, PixController, PaymentsWebhookController],
  providers: [PaymentAccountService, PixService, PaymentsWebhookService],
  exports: [PixService, PaymentAccountService],
})
export class PaymentsModule {}
