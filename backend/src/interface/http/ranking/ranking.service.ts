import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { EventStatus, ParticipantStatus, Prisma, RecordStatus, StudentStatus } from '@prisma/client';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { fetchRankedGroups, fetchRankedStudents } from './ranking-queries';
import {
  LEAGUES,
  LEAGUE_MARKER_PREFIX,
  RankingSource,
  achievementDef,
  currentSeason,
  derivePoints,
  leagueIndexFor,
  leagueMarker,
  previousSeason,
  shortName,
} from './ranking-rules';

export interface SyncOptions {
  /** Notifica conquista/liga nova (padrao true). O backfill roda com false: nao avisa ninguem do passado. */
  notify?: boolean;
  /** Instante de referencia (testes). */
  now?: Date;
}

export interface SyncResult {
  studentId: number;
  created: number;
  updated: number;
  removed: number;
  totalPoints: number;
  newAchievements: string[];
  leagueCode: string;
}

export interface SyncAllResult {
  students: number;
  failed: number;
  created: number;
  updated: number;
  removed: number;
}

export interface CloseSeasonResult {
  season: string;
  /** Escopos gravados nesta execucao / pulados por ja existirem (idempotente). */
  written: number;
  skipped: number;
  championsNotified: number;
}

const SYNC_ALL_CONCURRENCY = 5;
const TOP_N = 10;

/**
 * Motor do Ginga Rank. DERIVA os PointEvent das tabelas de origem (Attendance, EventParticipant, RodaParticipant,
 * StudentGraduation, Certificate) — nunca recebe "pontos" de fora —, entao `syncStudent` e' idempotente: roda quantas
 * vezes quiser e converge para o mesmo estado (cria o que falta, corrige o que mudou, remove o que deixou de existir
 * na origem, ex.: presenca desmarcada). As regras (valores, anti-fraude, sequencia) vivem em ranking-rules.ts.
 *
 * Os gatilhos (marcar presenca, check-in, graduar, certificado, roda) chamam `queueSync`, que e' FIRE-AND-FORGET:
 * nunca atrasa nem derruba a acao principal (erro vira log). O job noturno (`syncAll`) e o backfill cobrem o que
 * nenhum gatilho viu (roda que acontece depois da confirmacao, mes que fecha, edicoes feitas direto no banco).
 */
@Injectable()
export class RankingService implements OnModuleDestroy {
  private readonly logger = new Logger(RankingService.name);
  /** Cadeia por aluno: dois syncs do mesmo aluno nunca rodam ao mesmo tempo. */
  private readonly chains = new Map<number, Promise<unknown>>();
  private readonly pending = new Set<Promise<unknown>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // Gatilhos (fire-and-forget)
  // ---------------------------------------------------------------------------------------------

  /** Agenda o recalculo dos alunos e retorna NA HORA. Nunca lanca. */
  queueSync(studentIds: number | Iterable<number> | null | undefined, options: SyncOptions = {}): void {
    if (studentIds === null || studentIds === undefined) return;
    const ids = [...new Set(typeof studentIds === 'number' ? [studentIds] : studentIds)].filter(
      (id) => Number.isInteger(id) && id > 0,
    );
    for (const id of ids) {
      const task = this.syncStudent(id, options).catch((error) => {
        this.logger.error(`Falha ao recalcular o ranking do aluno ${id}: ${error instanceof Error ? error.message : String(error)}`);
      });
      this.pending.add(task);
      void task.finally(() => this.pending.delete(task));
    }
  }

  /** Recalcula todos os alunos do usuario (participacao em roda grava so userId). Fire-and-forget. */
  queueSyncForUser(userId: number | null | undefined, options: SyncOptions = {}): void {
    if (!userId) return;
    const task = this.prisma.student
      .findMany({ where: { userId }, select: { id: true } })
      .then((students) => this.queueSync(students.map((s) => s.id), options))
      .catch((error) => {
        this.logger.error(`Falha ao localizar os alunos do usuario ${userId} para o ranking: ${error instanceof Error ? error.message : String(error)}`);
      });
    this.pending.add(task);
    void task.finally(() => this.pending.delete(task));
  }

