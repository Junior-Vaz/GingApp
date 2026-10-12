import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PointEventType, Student, StudentStatus } from '@prisma/client';
import { requireLinkedStudent } from '../../../shared/access/linked-student';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { StudentsService } from '../students/students.service';
import {
  GroupsRankingQueryDto,
  GroupOverviewQueryDto,
  HallOfFameQueryDto,
  RANKING_DEFAULT_LIMIT,
  StudentsRankingQueryDto,
  UpdateRankingSettingsDto,
} from './dto/ranking.dto';
import {
  GroupScope,
  StudentRankParams,
  StudentScope,
  allTimePoints,
  countRankedStudents,
  fetchRankedGroups,
  fetchRankedStudents,
  fetchStudentRanks,
  sumStudentPoints,
} from './ranking-queries';
import {
  ACHIEVEMENTS,
  LEAGUE_MARKER_PREFIX,
  RankingBand,
  RankingCategory,
  achievementDef,
  civilDay,
  checkNickname,
  currentSeason,
  currentStreakWeeks,
  displayNameOf,
  isMinor,
  leagueFor,
  levelView,
  nextLeagueFor,
  previousSeason,
  progressPct,
  spDay,
  typesForCategory,
  weekStart,
  ageInYears,
} from './ranking-rules';

const WEEK_MS = 7 * 86_400_000;
const OVERVIEW_TOP = 10;
const SEASONS_DEFAULT_LIMIT = 12;

export interface RankingItem {
  rank: number;
  studentId: number;
  displayName: string;
  avatarUrl: string | null;
  groupId: number;
  groupName: string;
  groupLogoUrl: string | null;
  city: string | null;
  state: string | null;
  points: number;
  level: { code: string; name: string; color: string };
  rankDelta: number | null;
  isMe: boolean;
}

export interface RankingSettings {
  optInPublic: boolean;
  nickname: string | null;
  canOptIn: boolean;
  requiresGuardianConsent: boolean;
}

