import { Injectable } from '@nestjs/common';
import { PersonDocumentKind, RopeStyle, StudentStatus } from '@prisma/client';
import * as QRCode from 'qrcode';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { maskPersonDocument } from '../../../shared/security/person-document';
import { LEVEL_SELECT, levelView } from '../graduations/rope';
import { personNotFound } from './person-errors';
import { PersonIdentityService } from './person-identity.service';
import { canonicalPerson, findPersonByUser } from './person-linker';

type OrgRef = { id: number; name: string };

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
    /** Fim da matricula: ainda nao registrado nesta fase (sempre null; Student.leftAt entra na fase 2). */
    until: Date | null;
    /** Matricula do grupo do token. */
    isCurrent: boolean;
  }[];
  graduations: {
    id: number;
    studentId: number;
    organization: OrgRef;
    graduatedAt: Date;
    level: { id: number; name: string; order: number; color: string | null; style: RopeStyle; colors: string[] };
    system: { id: number; name: string };
  }[];
  attendanceByGroup: { organization: OrgRef; present: number; absent: number; total: number }[];
  certificates: { id: number; title: string; issuedAt: Date | null; verificationCode: string; organization: OrgRef }[];
  /** Fase 2: matriculas/historico de outros grupos compartilhados apos transferencia aprovada. Sempre [] agora. */
  sharedFromOtherGroups: never[];
  /** OWN_GROUP = equipe do grupo (so as matriculas do grupo); SELF = a propria pessoa/responsavel (todas). */
  scope: 'OWN_GROUP' | 'SELF';
}

/** Monta a FICHA agregada por pessoa. Quem chama ja conferiu o acesso (escopo do grupo, vinculo proprio/dependente). */
@Injectable()
export class PersonFichaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: PersonIdentityService,
  ) {}

  /** Equipe do grupo: matricula `studentId` (ja conferida no grupo/unidade) -> ficha so com as matriculas DO grupo. */
  async forStaff(organizationId: number, studentId: number): Promise<Ficha> {
    const personId = await this.identity.ensurePersonForStudent(studentId);
    return this.build(personId, organizationId, 'OWN_GROUP');
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

  private async build(personId: number, currentOrganizationId: number, scope: Ficha['scope']): Promise<Ficha> {
    const person = await canonicalPerson(this.prisma, await this.prisma.person.findUnique({ where: { id: personId } }));
    if (!person) throw personNotFound();
    const students = await this.prisma.student.findMany({
      where: { personId: person.id, ...(scope === 'OWN_GROUP' ? { organizationId: currentOrganizationId } : {}) },
      select: {
        id: true,
        status: true,
        joinedAt: true,
        createdAt: true,
        organization: { select: { id: true, name: true, logo: true } },
        unit: { select: { id: true, name: true } },
      },
      orderBy: { id: 'asc' },
    });
    const ids = students.map((s) => s.id);
    const orgOf = new Map(students.map((s) => [s.id, { id: s.organization.id, name: s.organization.name }]));

    const [graduations, attendance, certificates] = await Promise.all([
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
        until: null,
        isCurrent: s.organization.id === currentOrganizationId,
      })),
      graduations: graduations.map((g) => {
        const { graduationSystem, ...level } = g.graduationLevel;
        return {
          id: g.id,
          studentId: g.studentId,
          organization: orgOf.get(g.studentId)!,
          graduatedAt: g.graduatedAt,
          level: levelView(level),
          system: graduationSystem,
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
      sharedFromOtherGroups: [],
      scope,
    };
  }
}
