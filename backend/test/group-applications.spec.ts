import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApplicantRole, EmailVerification, GroupApplicationStatus } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  adminApplicationsUrl,
  APPLICANT_ROLE_LABELS,
  DEFAULT_ADMIN_URL,
  DEFAULT_PAINEL_URL,
  groupApplicationsPurgeMode,
  isHoneypotFilled,
  isWellFormedStatusToken,
  MAX_VERIFY_SENDS,
  normalizeInstagram,
  OPEN_STATUSES,
  painelApplyUrl,
  painelConfirmUrl,
  painelLoginUrl,
  parseNotifyEmails,
  perEmailWindowStart,
  resendBlock,
  resendState,
  retentionAction,
  toAdminItem,
  toPublicStatus,
  verifyExpiresAt,
} from '../src/interface/http/group-applications/group-application-rules';
import { superAdminPasswordDiagnostics } from '../prisma/bootstrap';
import {
  ApproveGroupApplicationDto,
  CreateGroupApplicationDto,
  RejectGroupApplicationDto,
} from '../src/interface/http/group-applications/dto/group-application.dto';
import { AuditAction, AUDIT_ACTION_CODES, AuditEntity } from '../src/shared/audit/audit-actions';
import {
  renderGroupApplicationApprovedMail,
  renderGroupApplicationRejectedMail,
  renderGroupApplicationTeamNoticeMail,
  renderGroupApplicationVerifyMail,
} from '../src/shared/mail/mail-templates';
import { buildRequestLogLine } from '../src/shared/observability/request-log.middleware';
import { generatePasswordToken } from '../src/shared/security/password-reset-token';

/** Regras PURAS da adesao de grupos (docs/CONTRATO_ADESAO_GRUPOS.md). O comportamento HTTP esta em group-applications.e2e-spec.ts. */
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-08T12:00:00.000Z');
const ago = (days: number, extraMs = 0) => new Date(NOW.getTime() - days * DAY - extraMs);

const validBody = () => ({
  applicantName: 'Maria da Silva',
  email: 'Maria@Example.com',
  phone: '(62) 99999-0000',
  password: 'uma senha longa 123',
  claimedRole: 'CONTRAMESTRE',
  groupName: 'Grupo Ginga Teste',
  city: 'Goiânia',
  state: 'go',
  estimatedStudents: 40,
  message: 'Somos um núcleo pequeno.',
  acceptTerms: true,
  adult: true,
});

const errorsOf = async (cls: new () => object, body: Record<string, unknown>) => {
  const errors = await validate(plainToInstance(cls, body) as object, { whitelist: true, forbidNonWhitelisted: true });
  return errors.map((e) => e.property);
};