  /** Encerramento: espera os recalculos em andamento (antes de o Prisma desconectar). */
  async onModuleDestroy(): Promise<void> {
    await this.idle();
  }

  /** Espera os recalculos agendados terminarem (testes / encerramento). */
  async idle(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.allSettled([...this.pending]);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Motor
  // ---------------------------------------------------------------------------------------------

  /** Recalcula (idempotente) os pontos, conquistas e liga de UM aluno. `null` = aluno inexistente. Serializado por aluno. */
  async syncStudent(studentId: number, options: SyncOptions = {}): Promise<SyncResult | null> {
    const previous = this.chains.get(studentId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(() => this.doSync(studentId, options));
    this.chains.set(studentId, run);
    try {
      return await run;
    } finally {
      if (this.chains.get(studentId) === run) this.chains.delete(studentId);
    }
  }

  private async loadSource(
    student: { id: number; organizationId: number; userId: number | null },
    now: Date,
  ): Promise<RankingSource> {
    const studentId = student.id;
    const [attendances, events, directRodas, userRodas, siblings, graduations, certificates] = await Promise.all([
      this.prisma.attendance.findMany({
        where: { studentId, lesson: { status: RecordStatus.ACTIVE } },
        select: { lessonId: true, present: true, lesson: { select: { date: true } } },
      }),
      this.prisma.eventParticipant.findMany({
        where: {
          studentId,
          status: ParticipantStatus.ATTENDED,
          event: { status: { in: [EventStatus.PUBLISHED, EventStatus.CLOSED] } },
        },
        select: { eventId: true, event: { select: { date: true } } },
      }),
      this.prisma.rodaParticipant.findMany({
        where: { studentId, status: { in: [ParticipantStatus.CONFIRMED, ParticipantStatus.ATTENDED] }, roda: { date: { lte: now } } },
        select: { rodaId: true, roda: { select: { date: true } } },
      }),
      student.userId
        ? this.prisma.rodaParticipant.findMany({
            where: {
              userId: student.userId,
              studentId: null,
              status: { in: [ParticipantStatus.CONFIRMED, ParticipantStatus.ATTENDED] },
              roda: { date: { lte: now } },
            },
            select: { rodaId: true, roda: { select: { date: true, organizationId: true } } },
          })
        : Promise.resolve([]),
      student.userId
        ? this.prisma.student.findMany({
            where: { userId: student.userId },
            select: { id: true, organizationId: true, status: true },
            orderBy: { id: 'asc' },
          })
        : Promise.resolve([]),
      this.prisma.studentGraduation.findMany({
        where: { studentId },
        select: { id: true, graduatedAt: true, graduationLevel: { select: { order: true } } },
      }),
      this.prisma.certificate.findMany({ where: { studentId }, select: { id: true, issuedAt: true, createdAt: true } }),
    ]);

    // Participacao em roda grava so o userId (RodasService.join): vale para o aluno do usuario cujo GRUPO e' o da roda;
    // roda da comunidade (sem grupo) ou de grupo onde o usuario nao e' aluno vale para o primeiro aluno ATIVO dele —
    // assim quem e' aluno em dois grupos nunca ganha o mesmo ponto duas vezes.
    const primarySibling = siblings.find((s) => s.status === StudentStatus.ACTIVE) ?? siblings[0];
    const rodas = new Map<number, Date>();
    for (const r of directRodas) rodas.set(r.rodaId, r.roda.date);
    for (const r of userRodas) {
      const owner = siblings.find((s) => s.organizationId === r.roda.organizationId) ?? primarySibling;
      if (owner?.id === studentId) rodas.set(r.rodaId, r.roda.date);
    }

    return {
      attendances: attendances.map((a) => ({ lessonId: a.lessonId, lessonDate: a.lesson.date, present: a.present })),
      events: events.map((e) => ({ eventId: e.eventId, date: e.event.date })),
      rodas: [...rodas].map(([rodaId, date]) => ({ rodaId, date })),
      graduations: graduations.map((g) => ({ id: g.id, graduatedAt: g.graduatedAt, levelOrder: g.graduationLevel.order })),
      certificates: certificates.map((c) => ({ id: c.id, issuedAt: c.issuedAt ?? c.createdAt })),
    };
  }

  private async doSync(studentId: number, options: SyncOptions): Promise<SyncResult | null> {
    const now = options.now ?? new Date();
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, organizationId: true, userId: true, name: true, status: true },
    });
    if (!student) return null;

