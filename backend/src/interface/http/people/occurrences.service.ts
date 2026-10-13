import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Occurrence, OccurrenceKind, OccurrenceStatus, OrgRole, StudentStatus } from '@prisma/client';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { decidingAs, personDeciders, personIdsVisibleTo } from './person-deciders';
import { PersonIdentityService } from './person-identity.service';

export const OCCURRENCE_KIND_BR: Record<OccurrenceKind, string> = {
  ADVERTENCIA: 'advertência',
  SUSPENSAO: 'suspensão',
  EXPULSAO: 'expulsão',
  OUTRA: 'ocorrência',
};

const conflict = (code: string, message: string) => new ConflictException({ statusCode: 409, error: 'Conflict', code, message });
const badRequest = (code: string, message: string) => new BadRequestException({ statusCode: 400, error: 'Bad Request', code, message });
const OCCURRENCE_NOT_FOUND = 'Ocorrência não encontrada.';

export interface CreateOccurrenceInput {
  kind: OccurrenceKind;
  occurredAt: string;
  reason: string;
  endsAt?: string;
  expel?: boolean;
}

/** Visao do MESTRE (do proprio grupo). */
function staffView(o: Occurrence & { createdBy?: { id: number; name: string } | null }) {
  return {
    id: o.id,
    kind: o.kind,
    occurredAt: o.occurredAt,
    endsAt: o.endsAt,
    reason: o.reason,
    status: o.status,
    expelledEnrollment: o.expelledEnrollment,
    createdAt: o.createdAt,
    createdBy: o.createdBy ?? null,
    contestedAt: o.contestedAt,
    contestNote: o.contestNote,
    retractedAt: o.retractedAt,
    retractNote: o.retractNote,
  };
}

/**
 * OCORRENCIAS (ficha unica, Fase 4 - docs/FICHA_UNICA.md secao 6). Dado SENSIVEL: le/escreve so o MESTRE do grupo da
 * matricula (rotas com MestreOnlyGuard); o MESTRE do grupo novo le as dos grupos anteriores so via EnrollmentShare ativo
 * (PersonFichaService, auditado); a pessoa (ou o responsavel do menor) ve e contesta. Toda escrita e auditada.
 */
