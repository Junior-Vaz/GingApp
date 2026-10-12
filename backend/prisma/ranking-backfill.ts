// Backfill do Ginga Rank (idempotente): deriva os PointEvent, conquistas e ligas de TODOS os alunos ativos a partir do
// historico que ja existe (presencas, eventos, rodas, graduacoes, certificados) e grava o resultado das temporadas
// encerradas (SeasonResult), SEM notificar ninguem (nao se avisa o passado).
//
// COMO RODA
//   - Manual:   `npm run ranking:backfill` (sempre roda; pode repetir a vontade - converge para o mesmo estado).
//   - No boot do stage "server" do Dockerfile (depois do bootstrap e do demo), com `--auto`:
//       RANKING_BACKFILL=true   -> roda sempre;
//       RANKING_BACKFILL=false  -> nunca roda;
//       sem a variavel (padrao) -> roda UMA vez: so se a tabela PointEvent estiver vazia.
//     Falha aqui NAO impede a API de subir (o recalculo noturno cobre qualquer diferenca).
//
// O motor e' o MESMO da API (RankingService); este script so' o chama dentro de um contexto Nest minimo.

import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { RankingModule } from '../src/interface/http/ranking/ranking.module';
import { RankingService } from '../src/interface/http/ranking/ranking.service';
import { PrismaService } from '../src/shared/prisma/prisma.service';
import { SharedModule } from '../src/shared/shared.module';

// ThrottlerModule: os controllers dos modulos importados (alunos) declaram guards de rate limit; aqui nao ha HTTP.
@Module({ imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 1_000_000 }]), SharedModule, RankingModule] })
class RankingBackfillModule {}

export type BackfillMode = 'auto' | 'manual';

/** Decide se o backfill deve rodar (testavel sem banco). */
export function shouldRunBackfill(mode: BackfillMode, env: Record<string, string | undefined>, pointEventCount: number): boolean {
  const flag = env.RANKING_BACKFILL?.trim().toLowerCase();
  if (flag === 'false') return false;
  if (mode === 'manual' || flag === 'true') return true;
  return pointEventCount === 0; // padrao no boot: 1 vez, quando ainda nao ha nenhum ponto
}

async function main(): Promise<void> {
  const mode: BackfillMode = process.argv.includes('--auto') ? 'auto' : 'manual';
  const app = await NestFactory.createApplicationContext(RankingBackfillModule, { logger: ['error', 'warn'] });
  try {
    const prisma = app.get(PrismaService);
    const ranking = app.get(RankingService);
    const before = await prisma.pointEvent.count();
    if (!shouldRunBackfill(mode, process.env, before)) {
      console.log(`[ranking] backfill dispensado (${before} ponto(s) ja existem; RANKING_BACKFILL=${process.env.RANKING_BACKFILL ?? '(padrao)'}).`);
      return;
    }
    const started = Date.now();
    const sync = await ranking.syncAll({ notify: false });
    const seasons = await ranking.closePendingSeasons({ notify: false });
    const [points, students, achievements, results] = await Promise.all([
      prisma.pointEvent.count(),
      prisma.pointEvent.groupBy({ by: ['studentId'] }).then((r) => r.length),
      prisma.achievement.count({ where: { NOT: { code: { startsWith: 'LEAGUE_' } } } }),
      prisma.seasonResult.count(),
    ]);
    console.log(
      `[ranking] backfill concluido em ${Date.now() - started} ms: ${sync.students} aluno(s) recalculado(s) ` +
        `(+${sync.created} ~${sync.updated} -${sync.removed}, ${sync.failed} falha(s)); ` +
        `${points} ponto(s) em ${students} aluno(s) com pontos; ${achievements} conquista(s); ` +
        `${seasons.length} temporada(s) fechada(s) agora, ${results} linha(s) de resultado no total.`,
    );
    if (sync.failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[ranking] ERRO no backfill: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
    process.exitCode = 1;
  });
}
