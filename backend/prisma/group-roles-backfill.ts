// Backfill dos CARGOS DO GRUPO (docs/FICHA_UNICA.md secao 13), idempotente:
//   para cada organizacao GROUP: os 4 cargos padrao (Mestre 40, Professor 30, Instrutor 20, Monitor 10) e o groupRoleId
//   (cargo padrao do mesmo perfil de acesso) em cargos ATIVOS, regras de corda e avisos que ainda nao tem.
//   A migration 20261015000000_group_roles ja faz isso para os dados existentes; este script cobre o resto.
//   Nunca altera papel/acesso de ninguem.
//
// COMO RODA
//   - Manual:   `npm run group-roles:backfill` (sempre roda; repetir nao muda o que ja esta feito).
//   - No boot do stage "server" do Dockerfile (antes do roles-backfill), com `--auto`:
//       GROUP_ROLES_BACKFILL=true  -> roda sempre;   GROUP_ROLES_BACKFILL=false -> nunca;
//       sem a variavel             -> roda quando ha grupo sem os 4 cargos padrao ou cargo ativo sem cargo do grupo.
//     Falha aqui NAO impede a API de subir.

import { PrismaClient } from '@prisma/client';
import { backfillGroupRoles, countGroupRolesPending } from '../src/interface/http/roles/group-roles';

export type BackfillMode = 'auto' | 'manual';

export function shouldRunGroupRolesBackfill(mode: BackfillMode, env: Record<string, string | undefined>, pending: number): boolean {
  const flag = env.GROUP_ROLES_BACKFILL?.trim().toLowerCase();
  if (flag === 'false') return false;
  if (mode === 'manual' || flag === 'true') return true;
  return pending > 0;
}

async function main(): Promise<void> {
  const mode: BackfillMode = process.argv.includes('--auto') ? 'auto' : 'manual';
  const prisma = new PrismaClient();
  try {
    const pending = await countGroupRolesPending(prisma);
    if (!shouldRunGroupRolesBackfill(mode, process.env, pending)) {
      console.log(`[group-roles] backfill dispensado (${pending} pendencia(s); GROUP_ROLES_BACKFILL=${process.env.GROUP_ROLES_BACKFILL ?? '(padrao)'}).`);
      return;
    }
    const started = Date.now();
    const r = await backfillGroupRoles(prisma);
    const total = await prisma.groupRole.count();
    console.log(
      `[group-roles] backfill concluido em ${Date.now() - started} ms: ${r.organizations} grupo(s); ${r.defaultsCreated} cargo(s) padrao ` +
        `criado(s); ${r.personRolesLinked} cargo(s) ativo(s), ${r.rulesLinked} regra(s) e ${r.noticesLinked} aviso(s) ligados ao cargo do grupo. ` +
        `Cargos de grupo no total: ${total}.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[group-roles] ERRO no backfill: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
    process.exitCode = 1;
  });
}