describe('Adesão de grupos: DTO do pedido público (contrato 3)', () => {
  it('pedido válido passa; e-mail em minúsculas, UF em maiúsculas, textos aparados', async () => {
    const dto = plainToInstance(CreateGroupApplicationDto, { ...validBody(), applicantName: '  Maria  ' });
    assert.deepEqual(await validate(dto, { whitelist: true, forbidNonWhitelisted: true }), []);
    assert.equal(dto.email, 'maria@example.com');
    assert.equal(dto.state, 'GO');
    assert.equal(dto.applicantName, 'Maria');
  });

  it('cada campo inválido gera 400 no próprio campo (mensagens em português, sem o valor recebido)', async () => {
    const cases: Array<[string, unknown]> = [
      ['applicantName', 'M'],
      ['applicantName', 'x'.repeat(121)],
      ['email', 'nao-e-email'],
      ['email', `${'a'.repeat(250)}@x.com`],
      ['phone', 'abc'],
      ['password', 'curta'],
      ['password', 'Dev@12345 mais longa'],
      ['password', 'ç'.repeat(40)],
      ['claimedRole', 'SUPER_ADMIN'],
      ['groupName', 'G'],
      ['city', 'G'],
      ['city', 'x'.repeat(81)],
      ['state', 'XX'],
      ['state', 'SPP'],
      ['estimatedStudents', -1],
      ['estimatedStudents', 100001],
      ['estimatedStudents', 1.5],
      ['estimatedStudents', '10'],
      ['message', 'x'.repeat(501)],
      ['acceptTerms', false],
      ['acceptTerms', 'true'],
      ['adult', false],
    ];
    for (const [field, value] of cases) {
      const errs = await errorsOf(CreateGroupApplicationDto, { ...validBody(), [field]: value });
      assert.deepEqual(errs, [field], `${field}=${JSON.stringify(value)} -> ${errs.join(',')}`);
    }
    // obrigatorios ausentes
    for (const field of ['applicantName', 'email', 'password', 'claimedRole', 'groupName', 'city', 'state', 'acceptTerms', 'adult']) {
      const body: Record<string, unknown> = validBody();
      delete body[field];
      assert.deepEqual(await errorsOf(CreateGroupApplicationDto, body), [field], field);
    }
    // corpo vazio e campo extra
    assert.ok((await errorsOf(CreateGroupApplicationDto, {})).length >= 9);
    assert.deepEqual(await errorsOf(CreateGroupApplicationDto, { ...validBody(), isSuperAdmin: true }), ['isSuperAdmin']);
    // as mensagens nunca ecoam a senha
    const errs = await validate(plainToInstance(CreateGroupApplicationDto, { ...validBody(), password: 'SENHA-x' }));
    assert.ok(!JSON.stringify(errs.map((e) => e.constraints)).includes('SENHA-x'));
  });

  it('opcionais: telefone, alunos, mensagem e honeypot podem faltar; texto vazio vira ausente', async () => {
    const body: Record<string, unknown> = validBody();
    delete body.phone;
    delete body.estimatedStudents;
    delete body.message;
    assert.deepEqual(await errorsOf(CreateGroupApplicationDto, body), []);
    const dto = plainToInstance(CreateGroupApplicationDto, { ...validBody(), phone: '  ', message: '' });
    assert.deepEqual(await validate(dto), []);
    assert.equal(dto.phone, undefined);
    assert.equal(dto.message, undefined);
    assert.deepEqual(await errorsOf(CreateGroupApplicationDto, { ...validBody(), website: 'http://spam' }), []);
  });

  it('aprovar: slug opcional no formato do POST /organizations; rejeitar: motivo obrigatório 3..300', async () => {
    assert.deepEqual(await errorsOf(ApproveGroupApplicationDto, {}), []);
    assert.deepEqual(await errorsOf(ApproveGroupApplicationDto, { slug: 'grupo-ok', internalNote: 'ok' }), []);
    assert.deepEqual(await errorsOf(ApproveGroupApplicationDto, { slug: 'Grupo Ruim' }), ['slug']);
    assert.deepEqual(await errorsOf(ApproveGroupApplicationDto, { internalNote: 'x'.repeat(501) }), ['internalNote']);
    assert.deepEqual(await errorsOf(RejectGroupApplicationDto, {}), ['reason']);
    assert.deepEqual(await errorsOf(RejectGroupApplicationDto, { reason: '  a ' }), ['reason']);
    assert.deepEqual(await errorsOf(RejectGroupApplicationDto, { reason: 'x'.repeat(301) }), ['reason']);
    assert.deepEqual(await errorsOf(RejectGroupApplicationDto, { reason: 'Faltou informar a cidade.' }), []);
  });
});

