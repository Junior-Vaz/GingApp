import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { frontendBaseUrl, readSmtpConfig } from '../src/shared/mail/mail.config';
import { renderInviteMail, renderPasswordResetMail } from '../src/shared/mail/mail-templates';
import { MailService, MailEnvelope } from '../src/shared/mail/mail.service';
import { generatePasswordToken, hashPasswordToken } from '../src/shared/security/password-reset-token';

/** Regras puras do e-mail transacional (E05) — sem banco e sem rede. Nenhum e-mail é enviado. */
describe('E-mail transacional (unidade)', () => {
  it('SMTP só liga com host + remetente; porta 587 por padrão, 465 com SMTP_SECURE=true', () => {
    assert.equal(readSmtpConfig({}), null);
    assert.equal(readSmtpConfig({ SMTP_HOST: 'smtp.x.com' }), null); // sem remetente
    const basic = readSmtpConfig({ SMTP_HOST: 'smtp.x.com', SMTP_FROM: 'GingApp <a@x.com>' });
    assert.deepEqual(basic, { host: 'smtp.x.com', port: 587, secure: false, user: undefined, pass: undefined, from: 'GingApp <a@x.com>' });
    const secure = readSmtpConfig({ SMTP_HOST: 'smtp.x.com', SMTP_SECURE: 'true', SMTP_USER: 'a@x.com', SMTP_PASS: 'p' });
    assert.equal(secure?.port, 465);
    assert.equal(secure?.from, 'a@x.com'); // cai para SMTP_USER
  });

  it('URLs dos frontends: sem barra final; inválida ou não http(s) = null', () => {
    assert.equal(frontendBaseUrl('APP', { APP_URL: 'https://app.x.com/' }), 'https://app.x.com');
    assert.equal(frontendBaseUrl('PAINEL', {}), null);
    assert.equal(frontendBaseUrl('ADMIN', { ADMIN_URL: 'javascript:alert(1)' }), null);
  });

  it('modelos em pt-BR (texto + HTML) escapam nome e grupo', () => {
    const reset = renderPasswordResetMail({ name: '<b>Ana</b> Silva', link: 'https://app.x.com/redefinir-senha?token=abc', expiresInMinutes: 60 });
    assert.match(reset.subject, /Redefinição de senha/);
    assert.ok(reset.text.includes('https://app.x.com/redefinir-senha?token=abc'));
    assert.ok(!reset.html.includes('<b>Ana</b>'));
    assert.ok(reset.html.includes('&lt;b&gt;Ana&lt;/b&gt;'));
    const invite = renderInviteMail({ name: 'Ana', groupName: 'Grupo "X" & Cia', link: 'https://app.x.com/l', expiresInHours: 72 });
    assert.ok(invite.html.includes('Grupo &quot;X&quot; &amp; Cia'));
    assert.ok(invite.text.includes('72 horas'));
  });

  it('token: 256 bits aleatórios, só o SHA-256 é guardado e é reproduzível', () => {
    const a = generatePasswordToken();
    const b = generatePasswordToken();
    assert.notEqual(a.token, b.token);
    assert.equal(a.token.length, 43);
    assert.equal(a.tokenHash, hashPasswordToken(a.token));
    assert.notEqual(a.tokenHash, a.token);
  });

  it('MailService: transporte injetado envia; falha devolve false e não lança; sem nada configurado fica desligado', async () => {
    const sent: MailEnvelope[] = [];
    let fail = false;
    const service = new MailService({
      sendMail: async (m) => {
        if (fail) throw Object.assign(new Error('boom a@b.com'), { code: 'ECONNREFUSED' });
        sent.push(m);
      },
    });
    assert.equal(service.isEnabled(), true);
    const input = { to: 'a@b.com', name: 'Ana', link: 'https://x/redefinir-senha?token=t', expiresInMinutes: 60 };
    assert.equal(await service.sendPasswordReset(input), true);
    assert.equal(sent.length, 1);
    fail = true;
    assert.equal(await service.sendPasswordReset(input), false);

    const off = new MailService(null);
    const previous = process.env.SMTP_HOST;
    process.env.SMTP_HOST = '';
    try {
      assert.equal(off.isEnabled(), false);
      assert.equal(await off.sendPasswordReset(input), false);
    } finally {
      process.env.SMTP_HOST = previous;
    }
  });
});