    const derivation = derivePoints(await this.loadSource(student, now), now);
    const existing = await this.prisma.pointEvent.findMany({ where: { studentId } });
    const keyOf = (p: { type: string; refType: string; refId: string }) => `${p.type}|${p.refType}|${p.refId}`;
    const byKey = new Map(existing.map((e) => [keyOf(e), e]));

    const toCreate: Prisma.PointEventCreateManyInput[] = [];
    const toUpdate: Array<{ id: number; data: Prisma.PointEventUpdateInput }> = [];
    for (const d of derivation.points) {
      const key = keyOf(d);
      const found = byKey.get(key);
      if (!found) {
        toCreate.push({ organizationId: student.organizationId, studentId, ...d });
        continue;
      }
      byKey.delete(key);
      if (found.points !== d.points || found.season !== d.season || found.occurredAt.getTime() !== d.occurredAt.getTime()) {
        toUpdate.push({ id: found.id, data: { points: d.points, season: d.season, occurredAt: d.occurredAt } });
      }
    }
    const staleIds = [...byKey.values()].map((e) => e.id);

    if (toCreate.length > 0 || toUpdate.length > 0 || staleIds.length > 0) {
      await this.prisma.$transaction([
        ...(staleIds.length > 0 ? [this.prisma.pointEvent.deleteMany({ where: { id: { in: staleIds } } })] : []),
        ...toUpdate.map((u) => this.prisma.pointEvent.update({ where: { id: u.id }, data: u.data })),
        ...(toCreate.length > 0 ? [this.prisma.pointEvent.createMany({ data: toCreate, skipDuplicates: true })] : []),
      ]);
    }

    const totalPoints = derivation.points.reduce((sum, p) => sum + p.points, 0);
    const newAchievements = await this.grantAchievements(student, derivation.achievements, options.notify !== false, now);
    const leagueCode = await this.grantLeague(student, totalPoints, options.notify !== false, now);