@Injectable()
export class OccurrencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly identity: PersonIdentityService,
  ) {}

  private async student(organizationId: number, studentId: number) {
    const student = await this.prisma.student.findFirst({ where: { id: studentId, organizationId } });
    if (!student) throw new NotFoundException('Aluno não encontrado.');
    return student;
  }

  async list(organizationId: number, studentId: number) {
    await this.student(organizationId, studentId);
    const rows = await this.prisma.occurrence.findMany({ where: { organizationId, studentId }, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }] });
    return this.withAuthors(rows);
  }

  async create(organizationId: number, userId: number, studentId: number, input: CreateOccurrenceInput) {
    const student = await this.student(organizationId, studentId);
    if (input.expel && input.kind !== OccurrenceKind.EXPULSAO) {
      throw badRequest('EXPEL_ONLY_FOR_EXPULSION', 'Só uma ocorrência de expulsão pode encerrar a matrícula.');
    }
    if (input.endsAt && input.kind !== OccurrenceKind.SUSPENSAO) {
      throw badRequest('ENDS_AT_ONLY_FOR_SUSPENSION', 'A data de fim vale só para suspensão.');
    }
    const occurredAt = new Date(`${input.occurredAt.slice(0, 10)}T00:00:00.000Z`);
    const endsAt = input.endsAt ? new Date(`${input.endsAt.slice(0, 10)}T00:00:00.000Z`) : null;
    if (endsAt && endsAt.getTime() < occurredAt.getTime()) throw badRequest('INVALID_ENDS_AT', 'O fim da suspensão é antes do início.');
    const personId = await this.identity.ensurePersonForStudent(student.id);
    const expel = input.expel === true;
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.occurrence.create({
        data: {
          organizationId,
          studentId,
          personId,
          kind: input.kind,
          occurredAt,
          endsAt,
          reason: input.reason.trim(),
          expelledEnrollment: expel,
          createdByUserId: userId,
        },
      });
      if (expel) {
        // Expulsao: encerra a matricula (Ex-aluno) e as turmas dela; o vinculo ALUNO do login cai pela regra de aluno inativo.
        await tx.student.update({
          where: { id: studentId },
          data: { status: StudentStatus.FORMER, leftAt: student.leftAt ?? new Date(), leftReason: 'EXPELLED' },
        });
        await tx.classStudent.updateMany({ where: { studentId, status: 'ACTIVE' }, data: { status: 'INACTIVE' } });
      }
      return row;
    });
    await this.audit.record({
      organizationId,
      action: AuditAction.OCCURRENCE_CREATE,
      entity: AuditEntity.OCCURRENCE,
      entityId: created.id,
      meta: { studentId, kind: input.kind, expel },
    });
    // A pessoa (ou o responsavel do menor) e avisada para poder ver e contestar. Sem o motivo no aviso (vai no app).
    const deciders = await personDeciders(this.prisma, personId);
    await this.notifications.safely('occurrence', () =>
      deciders.userIds.length
        ? this.notifications.notifyUsers(organizationId, deciders.userIds, {
            type: 'OCCURRENCE_REGISTERED',
            title: 'Registro na sua ficha',
            body: `O grupo registrou uma ${OCCURRENCE_KIND_BR[input.kind]} na ficha. Você pode ver e contestar no app.`,
          })
        : Promise.resolve(0),
    );
    const [view] = await this.withAuthors([created]);
    return view!;
  }

  async retract(organizationId: number, userId: number, studentId: number, occurrenceId: number, note?: string) {
    await this.student(organizationId, studentId);
    const row = await this.prisma.occurrence.findFirst({ where: { id: occurrenceId, organizationId, studentId } });
    if (!row) throw new NotFoundException(OCCURRENCE_NOT_FOUND);
    const { count } = await this.prisma.occurrence.updateMany({
      where: { id: occurrenceId, status: { not: OccurrenceStatus.RETRACTED } },
      data: { status: OccurrenceStatus.RETRACTED, retractedAt: new Date(), retractedByUserId: userId, retractNote: note?.trim() || null },
    });
    if (count !== 1) throw conflict('OCCURRENCE_ALREADY_RETRACTED', 'Esta ocorrência já foi retratada.');
    await this.audit.record({ organizationId, action: AuditAction.OCCURRENCE_RETRACT, entity: AuditEntity.OCCURRENCE, entityId: occurrenceId, meta: { studentId } });
    const [view] = await this.withAuthors([await this.prisma.occurrence.findUniqueOrThrow({ where: { id: occurrenceId } })]);
    return view!;
  }

  // -------------------------------------------------------------------------------------------- pessoa

  async listMine(userId: number) {
    const personIds = await personIdsVisibleTo(this.prisma, userId);
    if (personIds.length === 0) return [];
    const rows = await this.prisma.occurrence.findMany({
      where: { personId: { in: personIds } },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: 200,
    });
    return this.personViews(rows, userId);
  }

  async contest(userId: number, occurrenceId: number, note: string) {
    const row = await this.prisma.occurrence.findUnique({ where: { id: occurrenceId } });
    if (!row?.personId) throw new NotFoundException(OCCURRENCE_NOT_FOUND);
    const as = decidingAs(await personDeciders(this.prisma, row.personId), userId);
    if (!as) throw new NotFoundException(OCCURRENCE_NOT_FOUND);
    const { count } = await this.prisma.occurrence.updateMany({
      where: { id: occurrenceId, status: OccurrenceStatus.ACTIVE },
      data: { status: OccurrenceStatus.CONTESTED, contestedAt: new Date(), contestedByUserId: userId, contestNote: note.trim() },
    });
    if (count !== 1) throw conflict('OCCURRENCE_NOT_CONTESTABLE', 'Esta ocorrência já foi contestada ou retratada.');
    await this.audit.record({
      organizationId: row.organizationId,
      action: AuditAction.OCCURRENCE_CONTEST,
      entity: AuditEntity.OCCURRENCE,
      entityId: occurrenceId,
      meta: { decidingAs: as },
    });
    const mestres = await this.prisma.organizationUser.findMany({
      where: { organizationId: row.organizationId, role: OrgRole.MESTRE, status: 'ACTIVE' },
      select: { userId: true },
    });
    await this.notifications.safely('occurrence-contest', () =>
      this.notifications.notifyUsers(row.organizationId, mestres.map((m) => m.userId), {
        type: 'OCCURRENCE_CONTESTED',
        title: 'Ocorrência contestada',
        body: 'Uma ocorrência registrada pelo grupo foi contestada. Veja na ficha do aluno.',
      }),
    );
    const [view] = await this.personViews([await this.prisma.occurrence.findUniqueOrThrow({ where: { id: occurrenceId } })], userId);
    return view!;
  }

  private async personViews(rows: Occurrence[], userId: number) {
    const orgIds = [...new Set(rows.map((r) => r.organizationId))];
    const personIds = [...new Set(rows.map((r) => r.personId!).filter(Boolean))];
    const [orgs, people] = await Promise.all([
      this.prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true, logo: true } }),
      this.prisma.person.findMany({ where: { id: { in: personIds } }, select: { id: true, name: true } }),
    ]);
    const orgOf = new Map(orgs.map((o) => [o.id, { id: o.id, name: o.name, logoUrl: o.logo ?? null }]));
    const personOf = new Map(people.map((p) => [p.id, p]));
    const asByPerson = new Map<number, 'SELF' | 'GUARDIAN' | null>();
    for (const pid of personIds) asByPerson.set(pid, decidingAs(await personDeciders(this.prisma, pid), userId));
    return rows.map((r) => {
      const as = asByPerson.get(r.personId!) ?? null;
      return {
        id: r.id,
        kind: r.kind,
        occurredAt: r.occurredAt,
        endsAt: r.endsAt,
        reason: r.reason,
        status: r.status,
        organization: orgOf.get(r.organizationId)!,
        person: personOf.get(r.personId!) ?? null,
        contestedAt: r.contestedAt,
        contestNote: r.contestNote,
        retractedAt: r.retractedAt,
        canContest: as !== null && r.status === OccurrenceStatus.ACTIVE,
        decidingAs: as,
      };
    });
  }

  private async withAuthors(rows: Occurrence[]) {
    const ids = [...new Set(rows.map((r) => r.createdByUserId).filter((v): v is number => v !== null))];
    const users = ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    return rows.map((r) => staffView({ ...r, createdBy: r.createdByUserId ? (byId.get(r.createdByUserId) ?? null) : null }));
  }
}
