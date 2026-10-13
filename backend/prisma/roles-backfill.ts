// Backfill dos CARGOS (ficha unica, Fase 3 - docs/FICHA_UNICA.md secao 5), idempotente:
//   para cada membership ATIVA de equipe (MESTRE/PROFESSOR/INSTRUTOR/MONITOR) de grupo:
//   1. o cargo ativo equivalente (PersonRole; a migration ja cria os de MESTRE/PROFESSOR);
//   2. STAFF TAMBEM E ALUNO: a matricula (Student) do login no grupo - criada com isStaff=true quando falta (nao conta no
//      limite de alunos do plano e nao gera mensalidade);
//   3. a ficha (Person) da matricula (mesmas regras do person:backfill) e o personId nos cargos.
//   Nunca altera papel/acesso de ninguem.
//
// COMO RODA
//   - Manual:   `npm run roles:backfill` (sempre roda; repetir nao muda o que ja esta feito).
//   - No boot do stage "server" do Dockerfile (depois do person-backfill), com `--auto`:
//       ROLES_BACKFILL=true  -> roda sempre;   ROLES_BACKFILL=false -> nunca;
//       sem a variavel       -> roda quando existe membership de equipe ATIVA sem matricula de aluno no grupo.
//     Falha aqui NAO impede a API de subir.

import { PrismaClient } from '@prisma/client';
import { backfillStaffRoles, STAFF_ORG_ROLES } from '../src/interface/http/roles/staff-roles';

export type BackfillMode = 'auto' | 'manual';

export function shouldRunRolesBackfill(mode: BackfillMode, env: Record<string, string | undefined>, staffWithoutEnrollment: number): boolean {
  const flag = env.ROLES_BACKFILL?.trim().toLowerCase();
  if (flag === 'false') return false;
  if (mode === 'manual' || flag === 'true') return true;
  return staffWithoutEnrollment > 0;
}

/** Memberships ATIVAS de equipe (de grupo) cujo login ainda nao tem matricula no grupo. */
export async function countStaffWithoutEnrollment(prisma: PrismaClient): Promise<number> {
  const staff = await prisma.organizationUser.findMany({
    where: { status: 'ACTIVE', role: { in: STAFF_ORG_ROLES }, organization: { type: 'GROUP' } },
    select: { organizationId: true, userId: true },
  });
  let missing = 0;
  for (const m of staff) {
    if (!(await prisma.student.findFirst({ where: { organizationId: m.organizationId, userId: m.userId }, select: { id: true } }))) missing++;
  }
  return missing;
}

async function main(): Promise<void> {
  const mode: BackfillMode = process.argv.includes('--auto') ? 'auto' : 'manual';
  const prisma = new PrismaClient();
  try {
    const pending = await countStaffWithoutEnrollment(prisma);
    if (!shouldRunRolesBackfill(mode, process.env, pending)) {
      console.log(`[roles] backfill dispensado (${pending} membro(s) da equipe sem matricula; ROLES_BACKFILL=${process.env.ROLES_BACKFILL ?? '(padrao)'}).`);
      return;
    }
    const started = Date.now();
    const r = await backfillStaffRoles(prisma, {}, (msg) => console.error(`[roles] ${msg}`));
    const activeRoles = await prisma.personRole.count({ where: { revokedAt: null } });
    console.log(
      `[roles] backfill concluido em ${Date.now() - started} ms: ${r.staffMemberships} membro(s) ativo(s) da equipe; ` +
        `${r.rolesCreated} cargo(s) criado(s); ${r.enrollmentsCreated} matricula(s) de aluno criada(s) (isStaff), ` +
        `${r.enrollmentsReused} ja existia(m); ${r.personsLinked} cargo(s) ligado(s) a ficha; ${r.failed} falha(s). ` +
        `Cargos ativos no total: ${activeRoles}.`,
    );
    if (r.failed > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[roles] ERRO no backfill: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
    process.exitCode = 1;
  });
}