/** Leitura do Ginga Rank (rankings, "meu progresso", configuracoes, temporadas, visao do grupo). */
@Injectable()
export class RankingQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly studentsService: StudentsService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // Contexto
  // ---------------------------------------------------------------------------------------------

  private orgOf(user: AuthenticatedUser): number {
    if (user.organizationId === undefined || user.organizationId === null) {
      throw new UnauthorizedException('Token sem contexto de organização.');
    }
    return user.organizationId;
  }

  /** Aluno "da vez" do usuario: o ?studentId= (vinculo conferido: proprio ou dependente) ou o primeiro aluno ligado. */
  private async viewerStudent(organizationId: number, userId: number, studentId?: number): Promise<Student | null> {
    if (studentId !== undefined) return requireLinkedStudent(this.studentsService, organizationId, userId, studentId);
    const mine = await this.studentsService.findMine(organizationId, userId);
    return mine.find((s) => s.status === StudentStatus.ACTIVE) ?? mine[0] ?? null;
  }

  private async orgPlace(organizationId: number): Promise<{ city: string | null; state: string | null }> {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { city: true, state: true } });
    return { city: org?.city ?? null, state: org?.state ?? null };
  }

  private async hasGuardianConsent(studentId: number): Promise<boolean> {
    return (await this.prisma.studentGuardian.count({ where: { studentId, consentPublicProfile: true } })) > 0;
  }

  private async settingsOf(student: Student): Promise<RankingSettings> {
    const [profile, consent] = await Promise.all([
      this.prisma.rankingProfile.findUnique({ where: { studentId: student.id } }),
      isMinor(student.birthDate) ? this.hasGuardianConsent(student.id) : Promise.resolve(true),
    ]);
    const requiresGuardianConsent = isMinor(student.birthDate) && !consent;
    return {
      optInPublic: profile?.optInPublic ?? false,
      nickname: profile?.nickname ?? null,
      canOptIn: !requiresGuardianConsent,
      requiresGuardianConsent,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // GET /ranking/students  (e hall-of-fame)
  // ---------------------------------------------------------------------------------------------

  async students(user: AuthenticatedUser, query: StudentsRankingQueryDto, now: Date = new Date()) {
    const organizationId = this.orgOf(user);
    const place = await this.orgPlace(organizationId);
    const scope: StudentScope = query.scope ?? 'GROUP';
    const season = query.season ?? currentSeason(now);
    const category: RankingCategory = query.category ?? 'GENERAL';
    const band: RankingBand | null = query.band ?? null;
    const limit = query.limit ?? RANKING_DEFAULT_LIMIT;
    const offset = query.offset ?? 0;
    const params: StudentRankParams = {
      scope,
      organizationId,
      city: place.city,
      state: place.state,
      season,
      types: typesForCategory(category),
      band,
    };

    const viewer = await this.viewerStudent(organizationId, user.id, query.studentId);
    const rows = await fetchRankedStudents(this.prisma, params, limit, offset);
    const total = rows.length > 0 ? rows[0].total : offset > 0 ? await countRankedStudents(this.prisma, params) : 0;

    const ids = rows.map((r) => r.studentId);
    const [levels, previous] = await Promise.all([
      allTimePoints(this.prisma, ids),
      this.previousRanks(params, ids, now),
    ]);
    const items: RankingItem[] = rows.map((r) => {
      const before = previous.get(r.studentId);
      return {
        rank: r.rank,
        studentId: r.studentId,
        displayName: displayNameOf(r.name, r.nickname),
        avatarUrl: r.photo ?? null,
        groupId: r.groupId,
        groupName: r.groupName,
        groupLogoUrl: r.groupLogo ?? null,
        city: r.city ?? null,
        state: r.state ?? null,
        points: r.points,
        level: levelView(leagueFor(levels.get(r.studentId) ?? 0)),
        rankDelta: before && before.points > 0 ? before.rank - r.rank : null,
        isMe: viewer?.id === r.studentId,
      };
    });

    let me: { rank: number | null; points: number; inList: boolean } | null = null;
    if (viewer) {
      const mine = (await fetchStudentRanks(this.prisma, params, [viewer.id])).get(viewer.id);
      me = {
        rank: mine?.rank ?? null,
        points: mine ? mine.points : await sumStudentPoints(this.prisma, viewer.id, params),
        inList: !!mine && mine.rank > offset && mine.rank <= offset + limit,
      };
    }
    return { items, me, total, season, scope, category, band };
  }

  /** Posicao no periodo anterior (mes anterior; em season=ALL, a de 7 dias atras) dos alunos da pagina. */
  private async previousRanks(params: StudentRankParams, ids: number[], now: Date) {
    const prev: StudentRankParams =
      params.season === 'ALL'
        ? { ...params, before: new Date(now.getTime() - WEEK_MS) }
        : { ...params, season: previousSeason(params.season) };
    return fetchStudentRanks(this.prisma, prev, ids);
  }

  /** GET /ranking/hall-of-fame: ranking de todos os tempos (alias de /ranking/students com season=ALL). */
  hallOfFame(user: AuthenticatedUser, query: HallOfFameQueryDto) {
    return this.students(user, {
      scope: query.scope ?? 'GROUP',
      season: 'ALL',
      category: 'GENERAL',
      limit: query.limit,
      offset: query.offset,
      studentId: query.studentId,
    });
  }

  // ---------------------------------------------------------------------------------------------
  // GET /ranking/groups
  // ---------------------------------------------------------------------------------------------

  async groups(user: AuthenticatedUser, query: GroupsRankingQueryDto, now: Date = new Date()) {
    const organizationId = this.orgOf(user);
    const place = await this.orgPlace(organizationId);
    const scope: GroupScope = query.scope ?? 'COUNTRY';
    const season = query.season ?? currentSeason(now);
    const limit = query.limit ?? RANKING_DEFAULT_LIMIT;
    const offset = query.offset ?? 0;
    const params = { scope, organizationId, city: place.city, state: place.state, season };
    const rows = await fetchRankedGroups(this.prisma, params, limit, offset);
    const total = rows.length > 0 ? rows[0].total : offset > 0 ? ((await fetchRankedGroups(this.prisma, params, 1, 0))[0]?.total ?? 0) : 0;
    return {
      items: rows.map((r) => ({
        rank: r.rank,
        groupId: r.groupId,
        name: r.name,
        logoUrl: r.logo ?? null,
        city: r.city ?? null,
        state: r.state ?? null,
        studentsCount: r.studentsCount,
        totalPoints: r.totalPoints,
        avgPoints: Math.round(r.totalPoints / r.studentsCount),
        isMine: r.groupId === organizationId,
      })),
      total,
      season,
      scope,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // GET /ranking/me
  // ---------------------------------------------------------------------------------------------

  async me(user: AuthenticatedUser, studentId?: number, now: Date = new Date()) {
    const organizationId = this.orgOf(user);
    const student = await this.viewerStudent(organizationId, user.id, studentId);
    if (!student) {
      // Sem aluno ligado (ex.: MESTRE/PROFESSOR sem cadastro de aluno): mesma resposta de aluno inexistente.
      throw new NotFoundException('Aluno não encontrado.');
    }
    const place = await this.orgPlace(organizationId);
    const season = currentSeason(now);
    const base = { organizationId, city: place.city, state: place.state, season, types: null, band: null } as const;

    const [seasonPoints, allTimeMap, achievements, attendanceDays, settings, ...ranks] = await Promise.all([
      sumStudentPoints(this.prisma, student.id, { season, types: null }),
      allTimePoints(this.prisma, [student.id]),
      this.prisma.achievement.findMany({ where: { studentId: student.id, NOT: { code: { startsWith: LEAGUE_MARKER_PREFIX } } }, orderBy: { earnedAt: 'asc' } }),
      this.prisma.pointEvent.findMany({ where: { studentId: student.id, type: PointEventType.CLASS_ATTENDANCE }, select: { occurredAt: true } }),
      this.settingsOf(student),
      ...(['GROUP', 'CITY', 'STATE', 'COUNTRY'] as const).map((scope) => fetchStudentRanks(this.prisma, { ...base, scope }, [student.id])),
    ]);
    const allTime = allTimeMap.get(student.id) ?? 0;
    const level = leagueFor(allTime);
    const next = nextLeagueFor(allTime);
    const weeks = new Set(attendanceDays.map((p) => weekStart(civilDay(p.occurredAt))));
    const earned = new Set(achievements.map((a) => a.code));
    const rankOf = (i: number): number | null => ranks[i].get(student.id)?.rank ?? null;

    return {
      student: { id: student.id, displayName: displayNameOf(student.name, settings.nickname), avatarUrl: student.photo ?? null },
      points: { season: seasonPoints, allTime },
      level: levelView(level),
      nextLevel: next ? { ...levelView(next), minPoints: next.minPoints } : null,
      pointsToNext: next ? next.minPoints - allTime : null,
      progressPct: progressPct(allTime),
      streakWeeks: currentStreakWeeks(weeks, spDay(now)),
      rank: { group: rankOf(0), city: rankOf(1), state: rankOf(2), country: rankOf(3) },
      achievements: achievements
        .map((a) => {
          const def = achievementDef(a.code);
          return def ? { code: def.code, name: def.name, description: def.description, earnedAt: a.earnedAt } : null;
        })
        .filter((a): a is NonNullable<typeof a> => a !== null),
      availableAchievements: ACHIEVEMENTS.filter((a) => !earned.has(a.code)).map((a) => ({ code: a.code, name: a.name, description: a.description })),
      settings,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // PUT /ranking/me/settings
  // ---------------------------------------------------------------------------------------------

  async updateSettings(user: AuthenticatedUser, studentId: number | undefined, dto: UpdateRankingSettingsDto): Promise<RankingSettings> {
    const organizationId = this.orgOf(user);
    const student = await this.viewerStudent(organizationId, user.id, studentId);
    if (!student) throw new NotFoundException('Aluno não encontrado.');

    let nickname: string | null | undefined;
    if (dto.nickname !== undefined) {
      const checked = checkNickname(dto.nickname);
      if (!checked.ok) throw new BadRequestException(checked.message);
      nickname = checked.value;
    }
    if (dto.optInPublic === true && isMinor(student.birthDate) && !(await this.hasGuardianConsent(student.id))) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message:
          'Aluno menor de idade: o responsável precisa autorizar o perfil público do aluno (mesmo consentimento do Passaporte) antes de aparecer nos rankings abertos.',
        code: 'GUARDIAN_CONSENT_REQUIRED',
      });
    }

    if (dto.optInPublic !== undefined || nickname !== undefined) {
      await this.prisma.rankingProfile.upsert({
        where: { studentId: student.id },
        create: { studentId: student.id, optInPublic: dto.optInPublic ?? false, nickname: nickname ?? null },
        update: {
          ...(dto.optInPublic !== undefined ? { optInPublic: dto.optInPublic } : {}),
          ...(nickname !== undefined ? { nickname } : {}),
        },
      });
      await this.audit.record({
        organizationId,
        action: AuditAction.RANKING_SETTINGS,
        entity: AuditEntity.RANKING_PROFILE,
        entityId: student.id,
        meta: {
          studentId: student.id,
          ...(dto.optInPublic !== undefined ? { optInPublic: dto.optInPublic } : {}),
          ...(nickname !== undefined ? { nicknameSet: nickname !== null } : {}),
        },
      });
    }
    return this.settingsOf(student);
  }

  // ---------------------------------------------------------------------------------------------
  // GET /ranking/seasons
  // ---------------------------------------------------------------------------------------------

  async seasons(user: AuthenticatedUser, limit = SEASONS_DEFAULT_LIMIT, now: Date = new Date()) {
    const organizationId = this.orgOf(user);
    const closed = await this.prisma.seasonResult.findMany({
      distinct: ['season'],
      select: { season: true },
      orderBy: { season: 'desc' },
      take: limit,
    });
    const seasons = closed.map((c) => c.season);
    const rows = seasons.length
      ? await this.prisma.seasonResult.findMany({
          where: {
            season: { in: seasons },
            rank: 1,
            OR: [{ scope: 'COUNTRY' }, { scope: 'GROUP', scopeKey: String(organizationId) }, { scope: 'GROUPS_COUNTRY' }],
          },
        })
      : [];

    const studentIds = [...new Set(rows.map((r) => r.studentId).filter((id): id is number => id !== null))];
    const groupIds = [...new Set(rows.filter((r) => r.scope === 'GROUPS_COUNTRY').map((r) => r.organizationId).filter((id): id is number => id !== null))];
    const [students, consents, groups] = await Promise.all([
      this.prisma.student.findMany({
        where: { id: { in: studentIds } },
        select: { id: true, name: true, birthDate: true, status: true, rankingProfile: { select: { nickname: true, optInPublic: true } } },
      }),
      this.prisma.studentGuardian.findMany({ where: { studentId: { in: studentIds }, consentPublicProfile: true }, select: { studentId: true } }),
      this.prisma.organization.findMany({ where: { id: { in: groupIds } }, select: { id: true, name: true } }),
    ]);
    const studentById = new Map(students.map((s) => [s.id, s]));
    const consented = new Set(consents.map((c) => c.studentId));
    const groupName = new Map(groups.map((g) => [g.id, g.name]));

    const champion = (row: (typeof rows)[number]) => {
      const s = row.studentId !== null ? studentById.get(row.studentId) : undefined;
      if (!s) return { displayName: 'Capoeirista', points: row.points };
      if (row.scope === 'COUNTRY') {
        // Campeao do Brasil so continua identificado enquanto o opt-in (e o consentimento do menor) seguirem valendo.
        const age = ageInYears(s.birthDate);
        const eligible = !!s.rankingProfile?.optInPublic && (age === null || age >= 18 || consented.has(s.id));
        if (!eligible) return { displayName: 'Capoeirista anônimo', points: row.points };
      }
      return { studentId: s.id, displayName: displayNameOf(s.name, s.rankingProfile?.nickname), points: row.points };
    };

    return {
      current: currentSeason(now),
      items: seasons.map((season) => {
        const of = (scope: string) => rows.find((r) => r.season === season && r.scope === scope);
        const country = of('COUNTRY');
        const group = of('GROUP');
        const topGroup = of('GROUPS_COUNTRY');
        return {
          season,
          champions: {
            country: country ? champion(country) : null,
            group: group ? champion(group) : null,
            topGroup:
              topGroup && topGroup.organizationId !== null
                ? { groupId: topGroup.organizationId, name: groupName.get(topGroup.organizationId) ?? 'Grupo', avgPoints: topGroup.points }
                : null,
          },
        };
      }),
    };
  }

  // ---------------------------------------------------------------------------------------------
  // GET /ranking/group-overview  (MESTRE/PROFESSOR)
  // ---------------------------------------------------------------------------------------------

  async groupOverview(user: AuthenticatedUser, query: GroupOverviewQueryDto, now: Date = new Date()) {
    const organizationId = this.orgOf(user);
    const season = query.season ?? currentSeason(now);
    const studentWhere = { organizationId, status: StudentStatus.ACTIVE };
    const [activeStudents, totals, scoring, top] = await Promise.all([
      this.prisma.student.count({ where: studentWhere }),
      this.prisma.pointEvent.aggregate({ _sum: { points: true }, where: { season, student: studentWhere } }),
      this.prisma.pointEvent.groupBy({ by: ['studentId'], where: { season, student: studentWhere }, having: { points: { _sum: { gt: 0 } } } }),
      this.students(user, { scope: 'GROUP', season, limit: OVERVIEW_TOP }, now),
    ]);
    const totalPoints = totals._sum.points ?? 0;
    return {
      season,
      topStudents: top.items.filter((i) => i.points > 0),
      inactiveCount: Math.max(0, activeStudents - scoring.length),
      totalPoints,
      avgPoints: activeStudents > 0 ? Math.round(totalPoints / activeStudents) : 0,
      activeStudents,
    };
  }
}
