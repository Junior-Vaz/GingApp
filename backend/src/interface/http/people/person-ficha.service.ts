import { Injectable } from '@nestjs/common';
import { OccurrenceKind, OccurrenceStatus, OrgRole, PersonDocumentKind, RopeStyle, StaffRole, StudentStatus } from '@prisma/client';
import { ROLE_LABEL_BR, STAFF_ROLE_RANK } from '../roles/staff-roles';
import { badgeOf, GROUP_ROLE_BADGE_SELECT, GroupRoleBadge, rolesPayload, sortBadges } from '../roles/group-roles';
import * as QRCode from 'qrcode';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { maskPersonDocument } from '../../../shared/security/person-document';
import { LEVEL_SELECT, levelView } from '../graduations/rope';
import { personNotFound } from './person-errors';
import { PersonIdentityService } from './person-identity.service';
import { canonicalPerson, findPersonByUser } from './person-linker';

type OrgRef = { id: number; name: string };

type LevelOut = { id: number; name: string; order: number; color: string | null; style: RopeStyle; colors: string[]; tipStart: string | null; tipEnd: string | null };

export interface SharedEnrollment {
  shareId: number;
  organization: OrgRef & { logoUrl: string | null };
  studentId: number;
  since: Date;
  until: Date | null;
  leftReason: string | null;
  sharedAt: Date;
  graduations: { id: number; graduatedAt: Date; level: LevelOut; system: { id: number; name: string } }[];
  attendanceByClass: { class: { id: number; name: string }; present: number; absent: number; total: number }[];
  certificates: { id: number; title: string; issuedAt: Date | null }[];
  /** Fase 4: SO para o MESTRE do grupo novo (a chave nem vem para outros papeis). */
  occurrences?: { id: number; kind: OccurrenceKind; occurredAt: Date; endsAt: Date | null; reason: string; status: OccurrenceStatus; contestNote: string | null }[];
}

/** Contrato de GET /students/:id/ficha e GET /people/me/ficha (docs/FICHA_UNICA.md secao 4). */
export interface Ficha {
  person: {
    id: number;
    gingappCode: string;
    name: string;
    nickname: string | null;
    birthDate: Date | null;
    photo: string | null;
    /** `***.***.***-XX` ou null: o CPF NUNCA sai inteiro. */
    documentMasked: string | null;
    documentKind: PersonDocumentKind | null;
  };
  enrollments: {
    studentId: number;
    organization: OrgRef & { logoUrl: string | null };
    unit: { id: number; name: string } | null;
    status: StudentStatus;
    /** joinedAt (ingresso informado) ou, na falta, a data do cadastro. */
    since: Date;
    /** Fim da matricula (Student.leftAt: saida por transferencia); null = em aberto. */
    until: Date | null;
    leftReason: string | null;
    /** Matricula do grupo do token. */
    isCurrent: boolean;
    /** Fase 3 + secao 13: cargos DO GRUPO ativos da pessoa neste grupo (selos, maior rank primeiro). */
    roles: GroupRoleBadge[];
    /** Slugs dos cargos (compatibilidade). */
    roleKeys: string[];
  }[];
  /** Fase 3: cargos ATIVOS por grupo (equipe: so o grupo do token; a propria pessoa: todos). role = perfil de acesso. */
  roles: { organization: OrgRef; role: StaffRole; groupRole: GroupRoleBadge; grantedAt: Date }[];
  graduations: {
    id: number;
    studentId: number;
    organization: OrgRef;
    graduatedAt: Date;
    level: { id: number; name: string; order: number; color: string | null; style: RopeStyle; colors: string[]; tipStart: string | null; tipEnd: string | null };
    system: { id: number; name: string };
    /** Fase 5: graduacao reconhecida a partir da corda de origem (outro grupo). */
    recognizedFromLevelId: number | null;
  }[];
  attendanceByGroup: { organization: OrgRef; present: number; absent: number; total: number }[];
  certificates: { id: number; title: string; issuedAt: Date | null; verificationCode: string; organization: OrgRef }[];
  /**
   * Fase 2: historico (somente leitura) das matriculas de OUTROS grupos compartilhado com o grupo do token apos uma
   * transferencia aprovada (EnrollmentShare ativo). So na visao da equipe (OWN_GROUP); nunca financeiro.
   */
  sharedFromOtherGroups: SharedEnrollment[];
  /** OWN_GROUP = equipe do grupo (so as matriculas do grupo); SELF = a propria pessoa/responsavel (todas). */
  scope: 'OWN_GROUP' | 'SELF';
}

