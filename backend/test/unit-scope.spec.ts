import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  assertUnitAccess,
  assertUnitOwned,
  assertUnitTarget,
  assertUnitUpdate,
  groupWideOrUnitFilter,
  isRestricted,
  lessonScopeFilter,
  resolveWriteUnit,
  scopeAllows,
  scopeOwns,
  UnitScope,
  UnitScopeService,
  unitScopeFilter,
} from '../src/shared/access/unit-scope';

/** Regras puras do escopo por unidade (E08) — sem banco. O comportamento HTTP está em unit-scope.e2e-spec.ts. */
const ALL: UnitScope = 'ALL';
const A_ONLY: UnitScope = [10];
const A_AND_B: UnitScope = [10, 20];

describe('unit-scope: regras puras', () => {
  it('isRestricted: só lista de unidades restringe', () => {
    assert.equal(isRestricted(ALL), false);
    assert.equal(isRestricted(A_ONLY), true);
  });

  it('scopeAllows: ALL permite tudo (inclusive sem unidade); restrito só as unidades da lista', () => {
    assert.equal(scopeAllows(ALL, null), true);
    assert.equal(scopeAllows(ALL, 99), true);
    assert.equal(scopeAllows(A_ONLY, 10), true);
    assert.equal(scopeAllows(A_ONLY, 20), false);
    assert.equal(scopeAllows(A_ONLY, null), true, 'registro sem unidade (legado) segue visível ao professor restrito');
    assert.equal(scopeAllows(A_ONLY, undefined), true);
  });

  it('scopeOwns: estrito — só unidade do escopo conta; sem unidade NÃO conta (evento/comunicado do grupo inteiro)', () => {
    assert.equal(scopeOwns(ALL, null), true);
    assert.equal(scopeOwns(A_ONLY, 10), true);
    assert.equal(scopeOwns(A_ONLY, 20), false);
    assert.equal(scopeOwns(A_ONLY, null), false);
  });

  it('unitScopeFilter: {} sem restrição; sem unidade OU uma das unidades com restrição', () => {
    assert.deepEqual(unitScopeFilter(ALL), {});
    assert.deepEqual(unitScopeFilter(A_AND_B), { OR: [{ unitId: null }, { unitId: { in: [10, 20] } }] });
  });

  it('lessonScopeFilter: unidade efetiva = a da aula ou, se nula, a da turma', () => {
    assert.deepEqual(lessonScopeFilter(ALL), {});
    assert.deepEqual(lessonScopeFilter(A_ONLY), {
      OR: [{ unitId: { in: [10] } }, { unitId: null, class: { OR: [{ unitId: null }, { unitId: { in: [10] } }] } }],
    });
  });

  it('groupWideOrUnitFilter: eventos/comunicados sem unidade (grupo inteiro) continuam legíveis', () => {
    assert.deepEqual(groupWideOrUnitFilter(ALL), {});
    assert.deepEqual(groupWideOrUnitFilter(A_ONLY), { OR: [{ unitId: null }, { unitId: { in: [10] } }] });
  });

  it('assertUnitAccess: registro fora do escopo = 404 com a mensagem do inexistente', () => {
    assert.doesNotThrow(() => assertUnitAccess(ALL, 99, 'x'));
    assert.doesNotThrow(() => assertUnitAccess(A_ONLY, 10, 'x'));
    assert.throws(() => assertUnitAccess(A_ONLY, 20, 'Aluno não encontrado.'), (e: unknown) => {
      assert.ok(e instanceof NotFoundException);
      assert.equal(e.message, 'Aluno não encontrado.');
      return true;
    });
    assert.doesNotThrow(() => assertUnitAccess(A_ONLY, null, 'x'));
  });

  it('assertUnitTarget: unidade de destino fora do escopo = 403', () => {
    assert.doesNotThrow(() => assertUnitTarget(ALL, null));
    assert.doesNotThrow(() => assertUnitTarget(A_AND_B, 20));
    assert.throws(() => assertUnitTarget(A_ONLY, 20), ForbiddenException);
  });

  it('assertUnitOwned: alterar registro do grupo inteiro (sem unidade) é 403 para o restrito', () => {
    assert.doesNotThrow(() => assertUnitOwned(ALL, null));
    assert.doesNotThrow(() => assertUnitOwned(A_ONLY, 10));
    assert.throws(() => assertUnitOwned(A_ONLY, null), ForbiddenException);
    assert.throws(() => assertUnitOwned(A_ONLY, 20), ForbiddenException);
  });

  it('resolveWriteUnit: sem restrição repassa; restrito assume a única unidade, exige escolha se várias, 403 fora do escopo', () => {
    assert.equal(resolveWriteUnit(ALL, undefined), undefined);
    assert.equal(resolveWriteUnit(ALL, null), undefined);
    assert.equal(resolveWriteUnit(ALL, 77), 77);
    assert.equal(resolveWriteUnit(A_ONLY, undefined), 10);
    assert.equal(resolveWriteUnit(A_ONLY, null), 10);
    assert.equal(resolveWriteUnit(A_AND_B, 20), 20);
    assert.throws(() => resolveWriteUnit(A_AND_B, undefined), BadRequestException);
    assert.throws(() => resolveWriteUnit(A_AND_B, 30), ForbiddenException);
  });

  it('assertUnitUpdate: undefined = não mexe; restrito não move para fora do escopo nem limpa a unidade', () => {
    assert.doesNotThrow(() => assertUnitUpdate(A_ONLY, undefined));
    assert.doesNotThrow(() => assertUnitUpdate(ALL, null));
    assert.doesNotThrow(() => assertUnitUpdate(A_AND_B, 20));
    assert.throws(() => assertUnitUpdate(A_ONLY, 20), ForbiddenException);
    assert.throws(() => assertUnitUpdate(A_ONLY, null), ForbiddenException);
  });
});

describe('UnitScopeService.resolve: quem fica restrito', () => {
  /** PrismaService falso: só UserUnitAccess.findMany, com as linhas dadas; conta as consultas. */
  function service(rows: number[]) {
    let queries = 0;
    const prisma = {
      userUnitAccess: {
        findMany: async () => {
          queries += 1;
          return rows.map((unitId) => ({ unitId }));
        },
      },
    };
    return { svc: new UnitScopeService(prisma as never), queries: () => queries };
  }
  const member = (role: string, extra: Record<string, unknown> = {}) =>
    ({ id: 5, email: 'x@y.z', userType: 'MEMBER', isSuperAdmin: false, organizationId: 1, role, ...extra }) as never;

  it('PROFESSOR com registros = lista de unidades; sem registros = ALL (não quebra grupos existentes)', async () => {
    assert.deepEqual(await service([10, 20]).svc.resolve(member('PROFESSOR'), 1), [10, 20]);
    assert.equal(await service([]).svc.resolve(member('PROFESSOR'), 1), 'ALL');
  });

  it('MESTRE, ALUNO, RESPONSAVEL, PLATFORM, super admin e chamada interna = ALL (sem nem consultar o banco)', async () => {
    for (const user of [
      member('MESTRE'),
      member('ALUNO'),
      member('RESPONSAVEL'),
      member('PROFESSOR', { userType: 'PLATFORM' }),
      member('PROFESSOR', { isSuperAdmin: true }),
      undefined,
    ]) {
      const { svc, queries } = service([10]);
      assert.equal(await svc.resolve(user, 1), 'ALL');
      assert.equal(queries(), 0);
    }
  });
});
