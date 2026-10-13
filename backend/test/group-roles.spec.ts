import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { shouldRunGroupRolesBackfill } from '../prisma/group-roles-backfill';
import {
  ACCESS_ROLE_BASE_RANK,
  DEFAULT_GROUP_ROLES,
  defaultRankFor,
  normalizeRoleName,
  ranksForOrder,
  rolesPayload,
  slugifyRoleName,
  sortBadges,
  suggestedGroupRoles,
} from '../src/interface/http/roles/group-roles';
import { principalRole } from '../src/interface/http/roles/staff-roles';

/** Cargos DO GRUPO (docs/FICHA_UNICA.md secao 13): regras puras. */
describe('cargos do grupo - regras puras', () => {
  it('4 cargos padrao: ranks/perfis coerentes com a base e iguais aos da migration', () => {
    assert.deepEqual(DEFAULT_GROUP_ROLES.map((d) => [d.slug, d.accessRole, d.rank]), [
      ['mestre', 'MESTRE', 40],
      ['professor', 'PROFESSOR', 30],
      ['instrutor', 'INSTRUTOR', 20],
      ['monitor', 'MONITOR', 10],
    ]);
    for (const d of DEFAULT_GROUP_ROLES) assert.equal(ACCESS_ROLE_BASE_RANK[d.accessRole], d.rank);
    const sql = readFileSync(join(__dirname, '../prisma/migrations/20261015000000_group_roles/migration.sql'), 'utf8');
    for (const d of DEFAULT_GROUP_ROLES) assert.ok(sql.includes(`('${d.name}', '${d.slug}', '${d.accessRole}', ${d.rank}, '${d.color}', '${d.icon}')`), d.slug);
  });

  it('nome: 2-30 caracteres, espacos colapsados; slug kebab sem acento', () => {
    assert.equal(normalizeRoleName('  Contra   mestre '), 'Contra mestre');
    assert.equal(normalizeRoleName('A'), null);
    assert.equal(normalizeRoleName('x'.repeat(31)), null);
    assert.equal(normalizeRoleName(12), null);
    assert.equal(slugifyRoleName('Contramestre'), 'contramestre');
    assert.equal(slugifyRoleName('Formado Ação!'), 'formado-acao');
    assert.equal(slugifyRoleName('!!!'), 'cargo');
  });

  it('rank padrao: acima do maior do mesmo perfil, ou a base do perfil; reorder = n*10..10', () => {
    const existing = DEFAULT_GROUP_ROLES.map((d) => ({ accessRole: d.accessRole, rank: d.rank }));
    assert.equal(defaultRankFor('PROFESSOR', existing), 31);
    assert.equal(defaultRankFor('INSTRUTOR', []), 20);
    assert.deepEqual([...ranksForOrder([7, 3, 9])], [[7, 30], [3, 20], [9, 10]]);
  });

  it('selo principal = maior rank; acesso efetivo = maior perfil (Contramestre PROFESSOR 35 + Formado INSTRUTOR 25)', () => {
    const contramestre = { id: 5, name: 'Contramestre', slug: 'contramestre', color: '#B91C1C', icon: 'medal', accessRole: 'PROFESSOR' as const, rank: 35 };
    const formado = { id: 6, name: 'Formado', slug: 'formado', color: null, icon: null, accessRole: 'INSTRUTOR' as const, rank: 25 };
    const monitor = { id: 4, name: 'Monitor', slug: 'monitor', color: null, icon: null, accessRole: 'MONITOR' as const, rank: 10 };
    const payload = rolesPayload([monitor, formado, contramestre, formado]);
    assert.deepEqual(payload.roleKeys, ['contramestre', 'formado', 'monitor']);
    assert.equal(payload.roles[0]!.name, 'Contramestre');
    assert.equal(principalRole(payload.roles.map((r) => r.accessRole), { hasStudent: true, isGuardian: false }), 'PROFESSOR');
    assert.deepEqual(sortBadges([{ id: 2, rank: 10 }, { id: 1, rank: 10 }, { id: 3, rank: 50 }]).map((b) => b.id), [3, 1, 2]);
  });

  it('sugestoes: regra atingida, cargo ativo e rank maior que o maior cargo que a pessoa ja tem', () => {
    const g = (id: number, rank: number, active = true) => ({ id, rank, active });
    const rules = [
      { minLevelOrder: 2, groupRole: g(1, 10) },
      { minLevelOrder: 4, groupRole: g(2, 25) },
      { minLevelOrder: 4, groupRole: g(3, 30, false) },
    ];
    assert.deepEqual(suggestedGroupRoles(1, rules, []), []);
    assert.deepEqual(suggestedGroupRoles(5, rules, []).map((r) => r.id), [2, 1]);
    assert.deepEqual(suggestedGroupRoles(5, rules, [10]).map((r) => r.id), [2]);
    assert.deepEqual(suggestedGroupRoles(5, rules, [30]), []);
  });

  it('backfill no boot: flag GROUP_ROLES_BACKFILL', () => {
    assert.equal(shouldRunGroupRolesBackfill('auto', {}, 0), false);
    assert.equal(shouldRunGroupRolesBackfill('auto', {}, 3), true);
    assert.equal(shouldRunGroupRolesBackfill('auto', { GROUP_ROLES_BACKFILL: 'false' }, 3), false);
    assert.equal(shouldRunGroupRolesBackfill('auto', { GROUP_ROLES_BACKFILL: 'true' }, 0), true);
    assert.equal(shouldRunGroupRolesBackfill('manual', {}, 0), true);
    assert.equal(shouldRunGroupRolesBackfill('manual', { GROUP_ROLES_BACKFILL: 'false' }, 5), false);
  });
});