    return {
      studentId,
      created: toCreate.length,
      updated: toUpdate.length,
      removed: staleIds.length,
      totalPoints,
      newAchievements,
      leagueCode,
    };
  }

  /** Cria as conquistas novas (uma notificacao por conquista, so quando a linha foi MESMO criada agora). */
  private async grantAchievements(
    student: { id: number; organizationId: number; name: string; status: StudentStatus },
    earned: Array<{ code: string; earnedAt: Date }>,
    notify: boolean,
    now: Date,
  ): Promise<string[]> {
    if (earned.length === 0) return [];
    const have = new Set(
      (await this.prisma.achievement.findMany({ where: { studentId: student.id }, select: { code: true } })).map((a) => a.code),
    );
    const created: string[] = [];
    for (const a of earned) {
      if (have.has(a.code)) continue;
      const earnedAt = a.earnedAt.getTime() > now.getTime() ? now : a.earnedAt;
      const { count } = await this.prisma.achievement.createMany({
        data: [{ studentId: student.id, code: a.code, earnedAt }],
        skipDuplicates: true,
      });
      if (count !== 1) continue; // outro sync criou primeiro: ele notifica
      created.push(a.code);
      const def = achievementDef(a.code);
      if (notify && def && student.status === StudentStatus.ACTIVE) {
        await this.notifications.notifyStudents(student.organizationId, [student.id], {
          title: 'Nova conquista!',
          body: `${shortName(student.name)} desbloqueou a conquista "${def.name}": ${def.description}`,
          type: 'RANKING_ACHIEVEMENT',
        });
      }
    }
    return created;
  }

  /** Marca as ligas alcancadas e avisa so a MAIS ALTA recem-alcancada (1 aviso por liga, nunca repete). */
  private async grantLeague(
    student: { id: number; organizationId: number; name: string; status: StudentStatus },
    totalPoints: number,
    notify: boolean,
    now: Date,
  ): Promise<string> {
    const index = leagueIndexFor(totalPoints);
    if (index >= 1) {
      const markers = new Set(
        (
          await this.prisma.achievement.findMany({
            where: { studentId: student.id, code: { startsWith: LEAGUE_MARKER_PREFIX } },
            select: { code: true },
          })
        ).map((a) => a.code),
      );
      let highestNew = -1;
      for (let i = 1; i <= index; i += 1) {
        const code = leagueMarker(LEAGUES[i]);
        if (markers.has(code)) continue;
        const { count } = await this.prisma.achievement.createMany({
          data: [{ studentId: student.id, code, earnedAt: now }],
          skipDuplicates: true,
        });
        if (count === 1) highestNew = i;
      }
      if (notify && highestNew >= 1 && student.status === StudentStatus.ACTIVE) {
        await this.notifications.notifyStudents(student.organizationId, [student.id], {
          title: 'Subiu de liga!',
          body: `${shortName(student.name)} chegou à liga ${LEAGUES[highestNew].name} do Ginga Rank (${totalPoints} pontos).`,
          type: 'RANKING_LEAGUE',
        });
      }
    }
    return LEAGUES[index].code;
  }

  /** Recalcula todos os alunos ATIVOS de grupos ATIVOS (job noturno e backfill). Um erro nao interrompe os demais. */
  async syncAll(options: SyncOptions = {}): Promise<SyncAllResult> {
    const students = await this.prisma.student.findMany({
      where: { status: StudentStatus.ACTIVE, organization: { status: RecordStatus.ACTIVE } },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    const result: SyncAllResult = { students: 0, failed: 0, created: 0, updated: 0, removed: 0 };
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < students.length) {
        const { id } = students[cursor++];
        try {
          const r = await this.syncStudent(id, options);
          if (!r) continue;
          result.students += 1;
          result.created += r.created;
          result.updated += r.updated;
          result.removed += r.removed;
        } catch (error) {
          result.failed += 1;
          this.logger.error(`Falha ao recalcular o ranking do aluno ${id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    };
    await Promise.all(Array.from({ length: SYNC_ALL_CONCURRENCY }, worker));
    this.logger.log(
      `Ranking recalculado: ${result.students} aluno(s) (+${result.created} ~${result.updated} -${result.removed}), ${result.failed} falha(s).`,
    );
    return result;
  }

  // ---------------------------------------------------------------------------------------------
  // Fechamento de temporada
  // ---------------------------------------------------------------------------------------------

  /**
   * Grava o top 10 da temporada (SeasonResult): alunos por grupo (GROUP), alunos do Brasil com opt-in (COUNTRY) e grupos
   * por media (GROUPS_COUNTRY). IDEMPOTENTE: um (season, scope, scopeKey) ja gravado e' pulado e NAO notifica de novo.
   * Notifica o campeao do grupo e o do Brasil (1 aviso por campeao; quem e' os dois recebe so o do Brasil).
   */
  async closeSeason(season: string, options: { notify?: boolean } = {}): Promise<CloseSeasonResult> {
    const notify = options.notify !== false;
    if (season >= currentSeason()) return { season, written: 0, skipped: 0, championsNotified: 0 }; // so fecha mes encerrado
    const result: CloseSeasonResult = { season, written: 0, skipped: 0, championsNotified: 0 };
    const existing = new Set(
      (await this.prisma.seasonResult.findMany({ where: { season }, distinct: ['scope', 'scopeKey'], select: { scope: true, scopeKey: true } })).map(
        (r) => `${r.scope}|${r.scopeKey}`,
      ),
    );
    const champions: Array<{ studentId: number; organizationId: number; points: number; scope: 'GROUP' | 'COUNTRY' }> = [];
    const base = { season, types: null, band: null, before: null } as const;

    // Alunos por grupo.
    const orgs = await this.prisma.organization.findMany({
      where: { status: RecordStatus.ACTIVE, type: 'GROUP' },
      select: { id: true, city: true, state: true },
      orderBy: { id: 'asc' },
    });
    for (const org of orgs) {
      const key = `GROUP|${org.id}`;
      if (existing.has(key)) {
        result.skipped += 1;
        continue;
      }
      const rows = (
        await fetchRankedStudents(this.prisma, { ...base, scope: 'GROUP', organizationId: org.id, city: org.city, state: org.state }, TOP_N, 0)
      ).filter((r) => r.points > 0);
      if (rows.length === 0) continue;
      await this.prisma.seasonResult.createMany({
        data: rows.map((r) => ({ season, scope: 'GROUP', scopeKey: String(org.id), rank: r.rank, studentId: r.studentId, organizationId: org.id, points: r.points })),
        skipDuplicates: true,
      });
      result.written += 1;
      champions.push({ studentId: rows[0].studentId, organizationId: org.id, points: rows[0].points, scope: 'GROUP' });
    }

    // Brasil (so quem fez opt-in e e' elegivel).
    if (existing.has('COUNTRY|BR')) {
      result.skipped += 1;
    } else {
      const rows = await fetchRankedStudents(this.prisma, { ...base, scope: 'COUNTRY', organizationId: 0, city: null, state: null }, TOP_N, 0);
      if (rows.length > 0) {
        await this.prisma.seasonResult.createMany({
          data: rows.map((r) => ({ season, scope: 'COUNTRY', scopeKey: 'BR', rank: r.rank, studentId: r.studentId, organizationId: r.groupId, points: r.points })),
          skipDuplicates: true,
        });
        result.written += 1;
        champions.push({ studentId: rows[0].studentId, organizationId: rows[0].groupId, points: rows[0].points, scope: 'COUNTRY' });
      }
    }

    // Grupos do Brasil (media por aluno ativo).
    if (existing.has('GROUPS_COUNTRY|BR')) {
      result.skipped += 1;
    } else {
      const rows = (
        await fetchRankedGroups(this.prisma, { scope: 'COUNTRY', organizationId: 0, city: null, state: null, season }, TOP_N, 0)
      ).filter((r) => r.totalPoints > 0);
      if (rows.length > 0) {
        await this.prisma.seasonResult.createMany({
          data: rows.map((r) => ({
            season,
            scope: 'GROUPS_COUNTRY',
            scopeKey: 'BR',
            rank: r.rank,
            organizationId: r.groupId,
            points: Math.round(r.totalPoints / r.studentsCount),
          })),
          skipDuplicates: true,
        });
        result.written += 1;
      }
    }

    if (notify) {
      const country = champions.find((c) => c.scope === 'COUNTRY');
      const monthLabel = this.monthLabel(season);
      for (const c of champions) {
        if (c.scope === 'GROUP' && country && country.studentId === c.studentId) continue; // so o aviso do Brasil
        const student = await this.prisma.student.findUnique({ where: { id: c.studentId }, select: { name: true } });
        const name = student ? shortName(student.name) : 'O aluno';
        const sent = await this.notifications.notifyStudents(c.organizationId, [c.studentId], {
          title: c.scope === 'COUNTRY' ? 'Campeão do Brasil!' : 'Campeão do mês!',
          body:
            c.scope === 'COUNTRY'
              ? `${name} foi o campeão do Brasil em ${monthLabel} no Ginga Rank, com ${c.points} pontos.`
              : `${name} foi o campeão do grupo em ${monthLabel} no Ginga Rank, com ${c.points} pontos.`,
          type: 'RANKING_SEASON',
        });
        if (sent > 0) result.championsNotified += 1;
      }
    }
    return result;
  }

  /** Fecha todas as temporadas ENCERRADAS que tem ponto e ainda nao tem nenhum resultado gravado. */
  async closePendingSeasons(options: { notify?: boolean } = {}): Promise<CloseSeasonResult[]> {
    const current = currentSeason();
    const [withPoints, closed] = await Promise.all([
      this.prisma.pointEvent.findMany({ distinct: ['season'], where: { season: { lt: current } }, select: { season: true }, orderBy: { season: 'asc' } }),
      this.prisma.seasonResult.findMany({ distinct: ['season'], select: { season: true } }),
    ]);
    const closedSet = new Set(closed.map((c) => c.season));
    const results: CloseSeasonResult[] = [];
    for (const { season } of withPoints) {
      if (closedSet.has(season)) continue;
      results.push(await this.closeSeason(season, options));
    }
    return results;
  }

  /** Mes anterior ao atual (alvo do fechamento mensal). */
  previousSeason(now: Date = new Date()): string {
    return previousSeason(currentSeason(now));
  }

  private monthLabel(season: string): string {
    const [y, m] = season.split('-').map(Number);
    return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
  }
}