describe('Adesão de grupos: regras puras', () => {
  it('rótulos cobrem exatamente o enum ApplicantRole', () => {
    assert.deepEqual(Object.keys(APPLICANT_ROLE_LABELS).sort(), Object.values(ApplicantRole).sort());
  });

  it('token: 43 caracteres base64url (o gerado SSOT passa; qualquer outra coisa não)', () => {
    const { token, tokenHash } = generatePasswordToken();
    assert.ok(isWellFormedStatusToken(token));
    assert.equal(tokenHash.length, 64);
    assert.notEqual(tokenHash, token);
    for (const bad of ['', 'abc', `${token}x`, token.slice(1), `${token.slice(0, 42)}=`, `${token.slice(0, 42)}/`, `../${token.slice(3)}`]) {
      assert.equal(isWellFormedStatusToken(bad), false, bad);
    }
    assert.equal(isWellFormedStatusToken(undefined), false);
  });

  it('honeypot: só texto não vazio conta', () => {
    assert.equal(isHoneypotFilled(undefined), false);
    assert.equal(isHoneypotFilled(''), false);
    assert.equal(isHoneypotFilled('   '), false);
    assert.equal(isHoneypotFilled('x'), true);
  });

  it('janela de 30 dias por e-mail', () => {
    assert.equal(perEmailWindowStart(NOW).getTime(), NOW.getTime() - 30 * DAY);
  });

  it('retenção: PENDING > 60 dias expira; REJECTED/EXPIRED > 90 e APPROVED > 180 são apagados (limites exatos)', () => {
    const P = GroupApplicationStatus.PENDING;
    assert.equal(retentionAction({ status: P, createdAt: ago(60), decidedAt: null }, NOW), 'keep');
    assert.equal(retentionAction({ status: P, createdAt: ago(60, 1), decidedAt: null }, NOW), 'expire');
    for (const s of [GroupApplicationStatus.REJECTED, GroupApplicationStatus.EXPIRED]) {
      assert.equal(retentionAction({ status: s, createdAt: ago(400), decidedAt: ago(90) }, NOW), 'keep', s);
      assert.equal(retentionAction({ status: s, createdAt: ago(400), decidedAt: ago(90, 1) }, NOW), 'delete', s);
      assert.equal(retentionAction({ status: s, createdAt: ago(91), decidedAt: null }, NOW), 'delete', `${s} sem decidedAt usa createdAt`);
    }
    const A = GroupApplicationStatus.APPROVED;
    assert.equal(retentionAction({ status: A, createdAt: ago(400), decidedAt: ago(180) }, NOW), 'keep');
    assert.equal(retentionAction({ status: A, createdAt: ago(400), decidedAt: ago(180, 1) }, NOW), 'delete');
    assert.equal(retentionAction({ status: A, createdAt: ago(400), decidedAt: ago(100) }, NOW), 'keep', 'aprovado: 180, não 90');
  });

  it('GROUP_APPLICATIONS_PURGE: dry-run é o PADRÃO; true/false como FORMS_RETENTION_PURGE', () => {
    assert.equal(groupApplicationsPurgeMode({}), 'dry-run');
    assert.equal(groupApplicationsPurgeMode({ GROUP_APPLICATIONS_PURGE: '' }), 'dry-run');
    assert.equal(groupApplicationsPurgeMode({ GROUP_APPLICATIONS_PURGE: 'qualquer' }), 'dry-run');
    assert.equal(groupApplicationsPurgeMode({ GROUP_APPLICATIONS_PURGE: 'dry-run' }), 'dry-run');
    assert.equal(groupApplicationsPurgeMode({ GROUP_APPLICATIONS_PURGE: ' TRUE ' }), 'on');
    assert.equal(groupApplicationsPurgeMode({ GROUP_APPLICATIONS_PURGE: 'false' }), 'off');
  });

  it('links do painel: PAINEL_URL (env existente) sem barra final; ausente/inválida = padrão https seguro', () => {
    assert.equal(painelLoginUrl({ PAINEL_URL: 'https://painel.x.com/' }), 'https://painel.x.com/login');
    assert.equal(painelApplyUrl({ PAINEL_URL: 'https://painel.x.com' }), 'https://painel.x.com/comecar');
    assert.equal(painelLoginUrl({}), `${DEFAULT_PAINEL_URL}/login`);
    assert.equal(painelLoginUrl({ PAINEL_URL: 'javascript:alert(1)' }), `${DEFAULT_PAINEL_URL}/login`);
    assert.ok(DEFAULT_PAINEL_URL.startsWith('https://'));
  });

  it('status público: só as chaves do contrato (+ emailVerification; canResend/resendAvailableAt só em UNVERIFIED); motivo só em REJECTED, loginUrl só em APPROVED', () => {
    const base = { groupName: 'G', createdAt: NOW, decidedAt: NOW, rejectionReason: 'motivo', emailVerification: EmailVerification.VERIFIED };
    const env = { PAINEL_URL: 'https://painel.x.com' };
    const KEYS = ['createdAt', 'decidedAt', 'emailVerification', 'groupName', 'loginUrl', 'rejectionReason', 'status'];
    const leaks = { email: 'x@y.z', passwordHash: 'h', id: 1, internalNote: 'n', instagram: 'meugrupo', verifyTokenHash: 'v', statusTokenHash: 's' };
    for (const status of Object.values(GroupApplicationStatus)) {
      const out = toPublicStatus({ ...base, status, ...(leaks as object) }, env, { now: NOW });
      const expected = status === 'UNVERIFIED' ? [...KEYS, 'canResend', 'resendAvailableAt'].sort() : KEYS;
      assert.deepEqual(Object.keys(out).sort(), expected, status);
      assert.equal(out.rejectionReason, status === 'REJECTED' ? 'motivo' : null, status);
      assert.equal(out.loginUrl, status === 'APPROVED' ? 'https://painel.x.com/login' : null, status);
      assert.ok(!JSON.stringify(out).includes('meugrupo'), 'instagram nunca no público');
    }
  });

  it('item do admin: lista FECHADA (hash/token nunca passam, mesmo se vierem na linha) + rótulo do cargo', () => {
    const row = {
      id: 1, status: GroupApplicationStatus.PENDING, applicantName: 'A', email: 'a@b.c', phone: null, claimedRole: ApplicantRole.PROFESSOR,
      groupName: 'G', city: 'C', state: 'SP', estimatedStudents: null, message: null, createdAt: NOW, decidedAt: null,
      rejectionReason: null, internalNote: null, organization: null, passwordHash: '$2b$10$x', statusTokenHash: 'abc', decidedByUserId: 9,
      emailVerification: EmailVerification.SKIPPED, emailVerifiedAt: null, instagram: 'meugrupo', verifyTokenHash: 'vth',
    };
    const item = toAdminItem(row, { id: 9, name: 'Equipe' });
    assert.deepEqual(Object.keys(item).sort(), [
      'applicantName', 'city', 'claimedRole', 'claimedRoleLabel', 'createdAt', 'decidedAt', 'decidedBy', 'email', 'emailVerification',
      'emailVerifiedAt', 'estimatedStudents', 'groupName', 'id', 'instagram', 'internalNote', 'message', 'organization', 'phone',
      'rejectionReason', 'state', 'status',
    ]);
    assert.equal(item.instagram, 'meugrupo');
    assert.equal(item.emailVerification, 'SKIPPED');
    assert.ok(!JSON.stringify(item).includes('vth'));
    assert.equal(item.claimedRoleLabel, 'Professor(a)');
    assert.deepEqual(item.decidedBy, { id: 9, name: 'Equipe' });
  });
});

