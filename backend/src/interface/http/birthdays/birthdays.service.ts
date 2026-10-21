import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { OrgRole, Prisma } from '@prisma/client';
import { isRestricted, UnitScope, UnitScopeService, assertUnitTarget } from '../../../shared/access/unit-scope';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  birthdayFallsOn,
  birthParts,
  CivilDate,
  datesFrom,
  DEFAULT_GREETING_MESSAGE,
  greetingName,
  isMinorOn,
  occurrenceInYear,
  renderGreeting,
  saoPauloNow,
  turnsAgeInYear,
  whatsappLink,
  addDays,
} from './birthday-dates';
import { GreetBirthdayDto, ListBirthdaysQueryDto, UpdateBirthdaySettingsDto } from './dto/birthdays.dto';

export const BIRTHDAY_GREETING_TYPE = 'BIRTHDAY_GREETING';
export const BIRTHDAY_CONGRATS_TYPE = 'BIRTHDAY_CONGRATS';
export const BIRTHDAY_DIGEST_TYPE = 'BIRTHDAY_DIGEST';
export const ALREADY_CONGRATULATED_CODE = 'ALREADY_CONGRATULATED';
export const BIRTHDAY_NOT_VISIBLE_CODE = 'BIRTHDAY_NOT_VISIBLE';
export const CANNOT_CONGRATULATE_SELF_CODE = 'CANNOT_CONGRATULATE_SELF';

/** Papeis de acesso que contam como EQUIPE (OrganizationUser.role). */
const STAFF_ACCESS_ROLES: OrgRole[] = [OrgRole.MESTRE, OrgRole.PROFESSOR, OrgRole.INSTRUTOR, OrgRole.MONITOR];

export type BirthdayKind = 'STUDENT' | 'STAFF' | 'GUARDIAN';

/** Item das rotas da EQUIPE (painel): contrato secao 2. */
export interface BirthdayItem {
  personId: number;
  studentId: number | null;
  userId: number | null;
  name: string;
  nickname: string | null;
  photo: string | null;
  day: number;
  month: number;
  /** Idade que a pessoa FAZ no aniversario deste ano (mesmo valor de `turnsAge`, conforme o contrato). */
  age: number | null;
  turnsAge: number | null;
  /** Menor de 18 anos HOJE (America/Sao_Paulo). */
  isMinor: boolean;
  kind: BirthdayKind;
  unitId: number | null;
  unitName: string | null;
  classNames: string[];
  phone: string | null;
  greetedThisYear: boolean;
}

/** Item da rota dos MEMBROS (app): nunca idade, ano de nascimento, menor nem quem optou por nao aparecer. */
export interface BirthdayWeekItem {
  personId: number;
  name: string;
  nickname: string | null;
  photo: string | null;
  day: number;
  month: number;
  isToday: boolean;
  canCongratulate: boolean;
  congratulatedByMe: boolean;
}

export interface BirthdaySettings {
  dailyDigest: boolean;
  autoGreeting: boolean;
  autoGreetingMessage: string;
  autoGreetingHour: number;
}

/** Pessoa do grupo com data de nascimento (visao interna; as rotas filtram o que sai). */
export interface GroupMember {
  personId: number;
  studentId: number | null;
  userId: number | null;
  name: string;
  nickname: string | null;
  photo: string | null;
  birthDate: Date;
  birthdayVisible: boolean;
  phone: string | null;
  kind: BirthdayKind;
  unitId: number | null;
  unitName: string | null;
  /** Todas as unidades da pessoa (matricula, acesso da equipe, dependentes): base do escopo de unidade. */
  unitIds: number[];
  classIds: number[];
  classNames: string[];
}

/** Escopo de unidade (SSOT unit-scope): sem unidade nenhuma = visivel (legado); senao precisa cruzar com o escopo. */
export function memberInScope(member: Pick<GroupMember, 'unitIds'>, scope: UnitScope): boolean {
  return !isRestricted(scope) || member.unitIds.length === 0 || member.unitIds.some((id) => scope.includes(id));
}

