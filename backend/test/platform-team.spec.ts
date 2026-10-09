import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  changesOwnPrivileges,
  leavesNoActiveSuperAdmin,
} from '../src/interface/http/platform-team/platform-team.rules';

/**
 * Regras puras de /platform-team. "Último super admin ativo" não é alcançável por uma sequência
 * normal de chamadas HTTP (o ator é sempre um OUTRO super admin ativo, e ninguém altera a si
 * mesmo), só por corrida — por isso é coberto aqui em unitário e, na corrida real, no e2e
 * platform-team-manage.e2e-spec.ts.
 */
const active = (id: number, isSuperAdmin = true) => ({ id, status: 'ACTIVE', isSuperAdmin });

describe('leavesNoActiveSuperAdmin', () => {
  it('rebaixar ou desativar o ÚNICO super admin ativo => true', () => {
    assert.equal(leavesNoActiveSuperAdmin([1], active(1), { isSuperAdmin: false }), true);
    assert.equal(leavesNoActiveSuperAdmin([1], active(1), { status: 'INACTIVE' }), true);
    assert.equal(leavesNoActiveSuperAdmin([1], active(1), { status: 'INACTIVE', isSuperAdmin: false }), true);
  });

  it('com outro super admin ativo => false', () => {
    assert.equal(leavesNoActiveSuperAdmin([1, 2], active(1), { isSuperAdmin: false }), false);
    assert.equal(leavesNoActiveSuperAdmin([1, 2], active(2), { status: 'INACTIVE' }), false);
  });

  it('mudança que mantém o alvo como super admin ativo => false (inclusive no-op)', () => {
    assert.equal(leavesNoActiveSuperAdmin([1], active(1), {}), false);
    assert.equal(leavesNoActiveSuperAdmin([1], active(1), { status: 'ACTIVE', isSuperAdmin: true }), false);
  });

  it('alvo que já não conta como super admin ativo não muda a contagem', () => {
    assert.equal(leavesNoActiveSuperAdmin([1], active(2, false), { status: 'INACTIVE' }), false);
    assert.equal(leavesNoActiveSuperAdmin([1], { id: 2, status: 'INACTIVE', isSuperAdmin: true }, { isSuperAdmin: false }), false);
  });

  it('lista vazia (estado já inválido) e alvo super ativo sendo rebaixado => true', () => {
    assert.equal(leavesNoActiveSuperAdmin([], active(1), { isSuperAdmin: false }), true);
  });
});

describe('changesOwnPrivileges', () => {
  it('só conta quando o valor realmente muda', () => {
    assert.equal(changesOwnPrivileges(active(1), { status: 'INACTIVE' }), true);
    assert.equal(changesOwnPrivileges(active(1), { isSuperAdmin: false }), true);
    assert.equal(changesOwnPrivileges(active(1), { status: 'ACTIVE', isSuperAdmin: true }), false);
    assert.equal(changesOwnPrivileges(active(1), {}), false);
    assert.equal(changesOwnPrivileges(active(1, false), { isSuperAdmin: true }), true);
  });
});
