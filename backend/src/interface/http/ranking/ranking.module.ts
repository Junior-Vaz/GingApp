import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { StudentsModule } from '../students/students.module';
import { RankingController } from './ranking.controller';
import { RankingQueryService } from './ranking-query.service';
import { RankingService } from './ranking.service';

/**
 * Ginga Rank. Importado pelos modulos que geram pontos (Attendance, Events, Graduations, Certificates, Rodas) para
 * chamar `RankingService.queueSync` (fire-and-forget) e pelo JobsModule (sincronizacao noturna + fechamento mensal).
 * Nao importa nenhum deles de volta (sem ciclo): le as tabelas de origem direto pelo Prisma.
 */
@Module({
  imports: [StudentsModule, NotificationsModule],
  controllers: [RankingController],
  providers: [RankingService, RankingQueryService],
  exports: [RankingService],
})
export class RankingModule {}