const uniq = <T>(values: T[]): T[] => [...new Set(values)];

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

@Injectable()
export class BirthdaysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly unitScope: UnitScopeService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // PESSOAS DO GRUPO COM ANIVERSARIO (base de tudo)
  // ---------------------------------------------------------------------------------------------

  /**
   * Quem aparece: pessoa (ficha nao mesclada/anonimizada, com data de nascimento) que neste grupo tem matricula de
   * aluno ATIVA, OU cargo/vinculo de equipe ativo (PersonRole sem revokedAt / OrganizationUser ACTIVE com papel de
   * equipe), OU e responsavel (StudentGuardian com login) de aluno ativo. O filtro de mes usa EXATAMENTE a expressao
   * do indice Person_birthDate_month_day_idx (EXTRACT(MONTH/DAY FROM "birthDate")); o dia fica para o TypeScript
   * (regra do 29/02). `personId` restringe a uma pessoa (greet/congratulate). Sempre escopado por `organizationId`.
   */
  async loadMembers(organizationId: number, opts: { months?: number[]; personId?: number } = {}): Promise<GroupMember[]> {
    const monthFilter =
      opts.months && opts.months.length > 0
        ? Prisma.sql`AND EXTRACT(MONTH FROM p."birthDate") = ANY(${uniq(opts.months)}::int[])`
        : Prisma.empty;
    const personFilter = opts.personId !== undefined ? Prisma.sql`AND p."id" = ${opts.personId}` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
      SELECT p."id" FROM "Person" p
      WHERE p."birthDate" IS NOT NULL AND p."mergedIntoId" IS NULL AND p."anonymizedAt" IS NULL
        ${monthFilter}
        ${personFilter}
        AND (
          EXISTS (SELECT 1 FROM "Student" s
                  WHERE s."personId" = p."id" AND s."organizationId" = ${organizationId}
                    AND s."status" = 'ACTIVE' AND s."anonymizedAt" IS NULL)
          OR EXISTS (SELECT 1 FROM "PersonRole" r
                     WHERE r."organizationId" = ${organizationId} AND r."revokedAt" IS NULL
                       AND (r."personId" = p."id" OR (p."userId" IS NOT NULL AND r."userId" = p."userId")))
          OR (p."userId" IS NOT NULL AND EXISTS (
                SELECT 1 FROM "OrganizationUser" ou
                WHERE ou."organizationId" = ${organizationId} AND ou."userId" = p."userId" AND ou."status" = 'ACTIVE'
                  AND ou."role" IN ('MESTRE', 'PROFESSOR', 'INSTRUTOR', 'MONITOR')))
          OR (p."userId" IS NOT NULL AND EXISTS (
                SELECT 1 FROM "StudentGuardian" g JOIN "Student" gs ON gs."id" = g."studentId"
                WHERE g."organizationId" = ${organizationId} AND g."userId" = p."userId"
                  AND gs."status" = 'ACTIVE' AND gs."anonymizedAt" IS NULL))
        )
    `);
    const ids = rows.map((r) => Number(r.id));
    if (ids.length === 0) return [];

    const persons = await this.prisma.person.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, nickname: true, photo: true, birthDate: true, birthdayVisible: true, phone: true, userId: true },
    });
    const userIds = persons.map((p) => p.userId).filter((v): v is number => v !== null);
    const activeClass = { status: 'ACTIVE' as const, class: { status: 'ACTIVE' as const } };
    const classSelect = { class: { select: { id: true, name: true } } };

    const [students, staffUsers, staffRoles, accesses, teaching, guardians] = await Promise.all([
      this.prisma.student.findMany({
        where: { organizationId, personId: { in: ids }, status: 'ACTIVE', anonymizedAt: null },
        select: {
          id: true,
          personId: true,
          unitId: true,
          phone: true,
          isStaff: true,
          unit: { select: { name: true } },
          classStudents: { where: activeClass, select: classSelect },
        },
        orderBy: { id: 'asc' },
      }),
      this.prisma.organizationUser.findMany({
        where: { organizationId, status: 'ACTIVE', userId: { in: userIds }, role: { in: STAFF_ACCESS_ROLES } },
        select: { userId: true },
      }),
      this.prisma.personRole.findMany({
        where: { organizationId, revokedAt: null, OR: [{ personId: { in: ids } }, { userId: { in: userIds } }] },
        select: { personId: true, userId: true },
      }),
      this.prisma.userUnitAccess.findMany({
        where: { organizationId, userId: { in: userIds } },
        select: { userId: true, unitId: true, unit: { select: { name: true } } },
      }),
      this.prisma.class.findMany({
        where: { organizationId, status: 'ACTIVE', teacherUserId: { in: userIds } },
        select: { id: true, name: true, teacherUserId: true },
      }),
      this.prisma.studentGuardian.findMany({
        where: { organizationId, userId: { in: userIds }, student: { status: 'ACTIVE', anonymizedAt: null } },
        select: {
          userId: true,
          phone: true,
          student: {
            select: { unitId: true, unit: { select: { name: true } }, classStudents: { where: activeClass, select: classSelect } },
          },
        },
      }),
    ]);

    const studentOf = new Map<number, (typeof students)[number]>();
    for (const s of students) if (s.personId !== null && !studentOf.has(s.personId)) studentOf.set(s.personId, s);
    const staffUserIds = new Set(staffUsers.map((u) => u.userId));
    const rolePersonIds = new Set(staffRoles.map((r) => r.personId).filter((v): v is number => v !== null));
    const roleUserIds = new Set(staffRoles.map((r) => r.userId));
    const group = <T extends { userId: number | null }>(rowsOf: T[]) => {
      const map = new Map<number, T[]>();
      for (const row of rowsOf) if (row.userId !== null) map.set(row.userId, [...(map.get(row.userId) ?? []), row]);
      return map;
    };
    const accessOf = group(accesses);
    const teachingOf = new Map<number, typeof teaching>();
    for (const c of teaching) if (c.teacherUserId !== null) teachingOf.set(c.teacherUserId, [...(teachingOf.get(c.teacherUserId) ?? []), c]);
    const guardianOf = group(guardians);

    const members: GroupMember[] = [];
    for (const p of persons) {
      if (!p.birthDate) continue;
      const student = studentOf.get(p.id);
      const uid = p.userId;
      const isStaff =
        !!student?.isStaff || rolePersonIds.has(p.id) || (uid !== null && (staffUserIds.has(uid) || roleUserIds.has(uid)));
      const dependents = uid !== null ? (guardianOf.get(uid) ?? []) : [];
      const kind: BirthdayKind = isStaff ? 'STAFF' : student ? 'STUDENT' : 'GUARDIAN';

      const units: { id: number; name: string | null }[] = [];
      const classes: { id: number; name: string }[] = [];
      const addUnit = (id: number | null | undefined, name: string | null | undefined) => {
        if (id !== null && id !== undefined && !units.some((u) => u.id === id)) units.push({ id, name: name ?? null });
      };
      const addClasses = (rowsOf: { class: { id: number; name: string } }[]) => {
        for (const c of rowsOf) if (!classes.some((x) => x.id === c.class.id)) classes.push(c.class);
      };
      if (kind !== 'GUARDIAN' && student) {
        addUnit(student.unitId, student.unit?.name);
        addClasses(student.classStudents);
      }
      if (kind === 'STAFF' && uid !== null) {
        for (const a of accessOf.get(uid) ?? []) addUnit(a.unitId, a.unit.name);
        for (const c of teachingOf.get(uid) ?? []) if (!classes.some((x) => x.id === c.id)) classes.push({ id: c.id, name: c.name });
      }
      if (kind === 'GUARDIAN') {
        for (const d of dependents) {
          addUnit(d.student.unitId, d.student.unit?.name);
          addClasses(d.student.classStudents);
        }
      }

      members.push({
        personId: p.id,
        studentId: student?.id ?? null,
        userId: uid,
        name: p.name,
        nickname: p.nickname,
        photo: p.photo,
        birthDate: p.birthDate,
        birthdayVisible: p.birthdayVisible,
        phone: p.phone ?? student?.phone ?? dependents.find((d) => d.phone)?.phone ?? null,
        kind,
        unitId: units[0]?.id ?? null,
        unitName: units[0]?.name ?? null,
        unitIds: units.map((u) => u.id),
        classIds: classes.map((c) => c.id),
        classNames: classes.map((c) => c.name),
      });
    }
    return members;
  }

  /** Pessoas do grupo que fazem aniversario em `date` (usado pelos jobs e pelo resumo). */
  async membersOnDate(organizationId: number, date: CivilDate): Promise<GroupMember[]> {
    const members = await this.loadMembers(organizationId, { months: [date.month] });
    return this.sorted(members.filter((m) => this.fallsOn(m, date)));
  }

  private fallsOn(member: GroupMember, date: CivilDate): boolean {
    const born = birthParts(member.birthDate);
    return birthdayFallsOn(born.month, born.day, date);
  }

  private sorted<T extends { name: string }>(items: T[], key: (item: T) => number = () => 0): T[] {
    return [...items].sort((a, b) => key(a) - key(b) || a.name.localeCompare(b.name, 'pt-BR'));
  }

  // ---------------------------------------------------------------------------------------------
  // EQUIPE (painel)
  // ---------------------------------------------------------------------------------------------

  private async greetedKeys(organizationId: number, personIds: number[], years: number[]): Promise<Set<string>> {
    if (personIds.length === 0) return new Set();
    const rows = await this.prisma.birthdayGreeting.findMany({
      where: { organizationId, personId: { in: personIds }, year: { in: uniq(years) } },
      select: { personId: true, year: true },
    });
    return new Set(rows.map((r) => `${r.personId}:${r.year}`));
  }

  private toItem(member: GroupMember, date: CivilDate, today: CivilDate, greeted: Set<string>): BirthdayItem {
    const turns = turnsAgeInYear(member.birthDate, date.year);
    const age = turns >= 0 && turns <= 130 ? turns : null;
    return {
      personId: member.personId,
      studentId: member.studentId,
      userId: member.userId,
      name: member.name,
      nickname: member.nickname,
      photo: member.photo,
      day: date.day,
      month: date.month,
      age,
      turnsAge: age,
      isMinor: isMinorOn(member.birthDate, today),
      kind: member.kind,
      unitId: member.unitId,
      unitName: member.unitName,
      classNames: member.classNames,
      phone: member.phone,
      greetedThisYear: greeted.has(`${member.personId}:${date.year}`),
    };
  }

  /** GET /birthdays: aniversariantes do mes (ano corrente em Sao Paulo), por dia e nome. Escopo de unidade da equipe. */
  async list(organizationId: number, user: AuthenticatedUser, query: ListBirthdaysQueryDto, now: Date = new Date()) {
    const today = saoPauloNow(now);
    const month = query.month ?? today.month;
    const scope = await this.unitScope.resolve(user, organizationId);
    if (query.unitId !== undefined) assertUnitTarget(scope, query.unitId);

    const members = (await this.loadMembers(organizationId, { months: [month] })).filter(
      (m) =>
        memberInScope(m, scope) &&
        (query.unitId === undefined || m.unitIds.includes(query.unitId)) &&
        (query.classId === undefined || m.classIds.includes(query.classId)),
    );
    const greeted = await this.greetedKeys(organizationId, members.map((m) => m.personId), [today.year]);
    const items = members.map((m) => {
      const born = birthParts(m.birthDate);
      const occurrence = occurrenceInYear(born.month, born.day, today.year);
      return this.toItem(m, { year: today.year, ...occurrence }, today, greeted);
    });
    const ordered = this.sorted(items, (i) => i.day);
    return { items: ordered, month, total: ordered.length };
  }

  /** GET /birthdays/summary: hoje, proximos 7 dias (amanha..+7, sem hoje), total do mes e de hoje. */
  async summary(organizationId: number, user: AuthenticatedUser, now: Date = new Date()) {
    const today = saoPauloNow(now);
    const scope = await this.unitScope.resolve(user, organizationId);
    const upcoming = datesFrom(addDays(today, 1), 7);
    const months = uniq([today.month, ...upcoming.map((d) => d.month)]);
    const members = (await this.loadMembers(organizationId, { months })).filter((m) => memberInScope(m, scope));
    const greeted = await this.greetedKeys(
      organizationId,
      members.map((m) => m.personId),
      uniq([today.year, ...upcoming.map((d) => d.year)]),
    );
    const on = (date: CivilDate): BirthdayItem[] =>
      this.sorted(members.filter((m) => this.fallsOn(m, date)).map((m) => this.toItem(m, date, today, greeted)));

    const todayItems = on(today);
    const next7Days = upcoming.flatMap((date) => on(date));
    const monthTotal = members.filter((m) => {
      const born = birthParts(m.birthDate);
      return occurrenceInYear(born.month, born.day, today.year).month === today.month;
    }).length;
    return { today: todayItems, next7Days, monthTotal, todayTotal: todayItems.length };
  }

  private defaultMessageFor(org: { name: string; birthdayGreetingMessage: string | null }): string {
    return org.birthdayGreetingMessage?.trim() || DEFAULT_GREETING_MESSAGE;
  }

  /**
   * POST /birthdays/:personId/greet: parabens MANUAL da equipe. Um por pessoa+ano (BirthdayGreeting MANUAL unico): se ja
   * houve, devolve `alreadyGreeted:true` e NAO reenvia. `sent` = notificacao no app gravada (a pessoa tem login ativo no
   * grupo); `whatsappUrl` so com telefone valido. Pessoa fora do grupo/escopo de unidade = 404.
   */
  async greet(organizationId: number, user: AuthenticatedUser, personId: number, dto: GreetBirthdayDto, now: Date = new Date()) {
    const scope = await this.unitScope.resolve(user, organizationId);
    const member = (await this.loadMembers(organizationId, { personId })).find((m) => memberInScope(m, scope));
    if (!member) throw new NotFoundException('Pessoa não encontrada neste grupo.');

    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { name: true, birthdayGreetingMessage: true },
    });
    const text = renderGreeting(dto.message?.trim() || this.defaultMessageFor(org), {
      nome: greetingName(member.name, member.nickname),
      grupo: org.name,
    });
    const whatsappUrl = whatsappLink(member.phone, text);
    const year = saoPauloNow(now).year;

    // Pre-checagem evita o erro de unique no log; o catch cobre a corrida entre dois envios simultaneos.
    const existing = await this.prisma.birthdayGreeting.count({ where: { organizationId, personId, year, source: 'MANUAL' } });
    if (existing > 0) return { sent: false, alreadyGreeted: true, whatsappUrl };
    try {
      await this.prisma.birthdayGreeting.create({
        data: { organizationId, personId, year, source: 'MANUAL', greeterUserId: user.id },
      });
    } catch (error) {
      if (isUniqueViolation(error)) return { sent: false, alreadyGreeted: true, whatsappUrl };
      throw error;
    }

    const notified = member.userId !== null ? await this.notifyPerson(organizationId, member.userId, text) : 0;
    if (member.userId !== null && (await this.isActiveMember(organizationId, member.userId)) && notified === 0) {
      // Falhou gravar a notificacao: desfaz o registro para a equipe poder tentar de novo.
      await this.prisma.birthdayGreeting.deleteMany({ where: { organizationId, personId, year, source: 'MANUAL' } });
      return { sent: false, alreadyGreeted: false, whatsappUrl };
    }
    await this.audit.record({
      action: AuditAction.BIRTHDAY_GREET,
      entity: AuditEntity.BIRTHDAY,
      entityId: personId,
      meta: { personId, source: 'MANUAL', notified: notified > 0, customMessage: !!dto.message?.trim(), hasWhatsapp: whatsappUrl !== null },
    });
    return { sent: notified > 0, alreadyGreeted: false, whatsappUrl };
  }

  private async isActiveMember(organizationId: number, userId: number): Promise<boolean> {
    return (await this.prisma.organizationUser.count({ where: { organizationId, userId, status: 'ACTIVE' } })) > 0;
  }

  /** Notificacao BIRTHDAY_GREETING (SSOT NotificationsService); 0 se a pessoa nao e membro ativo do grupo ou se falhar. */
  async notifyPerson(organizationId: number, userId: number, text: string): Promise<number> {
    if (!(await this.isActiveMember(organizationId, userId))) return 0;
    return this.notifications.safely('birthdayGreeting', () =>
      this.notifications.notifyUsers(organizationId, [userId], {
        title: 'Feliz aniversário! 🎉',
        body: text,
        type: BIRTHDAY_GREETING_TYPE,
      }),
    );
  }

  // ---------------------------------------------------------------------------------------------
  // MEMBROS (app)
  // ---------------------------------------------------------------------------------------------

  /** Adultos que optaram por aparecer e fazem aniversario nos proximos 7 dias (hoje incluso), com a data da ocorrencia. */
  private async weekMembers(organizationId: number, today: CivilDate): Promise<{ member: GroupMember; date: CivilDate }[]> {
    const window = datesFrom(today, 7);
    const months = uniq(window.map((d) => d.month));
    const members = await this.loadMembers(organizationId, { months });
    const out: { member: GroupMember; date: CivilDate }[] = [];
    for (const member of members) {
      // Privacidade: menor de 18 (hoje) e quem optou por nao aparecer NUNCA saem para outros membros.
      if (!member.birthdayVisible || isMinorOn(member.birthDate, today)) continue;
      const date = window.find((d) => this.fallsOn(member, d));
      if (date) out.push({ member, date });
    }
    return out;
  }

  /**
   * GET /birthdays/week (qualquer membro do grupo): proximos 7 dias incluindo hoje. So dia/mes: nada de idade, ano de
   * nascimento, telefone ou menor. O proprio usuario aparece com `canCongratulate:false`.
   */
  async week(organizationId: number, user: AuthenticatedUser, now: Date = new Date()): Promise<{ items: BirthdayWeekItem[] }> {
    const today = saoPauloNow(now);
    const entries = await this.weekMembers(organizationId, today);
    const congrats = entries.length
      ? await this.prisma.birthdayCongrats.findMany({
          where: {
            organizationId,
            giverUserId: user.id,
            personId: { in: entries.map((e) => e.member.personId) },
            year: { in: uniq(entries.map((e) => e.date.year)) },
          },
          select: { personId: true, year: true },
        })
      : [];
    const mine = new Set(congrats.map((c) => `${c.personId}:${c.year}`));
    const when = (d: CivilDate) => Date.UTC(d.year, d.month - 1, d.day);
    const ordered = entries.sort((a, b) => when(a.date) - when(b.date) || a.member.name.localeCompare(b.member.name, 'pt-BR'));
    return {
      items: ordered.map(({ member, date }) => {
        const congratulatedByMe = mine.has(`${member.personId}:${date.year}`);
        const isSelf = member.userId === user.id;
        return {
          personId: member.personId,
          name: member.name,
          nickname: member.nickname,
          photo: member.photo,
          day: date.day,
          month: date.month,
          isToday: date.year === today.year && date.month === today.month && date.day === today.day,
          canCongratulate: !isSelf && !congratulatedByMe,
          congratulatedByMe,
        };
      }),
    };
  }

  /**
   * POST /birthdays/:personId/congratulate: parabens de um colega. O alvo precisa estar na mesma lista de /week (adulto,
   * visivel, aniversario nos proximos 7 dias, do grupo); qualquer outro caso = 403 (sem distinguir inexistente de
   * oculto). Um por (aniversariante, quem deu, ano): 409 ALREADY_CONGRATULATED. Notifica o aniversariante sem idade.
   */
  async congratulate(organizationId: number, user: AuthenticatedUser, personId: number, now: Date = new Date()) {
    const today = saoPauloNow(now);
    const target = (await this.weekMembers(organizationId, today)).find((e) => e.member.personId === personId);
    if (!target) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: BIRTHDAY_NOT_VISIBLE_CODE,
        message: 'Este aniversariante não está disponível para parabéns.',
      });
    }
    if (target.member.userId === user.id) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: CANNOT_CONGRATULATE_SELF_CODE,
        message: 'Você não pode parabenizar a si mesmo.',
      });
    }
    const alreadyDone = { statusCode: 409, error: 'Conflict', code: ALREADY_CONGRATULATED_CODE, message: 'Você já parabenizou esta pessoa neste ano.' };
    if ((await this.prisma.birthdayCongrats.count({ where: { organizationId, personId, giverUserId: user.id, year: target.date.year } })) > 0) {
      throw new ConflictException(alreadyDone);
    }
    try {
      await this.prisma.birthdayCongrats.create({
        data: { organizationId, personId, giverUserId: user.id, year: target.date.year },
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(alreadyDone);
      throw error;
    }
    if (target.member.userId !== null && (await this.isActiveMember(organizationId, target.member.userId))) {
      const giver = await this.giverName(user.id);
      await this.notifications.safely('birthdayCongrats', () =>
        this.notifications.notifyUsers(organizationId, [target.member.userId!], {
          title: 'Parabéns! 🎉',
          body: `${giver} te desejou parabéns.`,
          type: BIRTHDAY_CONGRATS_TYPE,
        }),
      );
    }
    return { sent: true };
  }

  private async giverName(userId: number): Promise<string> {
    const [person, user] = await Promise.all([
      this.prisma.person.findFirst({ where: { userId }, select: { name: true, nickname: true } }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
    ]);
    return greetingName(person?.name ?? user?.name ?? 'Alguém', person?.nickname);
  }

  // ---------------------------------------------------------------------------------------------
  // CONFIGURACAO (MESTRE)
  // ---------------------------------------------------------------------------------------------

  async getSettings(organizationId: number): Promise<BirthdaySettings> {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { name: true, birthdayDailyDigest: true, birthdayAutoGreeting: true, birthdayGreetingMessage: true, birthdayGreetingHour: true },
    });
    return {
      dailyDigest: org.birthdayDailyDigest,
      autoGreeting: org.birthdayAutoGreeting,
      autoGreetingMessage: this.defaultMessageFor(org),
      autoGreetingHour: org.birthdayGreetingHour,
    };
  }

  /** PUT /birthdays/settings: atualizacao parcial. Mensagem vazia (ou igual a padrao) volta a ser a padrao (coluna nula). */
  async updateSettings(organizationId: number, dto: UpdateBirthdaySettingsDto): Promise<BirthdaySettings> {
    const data: Prisma.OrganizationUpdateInput = {};
    if (dto.dailyDigest !== undefined) data.birthdayDailyDigest = dto.dailyDigest;
    if (dto.autoGreeting !== undefined) data.birthdayAutoGreeting = dto.autoGreeting;
    if (dto.autoGreetingHour !== undefined) data.birthdayGreetingHour = dto.autoGreetingHour;
    if (dto.autoGreetingMessage !== undefined) {
      data.birthdayGreetingMessage =
        dto.autoGreetingMessage === '' || dto.autoGreetingMessage === DEFAULT_GREETING_MESSAGE ? null : dto.autoGreetingMessage;
    }
    if (Object.keys(data).length > 0) await this.prisma.organization.update({ where: { id: organizationId }, data });
    await this.audit.record({
      action: AuditAction.BIRTHDAY_SETTINGS_UPDATE,
      entity: AuditEntity.BIRTHDAY,
      entityId: organizationId,
      meta: {
        fields: Object.entries(dto).filter(([, v]) => v !== undefined).map(([k]) => k),
        dailyDigest: dto.dailyDigest,
        autoGreeting: dto.autoGreeting,
        autoGreetingHour: dto.autoGreetingHour,
      },
    });
    return this.getSettings(organizationId);
  }
}