describe('Adesão de grupos: auditoria, log e e-mails', () => {
  it('ações e entidade novas no catálogo SSOT', () => {
    assert.ok(AUDIT_ACTION_CODES.includes(AuditAction.GROUP_APPLICATION_APPROVE));
    assert.ok(AUDIT_ACTION_CODES.includes(AuditAction.GROUP_APPLICATION_REJECT));
    assert.equal(AuditEntity.GROUP_APPLICATION, 'group_application');
  });

  it('rotas públicas de adesão saem no log SEM userId e SEM ip; as da plataforma seguem normais', () => {
    const req = (route: string) => ({ method: 'POST', baseUrl: '', route: { path: route }, ip: '198.51.100.9', user: { id: 7 } });
    for (const route of [
      '/api/public/group-applications',
      '/api/public/group-applications/:token',
      '/api/public/group-applications/confirm',
      '/api/public/group-applications/:token/resend',
    ]) {
      const line = buildRequestLogLine(req(route) as never, { statusCode: 201 } as never, 'rid-123456', 1);
      assert.deepEqual([line.userId, line.ip], [null, null], route);
    }
    for (const route of ['/api/platform-group-applications', '/api/public/group-applications-x', '/api/public/forms/:slug']) {
      const line = buildRequestLogLine(req(route) as never, { statusCode: 200 } as never, 'rid-123456', 1);
      assert.equal(line.ip, '198.51.100.9', route);
    }
  });

  it('e-mails: aprovado só com o link (sem senha), rejeitado com o motivo escapado; nenhum texto do solicitante', () => {
    const ok = renderGroupApplicationApprovedMail({ link: 'https://painel.x.com/login' });
    assert.equal(ok.subject, 'Seu grupo foi aprovado - GingApp');
    assert.ok(ok.text.includes('https://painel.x.com/login'));
    assert.ok(!/senha:\s*\S/i.test(ok.text), 'nenhuma senha no e-mail');
    const no = renderGroupApplicationRejectedMail({ reason: 'Faltou <b>cidade</b>', link: 'https://painel.x.com/comecar' });
    assert.ok(no.text.includes('Motivo: Faltou <b>cidade</b>'));
    assert.ok(no.html.includes('Faltou &lt;b&gt;cidade&lt;/b&gt;'));
    assert.ok(!no.html.includes('<b>cidade'));
  });
});

