// Backfill da FICHA UNICA (docs/FICHA_UNICA.md, idempotente): liga cada matricula (Student) sem personId a uma Person.
// Regras (src/interface/http/people/person-linker.ts, a MESMA usada pela API):
//   1. mesmo login (Student.userId) -> a mesma Person;
//   2. senao, mesmo CPF valido (Student.document) -> a mesma Person (exceto duplicata dentro do MESMO grupo: anota);
//   3. senao cria uma Person nova (codigo GingApp, nome, nascimento, foto, contato, CPF cifrado + hash).
// NUNCA junta por nome + nascimento: so CONTA os candidatos (mescla manual em POST /people/merge).
//
// COMO RODA
//   - Manual:   `npm run person:backfill` (sempre roda; repetir nao muda nada que ja esteja ligado).
//   - No boot do stage "server" do Dockerfile (depois do bootstrap e do demo), com `--auto`:
//       PERSON_BACKFILL=true   -> roda sempre;
//       PERSON_BACKFILL=false  -> nunca roda;
//       sem a variavel (padrao) -> roda quando existe ALGUM Student sem personId.
//     Falha aqui NAO impede a API de subir (a API completa a ficha sob demanda: PersonIdentityService.ensurePersonForStudent).
// IMPORTANTE: PERSON_DOC_PEPPER/PERSON_DOC_KEY (ou o JWT_SECRET, se elas estiverem vazias) precisam ser as MESMAS da API.

import { PrismaClient } from '@prisma/client';
import { backfillPersons } from '../src/interface/http/people/person-linker';

export type BackfillMode = 'auto' | 'manual';

/** Decide se o backfill deve rodar (testavel sem banco). */
export function shouldRunPersonBackfill(mode: BackfillMode, env: Record<string, string | undefined>, studentsWithoutPerson: number): boolean {
  const flag = env.PERSON_BACKFILL?.trim().toLowerCase();
  if (flag === 'false') return false;
  if (mode === 'manual' || flag === 'true') return true;
  return studentsWithoutPerson > 0;
}

async function main(): Promise<void> {
  const mode: BackfillMode = process.argv.includes('--auto') ? 'auto' : 'manual';
  const prisma = new PrismaClient();
  try {
    const pending = await prisma.student.count({ where: { personId: null } });
    if (!shouldRunPersonBackfill(mode, process.env, pending)) {
      console.log(`[person] backfill dispensado (${pending} matricula(s) sem ficha; PERSON_BACKFILL=${process.env.PERSON_BACKFILL ?? '(padrao)'}).`);
      return;
    }
    const started = Date.now();
    const r = await backfillPersons(prisma, (msg) => console.error(`[person] ${msg}`));
    const totalPersons = await prisma.person.count({ where: { mergedIntoId: null } });
    console.log(
      `[person] backfill concluido em ${Date.now() - started} ms: ${r.scanned} matricula(s) sem ficha processada(s); ` +
        `${r.personsCreated} ficha(s) criada(s); ${r.linkedByUser} ligada(s) pelo mesmo login; ${r.linkedByDocument} pelo mesmo CPF; ` +
        `${r.alreadyLinked} ja ligada(s) por outra execucao; ${r.invalidDocuments} documento(s) que nao sao CPF valido (ficha sem CPF); ` +
        `${r.sameGroupDocumentConflicts} CPF repetido no MESMO grupo (ficha separada, sem CPF); ${r.otherConflicts} outro(s) conflito(s); ` +
        `${r.failed} falha(s). Possiveis duplicatas (nome + nascimento): ${r.possibleDuplicateGroups} grupo(s), ${r.possibleDuplicatePersons} ficha(s). ` +
        `Fichas vigentes no total: ${totalPersons}. Matriculas ainda sem ficha: ${r.remainingWithoutPerson}.`,
    );
    if (r.failed > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[person] ERRO no backfill: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
    process.exitCode = 1;
  });
}
