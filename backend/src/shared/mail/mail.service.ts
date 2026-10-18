import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { readSmtpConfig } from './mail.config';
import {
  RegistrationNoticeKind,
  renderInviteMail,
  renderPasswordResetMail,
  renderRegistrationNoticeMail,
  renderTransferApprovalMail,
  RenderedMail,
} from './mail-templates';

/** Mensagem pronta para o transporte. */
export interface MailEnvelope {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Transporte de e-mail. O `Transporter` do nodemailer já satisfaz esta interface; os testes injetam um stub
 * (token MAIL_TRANSPORT) que só guarda as mensagens em memória — nenhum e-mail real sai da suíte.
 */
export interface MailTransport {
  sendMail(message: MailEnvelope): Promise<unknown>;
}

/** Token de injeção do transporte de teste/stub. Em produção vale `null` e o SMTP vem das envs SMTP_*. */
export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

/** Remetente usado quando há transporte injetado mas SMTP_FROM não está configurado (testes). */
const FALLBACK_FROM = 'GingApp <nao-responder@gingapp.invalid>';

/**
 * SSOT do envio de e-mail transacional (E05). Opcional: sem SMTP configurado (e sem transporte injetado)
 * `isEnabled()` é false, nada é enviado e o restante do sistema funciona como sempre.
 *
 * Regras de segurança:
 *  - NUNCA loga destinatário, assunto, corpo nem link (contêm dados pessoais e o token de redefinição);
 *    só o nome do modelo e o código técnico do erro;
 *  - as funções `send*` NUNCA lançam: devolvem false em falha — o chamador decide o que fazer sem vazar
 *    nenhum detalhe do SMTP para o cliente HTTP.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private smtpTransport: MailTransport | null = null;
  private smtpKey: string | null = null;

  constructor(@Optional() @Inject(MAIL_TRANSPORT) private readonly injected: MailTransport | null = null) {}

  /** true quando há SMTP configurado (SMTP_HOST + remetente) ou um transporte injetado. */
  isEnabled(): boolean {
    return this.injected !== null || readSmtpConfig() !== null;
  }

  sendPasswordReset(input: { to: string; name: string; link: string; expiresInMinutes: number }): Promise<boolean> {
    return this.deliver('password-reset', input.to, renderPasswordResetMail(input));
  }

  sendInvite(input: { to: string; name: string; groupName: string; link: string; expiresInHours: number }): Promise<boolean> {
    return this.deliver('invite', input.to, renderInviteMail(input));
  }

  sendTransferApproval(input: { to: string; name: string; groupName: string; link: string; expiresInDays: number }): Promise<boolean> {
    return this.deliver('transfer-approval', input.to, renderTransferApprovalMail(input));
  }

  sendRegistrationNotice(input: {
    to: string;
    notice: RegistrationNoticeKind;
    formTitle: string;
    protocol: string;
    link: string;
  }): Promise<boolean> {
    return this.deliver('registration-notice', input.to, renderRegistrationNoticeMail(input));
  }

  private async deliver(template: string, to: string, mail: RenderedMail): Promise<boolean> {
    try {
      const config = readSmtpConfig();
      const transport = this.injected ?? this.getSmtpTransport();
      if (!transport) return false;
      await transport.sendMail({
        from: config?.from ?? FALLBACK_FROM,
        to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      });
      return true;
    } catch (error) {
      // Só o nome do modelo e o código técnico (ex.: ECONNREFUSED, EAUTH): a mensagem do nodemailer pode
      // conter o endereço do destinatário ou do servidor.
      const code = (error as { code?: unknown } | null)?.code;
      this.logger.warn(`Falha ao enviar e-mail "${template}"${typeof code === 'string' ? ` (${code})` : ''}.`);
      return false;
    }
  }

  /** Transporte nodemailer criado sob demanda e reaproveitado enquanto a configuração não muda. */
  private getSmtpTransport(): MailTransport | null {
    const config = readSmtpConfig();
    if (!config) return null;
    const key = `${config.host}|${config.port}|${config.secure}|${config.user ?? ''}|${config.pass ?? ''}`;
    if (!this.smtpTransport || this.smtpKey !== key) {
      this.smtpTransport = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: config.user ? { user: config.user, pass: config.pass ?? '' } : undefined,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      });
      this.smtpKey = key;
    }
    return this.smtpTransport;
  }
}