/** Monta a FICHA agregada por pessoa. Quem chama ja conferiu o acesso (escopo do grupo, vinculo proprio/dependente). */
@Injectable()
export class PersonFichaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: PersonIdentityService,
    private readonly audit: AuditService,
  ) {}

  /** Equipe do grupo: matricula `studentId` (ja conferida no grupo/unidade) -> ficha so com as matriculas DO grupo. */
  async forStaff(organizationId: number, studentId: number, viewer?: { id: number; role?: OrgRole | null }): Promise<Ficha> {
    const personId = await this.identity.ensurePersonForStudent(studentId);
    return this.build(personId, organizationId, 'OWN_GROUP', viewer);
  }

  /**
   * Propria pessoa (ou responsavel): `studentId` ja conferido por resolveLink; sem ele, a matricula do proprio usuario
   * neste grupo, ou a ficha ligada ao login. 404 PERSON_NOT_FOUND se nao houver ficha (ex.: equipe sem matricula).
   */
  async personIdForSelf(organizationId: number, userId: number, studentId?: number): Promise<number> {
    if (studentId) return this.identity.ensurePersonForStudent(studentId);
    const own = await this.prisma.student.findFirst({ where: { organizationId, userId }, select: { id: true } });
    if (own) return this.identity.ensurePersonForStudent(own.id);
    const person = await findPersonByUser(this.prisma, userId);
    if (!person) throw personNotFound();
    return person.id;
  }

  async forSelf(organizationId: number, userId: number, studentId?: number): Promise<Ficha> {
    return this.build(await this.personIdForSelf(organizationId, userId, studentId), organizationId, 'SELF');
  }

  async myCode(organizationId: number, userId: number, studentId?: number) {
    const personId = await this.personIdForSelf(organizationId, userId, studentId);
    const person = await canonicalPerson(this.prisma, await this.prisma.person.findUnique({ where: { id: personId } }));
    if (!person) throw personNotFound();
    const qrDataUrl = await QRCode.toDataURL(person.gingappCode, { margin: 1, width: 240, errorCorrectionLevel: 'M' });
    return { personId: person.id, gingappCode: person.gingappCode, qrDataUrl };
  }

  private async build(personId: number, currentOrganizationId: number, scope: Ficha['scope'], viewer?: { id: number; role?: OrgRole | null }): Promise<Ficha> {
    const person = await canonicalPerson(this.prisma, await this.prisma.person.findUnique({ where: { id: personId } }));
    if (!person) throw personNotFound();
    const students = await this.prisma.student.findMany({
      where: { personId: person.id, ...(scope === 'OWN_GROUP' ? { organizationId: currentOrganizationId } : {}) },
      select: {
        id: true,
        status: true,
        joinedAt: true,
        createdAt: true,
        leftAt: true,
        leftReason: true,
        organization: { select: { id: true, name: true, logo: true } },
        unit: { select: { id: true, name: true } },
      },
      orderBy: { id: 'asc' },
    });
    const ids = students.map((s) => s.id);
    const orgOf = new Map(students.map((s) => [s.id, { id: s.organization.id, name: s.organization.name }]));

    const roleRows = await this.prisma.personRole.findMany({
      where: {
        revokedAt: null,
        OR: [{ personId: person.id }, ...(person.userId ? [{ userId: person.userId }] : [])],
        ...(scope === 'OWN_GROUP' ? { organizationId: currentOrganizationId } : {}),
      },
      select: { id: true, role: true, grantedAt: true, organization: { select: { id: true, name: true } }, groupRole: { select: GROUP_ROLE_BADGE_SELECT } },
      orderBy: { grantedAt: 'asc' },
    });
    // Secao 13: selo do cargo DO GRUPO (cargo excluido -> selo com o nome do perfil, sem id de cargo).
    const badgeOfRow = (r: (typeof roleRows)[number]): GroupRoleBadge =>
      r.groupRole
        ? badgeOf(r.groupRole)
        : { id: 0, name: ROLE_LABEL_BR[r.role], slug: r.role.toLowerCase(), color: null, icon: null, accessRole: r.role, rank: STAFF_ROLE_RANK[r.role] * 10 };
    const rolesOfOrg = (organizationId: number) => sortBadges(roleRows.filter((r) => r.organization.id === organizationId).map(badgeOfRow));
    const [graduations, attendance, certificates] = await Promise.all([
      this.prisma.studentGraduation.findMany({
        where: { studentId: { in: ids } },
        select: {
          id: true,
          studentId: true,
          graduatedAt: true,
          recognizedFromLevelId: true,
          graduationLevel: { select: { ...LEVEL_SELECT, graduationSystem: { select: { id: true, name: true } } } },
        },
        orderBy: [{ graduatedAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.attendance.groupBy({ by: ['studentId', 'present'], where: { studentId: { in: ids } }, _count: { _all: true } }),
      this.prisma.certificate.findMany({
        where: { studentId: { in: ids } },
        select: { id: true, studentId: true, title: true, issuedAt: true, verificationCode: true },
        orderBy: { id: 'asc' },
      }),
    ]);

    const attendanceByOrg = new Map<number, { organization: OrgRef; present: number; absent: number; total: number }>();
    for (const row of attendance) {
      const org = orgOf.get(row.studentId)!;
      const entry = attendanceByOrg.get(org.id) ?? { organization: org, present: 0, absent: 0, total: 0 };
      if (row.present) entry.present += row._count._all;
      else entry.absent += row._count._all;
      entry.total += row._count._all;
      attendanceByOrg.set(org.id, entry);
    }

    return {
      person: {
        id: person.id,
        gingappCode: person.gingappCode,
        name: person.name,
        nickname: person.nickname,
        birthDate: person.birthDate,
        photo: person.photo,
        documentMasked: maskPersonDocument(person.documentLast4),
        documentKind: person.documentKind,
      },
      enrollments: students.map((s) => ({
        studentId: s.id,
        organization: { id: s.organization.id, name: s.organization.name, logoUrl: s.organization.logo ?? null },
        unit: s.unit,
        status: s.status,
        since: s.joinedAt ?? s.createdAt,
        until: s.leftAt,
        leftReason: s.leftReason,
        isCurrent: s.organization.id === currentOrganizationId,
        ...rolesPayload(rolesOfOrg(s.organization.id)),
      })),
      roles: roleRows.map((r) => ({ organization: r.organization, role: r.role, groupRole: badgeOfRow(r), grantedAt: r.grantedAt })),
      graduations: graduations.map((g) => {
        const { graduationSystem, ...level } = g.graduationLevel;
        return {
          id: g.id,
          studentId: g.studentId,
          organization: orgOf.get(g.studentId)!,
          graduatedAt: g.graduatedAt,
          level: levelView(level),
          system: graduationSystem,
          recognizedFromLevelId: g.recognizedFromLevelId,
        };
      }),
      attendanceByGroup: [...attendanceByOrg.values()],
      certificates: certificates.map((c) => ({
        id: c.id,
        title: c.title,
        issuedAt: c.issuedAt,
        verificationCode: c.verificationCode,
        organization: orgOf.get(c.studentId)!,
      })),
      sharedFromOtherGroups: scope === 'OWN_GROUP' ? await this.shared(person.id, currentOrganizationId, viewer) : [],
      scope,
    };
  }

  /** Matriculas de outros grupos compartilhadas com `organizationId` (EnrollmentShare sem revokedAt). */
  private async shared(personId: number, organizationId: number, viewer?: { id: number; role?: OrgRole | null }): Promise<SharedEnrollment[]> {
    const shares = await this.prisma.enrollmentShare.findMany({
      where: { personId, toOrganizationId: organizationId, revokedAt: null },
      orderBy: { id: 'asc' },
    });
    if (shares.length === 0) return [];
    const ids = shares.map((s) => s.fromStudentId);
    const [students, graduations, attendances, certificates] = await Promise.all([
      this.prisma.student.findMany({
        where: { id: { in: ids } },
        select: { id: true, joinedAt: true, createdAt: true, leftAt: true, leftReason: true, organization: { select: { id: true, name: true, logo: true } } },
      }),
      this.prisma.studentGraduation.findMany({
        where: { studentId: { in: ids } },
        select: {
          id: true,
          studentId: true,
          graduatedAt: true,
          graduationLevel: { select: { ...LEVEL_SELECT, graduationSystem: { select: { id: true, name: true } } } },
        },
        orderBy: [{ graduatedAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.attendance.findMany({
        where: { studentId: { in: ids } },
        select: { studentId: true, present: true, lesson: { select: { class: { select: { id: true, name: true } } } } },
      }),
      this.prisma.certificate.findMany({
        where: { studentId: { in: ids } },
        select: { id: true, studentId: true, title: true, issuedAt: true },
        orderBy: { id: 'asc' },
      }),
    ]);
    const byId = new Map(students.map((s) => [s.id, s]));
    // Fase 4: ocorrencias dos grupos anteriores SO para o MESTRE do grupo novo (somente leitura; retratadas nao entram).
    // Toda leitura que devolve alguma e auditada (OCCURRENCE_READ_SHARED).
    const isMestre = viewer?.role === OrgRole.MESTRE;
    const occurrences = isMestre
      ? await this.prisma.occurrence.findMany({
          where: { studentId: { in: ids }, status: { not: OccurrenceStatus.RETRACTED } },
          select: { id: true, studentId: true, kind: true, occurredAt: true, endsAt: true, reason: true, status: true, contestNote: true },
          orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        })
      : [];
    if (occurrences.length > 0) {
      await this.audit.record({
        organizationId,
        action: AuditAction.OCCURRENCE_READ_SHARED,
        entity: AuditEntity.OCCURRENCE,
        entityId: personId,
        meta: { personId, occurrenceIds: occurrences.map((o) => o.id), fromStudentIds: ids },
      });
    }
    return shares
      .filter((sh) => byId.has(sh.fromStudentId))
      .map((sh) => {
        const s = byId.get(sh.fromStudentId)!;
        const perClass = new Map<number, { class: { id: number; name: string }; present: number; absent: number; total: number }>();
        for (const a of attendances.filter((x) => x.studentId === s.id)) {
          const cls = a.lesson.class;
          const entry = perClass.get(cls.id) ?? { class: { id: cls.id, name: cls.name }, present: 0, absent: 0, total: 0 };
          if (a.present) entry.present++;
          else entry.absent++;
          entry.total++;
          perClass.set(cls.id, entry);
        }
        return {
          shareId: sh.id,
          organization: { id: s.organization.id, name: s.organization.name, logoUrl: s.organization.logo ?? null },
          studentId: s.id,
          since: s.joinedAt ?? s.createdAt,
          until: s.leftAt,
          leftReason: s.leftReason,
          sharedAt: sh.grantedAt,
          graduations: graduations
            .filter((g) => g.studentId === s.id)
            .map((g) => {
              const { graduationSystem, ...level } = g.graduationLevel;
              return { id: g.id, graduatedAt: g.graduatedAt, level: levelView(level), system: graduationSystem };
            }),
          attendanceByClass: [...perClass.values()],
          certificates: certificates.filter((c) => c.studentId === s.id).map((c) => ({ id: c.id, title: c.title, issuedAt: c.issuedAt })),
          ...(isMestre
            ? { occurrences: occurrences.filter((o) => o.studentId === s.id).map(({ studentId: _sid, ...o }) => (void _sid, o)) }
            : {}),
        };
      });
  }

  /** PATCH /people/me: a propria pessoa (login ligado a ficha) edita a identidade; nome/foto/contato vao as matriculas. */
  async updateMyPerson(
    userId: number,
    dto: { name?: string; nickname?: string | null; photo?: string | null; phone?: string | null; email?: string | null },
  ) {
    const person = await findPersonByUser(this.prisma, userId);
    if (!person) throw personNotFound();
    const data = {
      name: dto.name?.trim(),
      nickname: dto.nickname === undefined ? undefined : dto.nickname?.trim() || null,
      photo: dto.photo,
      phone: dto.phone === undefined ? undefined : dto.phone?.trim() || null,
      email: dto.email === undefined ? undefined : dto.email?.trim().toLowerCase() || null,
    };
    const updated = await this.prisma.$transaction(async (tx) => {
      const p = await tx.person.update({ where: { id: person.id }, data });
      await tx.student.updateMany({
        where: { personId: person.id },
        data: { name: data.name, photo: data.photo, phone: data.phone, email: data.email },
      });
      // O login (User) mostra o mesmo nome/telefone no cabecalho e em GET /auth/me: sem isto o perfil editado
      // continuaria com o nome antigo na sessao. So atualiza o que veio no DTO (email e foto seguem o proprio fluxo).
      if (data.name !== undefined || data.phone !== undefined) {
        await tx.user.update({
          where: { id: userId },
          data: { ...(data.name !== undefined ? { name: data.name } : {}), ...(data.phone !== undefined ? { phone: data.phone } : {}) },
        });
      }
      return p;
    });
    await this.audit.record({
      action: AuditAction.PERSON_PROFILE_UPDATE,
      entity: AuditEntity.PERSON,
      entityId: person.id,
      meta: { fields: Object.entries(dto).filter(([, v]) => v !== undefined).map(([k]) => k) },
    });
    return {
      person: {
        id: updated.id,
        gingappCode: updated.gingappCode,
        name: updated.name,
        nickname: updated.nickname,
        birthDate: updated.birthDate,
        photo: updated.photo,
        documentMasked: maskPersonDocument(updated.documentLast4),
        documentKind: updated.documentKind,
      },
    };
  }
}
