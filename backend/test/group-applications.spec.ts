import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApplicantRole, GroupApplicationStatus } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  APPLICANT_ROLE_LABELS,
  DEFAULT_PAINEL_URL,
  groupApplicationsPurgeMode,
  isHoneypotFilled,
  isWellFormedStatusToken,
  painelApplyUrl,
  painelLoginUrl,
  perEmailWindowStart,
  retentionAction,
  toAdminItem,
  toPublicStatus,
} from '../src/interface/http/group-applications/group-application-rules';
import {
  ApproveGroupApplicationDto,
  CreateGroupApplicationDto,
  RejectGroupApplicationDto,
} from '../src/interface/http/group-applications/dto/group-application.dto';
import { AuditAction, AUDIT_ACTION_CODES, AuditEntity } from '../src/shared/audit/audit-actions';
import { renderGroupApplicationApprovedMail, renderGroupApplicationRejectedMail } from '../src/shared/mail/mail-templates';
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

  it('status público: só as 6 chaves do contrato; motivo só em REJECTED, loginUrl só em APPROVED', () => {
    const base = { groupName: 'G', createdAt: NOW, decidedAt: NOW, rejectionReason: 'motivo' };
    const env = { PAINEL_URL: 'https://painel.x.com' };
    const KEYS = ['createdAt', 'decidedAt', 'groupName', 'loginUrl', 'rejectionReason', 'status'];
    for (const status of Object.values(GroupApplicationStatus)) {
      const out = toPublicStatus({ ...base, status, ...({ email: 'x@y.z', passwordHash: 'h', id: 1, internalNote: 'n' } as object) }, env);
      assert.deepEqual(Object.keys(out).sort(), KEYS, status);
      assert.equal(out.rejectionReason, status === 'REJECTED' ? 'motivo' : null, status);
      assert.equal(out.loginUrl, status === 'APPROVED' ? 'https://painel.x.com/login' : null, status);
    }
  });

  it('item do admin: lista FECHADA (hash/token nunca passam, mesmo se vierem na linha) + rótulo do cargo', () => {
    const row = {
      id: 1, status: GroupApplicationStatus.PENDING, applicantName: 'A', email: 'a@b.c', phone: null, claimedRole: ApplicantRole.PROFESSOR,
      groupName: 'G', city: 'C', state: 'SP', estimatedStudents: null, message: null, createdAt: NOW, decidedAt: null,
      rejectionReason: null, internalNote: null, organization: null, passwordHash: '$2b$10$x', statusTokenHash: 'abc', decidedByUserId: 9,
    };
    const item = toAdminItem(row, { id: 9, name: 'Equipe' });
    assert.deepEqual(Object.keys(item).sort(), [
      'applicantName', 'city', 'claimedRole', 'claimedRoleLabel', 'createdAt', 'decidedAt', 'decidedBy', 'email', 'estimatedStudents',
      'groupName', 'id', 'internalNote', 'message', 'organization', 'phone', 'rejectionReason', 'state', 'status',
    ]);
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
    for (const route of ['/api/public/group-applications', '/api/public/group-applications/:token']) {
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
