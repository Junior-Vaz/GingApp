import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AuditService, sanitizeAuditMeta } from '../src/shared/audit/audit.service';
import { AuditAction, AUDIT_ACTION_CODES } from '../src/shared/audit/audit-actions';

/** Regras puras da trilha de auditoria — sem banco. O comportamento HTTP está em audit-logs.e2e-spec.ts. */
describe('AuditService (unitário)', () => {
  it('nunca lança: falha do banco vira log e a ação de negócio segue', async () => {
    const prisma = { auditLog: { create: async () => Promise.reject(new Error('banco fora')) } };
    const service = new AuditService(prisma as never);
    await assert.doesNotReject(() => service.record({ action: AuditAction.UNIT_CREATE, entity: 'unit', entityId: 1 }));
  });

  it('grava entity/entityId/meta/ip nas colunas certas e converte o id para texto', async () => {
    let data: Record<string, unknown> | undefined;
    const prisma = { auditLog: { create: async (args: { data: Record<string, unknown> }) => { data = args.data; } } };
    await new AuditService(prisma as never).record({
      organizationId: 7,
      userId: 9,
      action: AuditAction.FINANCE_PAY,
      entity: 'finance',
      entityId: 42,
      meta: { paidCents: 100 },
      ip: '10.0.0.1',
    });
    assert.deepEqual(
      { ...data, metadata: JSON.parse(JSON.stringify(data?.metadata)) },
      {
        organizationId: 7,
        userId: 9,
        action: 'FINANCE_PAY',
        resource: 'finance',
        resourceId: '42',
        metadata: { paidCents: 100 },
        ipAddress: '10.0.0.1',
      },
    );
  });

  it('remove chaves de senha/token/hash em qualquer nível do meta', () => {
    const clean = sanitizeAuditMeta({
      ok: 1,
      password: 'x',
      newPassword: 'y',
      nested: { passwordHash: 'h', accessToken: 't', fine: 'sim', list: [{ senha: 's', keep: true }] },
    });
    assert.deepEqual(clean, { ok: 1, nested: { fine: 'sim', list: [{ keep: true }] } });
  });

  it('o catálogo de ações não tem códigos repetidos', () => {
    assert.equal(new Set(AUDIT_ACTION_CODES).size, AUDIT_ACTION_CODES.length);
  });
});