// ---------------------------------------------------------------------------------------------------------------
// docs/CONTRATO_ADESAO_GRUPOS_EMAIL.md (confirmacao do e-mail, aviso a equipe, Instagram, diagnostico do bootstrap)
// ---------------------------------------------------------------------------------------------------------------

describe('Adesão de grupos: Instagram (contrato de e-mail 7)', () => {
  it('normaliza TODAS as formas aceitas para o handle puro, minúsculo e sem @', () => {
    const accepted: Array<[string, string]> = [
      ['@meugrupo', 'meugrupo'],
      ['meugrupo', 'meugrupo'],
      ['MeuGrupo', 'meugrupo'],
      ['@Meu.Grupo_10', 'meu.grupo_10'],
      ['  @meugrupo  ', 'meugrupo'],
      ['instagram.com/meugrupo', 'meugrupo'],
      ['instagram.com/meugrupo/', 'meugrupo'],
      ['www.instagram.com/meugrupo', 'meugrupo'],
      ['Instagram.com/MeuGrupo', 'meugrupo'],
      ['instagr.am/meugrupo', 'meugrupo'],
      ['https://www.instagram.com/meugrupo/?igsh=MTIzNDU2Nzg=', 'meugrupo'],
      ['https://instagram.com/meugrupo', 'meugrupo'],
      ['http://instagram.com/meugrupo/', 'meugrupo'],
      ['https://www.instagram.com/meugrupo#bio', 'meugrupo'],
      ['https://www.instagram.com/meugrupo///', 'meugrupo'],
      ['HTTPS://WWW.INSTAGRAM.COM/MEUGRUPO/', 'meugrupo'],
      ['https://instagr.am/meu_grupo', 'meu_grupo'],
      ['https://www.instagram.com:443/meugrupo', 'meugrupo'],
      [`@${'a'.repeat(30)}`, 'a'.repeat(30)],
      ['@.meugrupo', '.meugrupo'],
    ];
    for (const [raw, handle] of accepted) assert.equal(normalizeInstagram(raw), handle, raw);
  });

  it('rejeita domínio estranho, javascript:, espaços, handle longo, caracteres estranhos e caminhos que não são perfil', () => {
    const rejected = [
      'https://evil.com/meugrupo',
      'evil.com/meugrupo',
      'https://instagram.com.evil.com/meugrupo',
      'https://evil.com/instagram.com/meugrupo',
      'https://notinstagram.com/meugrupo',
      'https://m.instagram.com/meugrupo',
      'javascript:alert(1)',
      'JavaScript:alert(document.cookie)',
      'data:text/html,<b>x</b>',
      'ftp://instagram.com/meugrupo',
      '//instagram.com/meugrupo',
      'meu grupo',
      '@meu grupo',
      'https://www.instagram.com/meu grupo',
      'meu\tgrupo',
      'meu\ngrupo',
      'Grupo de capoeira do bairro',
      'a'.repeat(31),
      `@${'a'.repeat(31)}`,
      'meu..grupo',
      'meugrupo.',
      '@meugrupo.',
      'meu-grupo',
      'meugrupo!',
      'meugrupó',
      '@',
      '@@meugrupo',
      '<script>',
      'https://www.instagram.com/',
      'https://www.instagram.com',
      'https://www.instagram.com/p/C0d3x/',
      'https://www.instagram.com/meugrupo/reels',
      'https://user:pass@instagram.com/meugrupo',
      'https://evil.com@instagram.com/meugrupo',
      'https://instagram.com:8080/meugrupo',
      'https://instagram.com/../meugrupo',
      'https://instagram.com/x/../meugrupo',
      'https://instagram.com/./meugrupo',
      'https://instagram.com\\meugrupo',
      'https://instagram.com/meu%67rupo',
      `https://instagram.com/${'a'.repeat(200)}`,
    ];
    for (const raw of rejected) assert.equal(normalizeInstagram(raw), undefined, raw);
    assert.equal(normalizeInstagram(42), undefined);
    assert.equal(normalizeInstagram({}), undefined);
  });

  it('opcional: ausente, null, vazio ou só espaços = null', () => {
    for (const raw of [undefined, null, '', '   ']) assert.equal(normalizeInstagram(raw), null, String(raw));
  });

  it('DTO: grava só o handle normalizado; inválido = erro no campo com a mensagem única do contrato; vazio = ausente', async () => {
    const ok = plainToInstance(CreateGroupApplicationDto, { ...validBody(), instagram: 'https://www.instagram.com/MeuGrupo/?igsh=x' });
    assert.deepEqual(await validate(ok, { whitelist: true, forbidNonWhitelisted: true }), []);
    assert.equal(ok.instagram, 'meugrupo');
    const empty = plainToInstance(CreateGroupApplicationDto, { ...validBody(), instagram: '  ' });
    assert.deepEqual(await validate(empty), []);
    assert.equal(empty.instagram, undefined);
    for (const bad of ['https://evil.com/x', 'javascript:alert(1)', 'meu grupo', 'a'.repeat(31), 5]) {
      const errs = await validate(plainToInstance(CreateGroupApplicationDto, { ...validBody(), instagram: bad }));
      assert.deepEqual(errs.map((e) => e.property), ['instagram'], String(bad));
      assert.ok(Object.values(errs[0].constraints ?? {}).every((m) => m === 'Informe o Instagram como @usuario ou o link do perfil.'), String(bad));
    }
  });
});

