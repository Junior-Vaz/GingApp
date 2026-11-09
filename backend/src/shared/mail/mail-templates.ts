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

/**
 * Aviso da inscricao em formulario publico (F1): so protocolo, titulo do formulario (do Mestre, escapado) e situacao.
 * NUNCA texto digitado pelo inscrito (nem o nome): o envio e anonimo e o e-mail informado pode ser de outra pessoa, entao
 * o aviso nao pode virar canal de mensagem do atacante para a caixa de terceiros. Saudacao fixa.
 */
export type RegistrationNoticeKind = 'RECEIVED' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED' | 'WAITLIST';

export function renderRegistrationNoticeMail(input: {
  notice: RegistrationNoticeKind;
  formTitle: string;
  protocol: string;
  link: string;
}): RenderedMail {
  const hello = 'Olá!';
  const situation: Record<RegistrationNoticeKind, string> = {
    RECEIVED: 'Recebemos a sua inscrição. Guarde o número do protocolo para consultar a situação.',
    CONFIRMED: 'A sua inscrição foi confirmada.',
    REJECTED: 'A sua inscrição não foi aceita pelo organizador. Em caso de dúvida, fale com ele.',
    CANCELLED: 'A sua inscrição foi cancelada.',
    WAITLIST: 'A sua inscrição está na lista de espera. Você será avisado se uma vaga abrir.',
  };
  const line = `Inscrição ${input.protocol} em "${input.formTitle}".`;
  const text = situation[input.notice];
  const footer = 'Este é um aviso automático do GingApp. Não responda este e-mail. Se você não fez esta inscrição, ignore esta mensagem.';
  return {
    subject: `Inscrição ${input.protocol} - ${input.formTitle}`,
    text: [hello, '', line, text, '', 'Consulte a situação em:', input.link, '', footer].join('\n'),
    html: layout('Inscrição', [escapeHtml(hello), escapeHtml(line), escapeHtml(text)], input.link, 'Consultar inscrição', footer),
  };
}

/**
 * Decisao do pedido de adesao de grupo (docs/CONTRATO_ADESAO_GRUPOS.md 3). O e-mail do pedido NAO foi verificado (pode ser
 * de outra pessoa), entao NENHUM texto digitado pelo solicitante entra aqui (nem o nome nem o nome do grupo): saudacao fixa.
 * Aprovado: so o link do painel (NUNCA a senha: a pessoa entra com a senha que escolheu no pedido). Nao aprovado: o motivo
 * escrito pela EQUIPE da plataforma (escapado no HTML) e o link para acompanhar/fazer novo pedido.
 */
export function renderGroupApplicationApprovedMail(input: { link: string }): RenderedMail {
  const hello = 'Olá!';
  const intro = 'Seu grupo foi aprovado pela equipe do GingApp. A conta de administrador do grupo já está pronta.';
  const how = 'Entre no painel com o e-mail do pedido e a senha que você escolheu ao fazer o pedido. Lá, siga o passo a passo "Primeiros passos".';
  const footer = 'Se você não fez este pedido, ignore este e-mail ou responda para a equipe do GingApp.';
  return {
    subject: 'Seu grupo foi aprovado - GingApp',
    text: [hello, '', intro, how, '', 'Acesse o painel:', input.link, '', footer].join('\n'),
    html: layout('Seu grupo foi aprovado', [escapeHtml(hello), escapeHtml(intro), escapeHtml(how)], input.link, 'Entrar no painel', footer),
  };
}

export function renderGroupApplicationRejectedMail(input: { reason: string; link: string }): RenderedMail {
  const hello = 'Olá!';
  const intro = 'A equipe do GingApp analisou o seu pedido de cadastro de grupo e ele não foi aprovado.';
  const reason = `Motivo: ${input.reason}`;
  const again = 'Se quiser, você pode corrigir o que foi apontado e fazer um novo pedido.';
  const footer = 'Se você não fez este pedido, ignore este e-mail.';
  return {
    subject: 'Pedido de cadastro de grupo não aprovado - GingApp',
    text: [hello, '', intro, reason, again, '', input.link, '', footer].join('\n'),
    html: layout('Pedido não aprovado', [escapeHtml(hello), escapeHtml(intro), escapeHtml(reason), escapeHtml(again)], input.link, 'Fazer novo pedido', footer),
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
