/**
 * Modelos dos e-mails transacionais (pt-BR): texto puro + HTML simples (sem imagens externas, sem script).
 * Todo valor vindo de usuário (nome, grupo) é escapado no HTML. Funções puras, testáveis em isolamento.
 */

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || '';
}

function layout(title: string, paragraphs: string[], link: string, buttonLabel: string, footer: string): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px">${p}</p>`).join('');
  const safeLink = escapeHtml(link);
  return (
    `<!doctype html><html lang="pt-BR"><body style="margin:0;padding:24px;background:#f4f1ea;font-family:Arial,Helvetica,sans-serif;color:#1f2933">` +
    `<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:8px;padding:28px">` +
    `<h1 style="margin:0 0 18px;font-size:20px">${escapeHtml(title)}</h1>` +
    body +
    `<p style="margin:22px 0"><a href="${safeLink}" style="background:#b4531a;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block">${escapeHtml(buttonLabel)}</a></p>` +
    `<p style="margin:0 0 14px;font-size:13px;color:#52606d">Se o botão não funcionar, copie e cole este endereço no navegador:<br><span style="word-break:break-all">${safeLink}</span></p>` +
    `<p style="margin:0;font-size:12px;color:#7b8794">${escapeHtml(footer)}</p>` +
    `</div></body></html>`
  );
}

function greeting(name: string): string {
  const first = firstName(name);
  return first ? `Olá, ${first}!` : 'Olá!';
}

export function renderPasswordResetMail(input: { name: string; link: string; expiresInMinutes: number }): RenderedMail {
  const hello = greeting(input.name);
  const validity = `Este link vale por ${input.expiresInMinutes} minutos e só pode ser usado uma vez.`;
  const ignore = 'Se você não pediu a redefinição, ignore este e-mail: sua senha continua a mesma.';
  return {
    subject: 'Redefinição de senha - GingApp',
    text: [
      hello,
      '',
      'Recebemos um pedido para redefinir a senha da sua conta no GingApp.',
      'Para criar uma nova senha, acesse o link abaixo:',
      input.link,
      '',
      validity,
      ignore,
    ].join('\n'),
    html: layout(
      'Redefinição de senha',
      [escapeHtml(hello), 'Recebemos um pedido para redefinir a senha da sua conta no GingApp.', escapeHtml(validity)],
      input.link,
      'Criar nova senha',
      ignore,
    ),
  };
}

export function renderTransferApprovalMail(input: {
  name: string;
  groupName: string;
  link: string;
  expiresInDays: number;
}): RenderedMail {
  const hello = greeting(input.name);
  const intro = `O grupo ${input.groupName} pediu a sua transferência para lá no GingApp. Se você aprovar, a sua frequência, graduações e certificados passam a ser vistos por esse grupo, e a sua matrícula atual será encerrada.`;
  const validity = `Este link vale por até ${input.expiresInDays} dias e só pode ser usado uma vez.`;
  const ignore = 'Se você não reconhece este pedido, ignore este e-mail: nada será alterado.';
  return {
    subject: `Pedido de transferência - ${input.groupName} (GingApp)`,
    text: [hello, '', intro, 'Para ver os detalhes e aprovar ou recusar, acesse o link abaixo:', input.link, '', validity, ignore].join('\n'),
    html: layout(
      'Pedido de transferência',
      [escapeHtml(hello), escapeHtml(intro), escapeHtml(validity)],
      input.link,
      'Ver o pedido',
      ignore,
    ),
  };
}

export function renderInviteMail(input: {
  name: string;
  groupName: string;
  link: string;
  expiresInHours: number;
}): RenderedMail {
  const hello = greeting(input.name);
  const intro = `Você foi convidado(a) para acessar o grupo ${input.groupName} no GingApp.`;
  const validity = `Este link vale por ${input.expiresInHours} horas e só pode ser usado uma vez.`;
  const ignore = 'Se você não esperava este convite, ignore este e-mail.';
  return {
    subject: `Convite de acesso - ${input.groupName} (GingApp)`,
    text: [hello, '', intro, 'Para definir a sua senha e entrar, acesse o link abaixo:', input.link, '', validity, ignore].join(
      '\n',
    ),
    html: layout(
      'Convite de acesso',
      [escapeHtml(hello), escapeHtml(intro), escapeHtml(validity)],
      input.link,
      'Definir minha senha',
      ignore,
    ),
  };
}