describe('Adesão de grupos: confirmação do e-mail e aviso à equipe (contrato de e-mail 1 e 2)', () => {
  const MIN = 60 * 1000;

  it('reenvio: 3 envios por pedido (contando o 1º) e 1 a cada 5 min; resendAvailableAt só quando há espera', () => {
    assert.equal(MAX_VERIFY_SENDS, 3);
    assert.deepEqual(resendState({ verifySentAt: new Date(NOW.getTime() - 4 * MIN), verifySentCount: 1 }, NOW, true), {
      canResend: false,
      resendAvailableAt: new Date(NOW.getTime() + 1 * MIN),
    });
    assert.deepEqual(resendState({ verifySentAt: new Date(NOW.getTime() - 5 * MIN), verifySentCount: 2 }, NOW, true), { canResend: true, resendAvailableAt: null });
    assert.deepEqual(resendState({ verifySentAt: new Date(NOW.getTime() - 60 * MIN), verifySentCount: 3 }, NOW, true), { canResend: false, resendAvailableAt: null });
    assert.deepEqual(resendState({ verifySentAt: null, verifySentCount: 0 }, NOW, true), { canResend: true, resendAvailableAt: null });
    assert.deepEqual(resendState({ verifySentAt: null, verifySentCount: 0 }, NOW, false), { canResend: false, resendAvailableAt: null }, 'e-mail desligado');
    assert.equal(resendBlock({ verifySentAt: new Date(NOW.getTime() - 60 * MIN), verifySentCount: 3 }, NOW), 'LIMIT');
    assert.equal(resendBlock({ verifySentAt: new Date(NOW.getTime() - 1 * MIN), verifySentCount: 1 }, NOW), 'COOLDOWN');
    assert.equal(resendBlock({ verifySentAt: new Date(NOW.getTime() - 6 * MIN), verifySentCount: 1 }, NOW), null);
  });

  it('link vale 24 h; UNVERIFIED expira em 3 dias (limite exato); PENDING segue em 60', () => {
    assert.equal(verifyExpiresAt(NOW).getTime(), NOW.getTime() + 24 * 60 * MIN);
    const U = GroupApplicationStatus.UNVERIFIED;
    assert.equal(retentionAction({ status: U, createdAt: ago(3), decidedAt: null }, NOW), 'keep');
    assert.equal(retentionAction({ status: U, createdAt: ago(3, 1), decidedAt: null }, NOW), 'expire');
    assert.equal(retentionAction({ status: GroupApplicationStatus.PENDING, createdAt: ago(4), decidedAt: null }, NOW), 'keep');
  });

  it('GROUP_APPLICATIONS_NOTIFY_EMAILS: vírgula/ponto e vírgula, aparado, minúsculo, sem duplicata, ignora o que não é e-mail', () => {
    assert.deepEqual(parseNotifyEmails({}), []);
    assert.deepEqual(parseNotifyEmails({ GROUP_APPLICATIONS_NOTIFY_EMAILS: '  ' }), []);
    assert.deepEqual(
      parseNotifyEmails({ GROUP_APPLICATIONS_NOTIFY_EMAILS: ' Equipe@GingApp.com.br , ops@x.com;equipe@gingapp.com.br, nao-e-email, ' }),
      ['equipe@gingapp.com.br', 'ops@x.com'],
    );
  });

  it('links: confirmação em <PAINEL_URL>/comecar/confirmar/<token>; aviso em <ADMIN_URL>/pedidos-de-adesao (padrão https seguro)', () => {
    assert.equal(painelConfirmUrl('tok_-123', { PAINEL_URL: 'https://painel.x.com/' }), 'https://painel.x.com/comecar/confirmar/tok_-123');
    assert.equal(adminApplicationsUrl({ ADMIN_URL: 'https://admin.x.com/' }), 'https://admin.x.com/pedidos-de-adesao');
    assert.equal(adminApplicationsUrl({ ADMIN_URL: 'javascript:alert(1)' }), `${DEFAULT_ADMIN_URL}/pedidos-de-adesao`);
    assert.ok(DEFAULT_ADMIN_URL.startsWith('https://'));
  });

  it('e-mails novos com TEXTO FIXO: confirmação só com o link (nunca senha); aviso à equipe sem nenhum dado do solicitante', () => {
    const v = renderGroupApplicationVerifyMail({ link: 'https://painel.x.com/comecar/confirmar/abc', expiresInHours: 24 });
    assert.ok(v.text.includes('Confirme seu e-mail para o pedido de cadastro do grupo no GingApp'));
    assert.ok(v.text.includes('https://painel.x.com/comecar/confirmar/abc'));
    assert.ok(v.text.includes('24 horas'));
    assert.ok(!/senha/i.test(v.text), 'confirmação não fala de senha');
    const t = renderGroupApplicationTeamNoticeMail({ link: 'https://admin.x.com/pedidos-de-adesao' });
    assert.ok(t.text.includes('Há um novo pedido de adesão aguardando análise'));
    assert.ok(t.text.includes('https://admin.x.com/pedidos-de-adesao'));
    // as duas funções só recebem o link (+ validade): não há como passar nome, grupo, cidade, e-mail ou Instagram
    assert.equal(renderGroupApplicationVerifyMail.length, 1);
    assert.equal(renderGroupApplicationTeamNoticeMail.length, 1);
  });

  it('pedidos "em aberto" (1 por e-mail, exigem o hash da senha) = UNVERIFIED + PENDING', () => {
    assert.deepEqual([...OPEN_STATUSES].sort(), ['PENDING', 'UNVERIFIED']);
  });
});

describe('Bootstrap: diagnóstico da senha (contrato de e-mail 3)', () => {
  it('loga tamanho em caracteres e bytes, avisa sobre "$" e NUNCA inclui a senha', () => {
    const plain = 'Boot-Strap#2026xQ';
    const d1 = superAdminPasswordDiagnostics(plain);
    assert.match(d1.info.join(' '), /17 caractere\(s\) \/ 17 byte\(s\)/);
    assert.deepEqual(d1.warn, []);
    const withDollar = 'Pa$$wordé-Forte#1';
    const d2 = superAdminPasswordDiagnostics(withDollar);
    assert.match(d2.info.join(' '), /17 caractere\(s\) \/ 18 byte\(s\)/);
    assert.equal(d2.warn.length, 1);
    assert.match(d2.warn[0], /Docker Compose\/Easypanel/);
    assert.match(d2.warn[0], /"\$\$"/);
    for (const line of [...d1.info, ...d1.warn, ...d2.info, ...d2.warn]) {
      assert.ok(!line.includes(plain) && !line.includes(withDollar) && !line.includes('Pa$$'), line);
    }
  });
});
