import { ForbiddenException, Injectable } from '@nestjs/common';
import { OrgRole, Prisma, StudentStatus, TransferContestReason, TransferStatus } from '@prisma/client';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { hashPersonDocument, canonicalDocument, parseCpf } from '../../../shared/security/person-document';
import { NotificationsService } from '../notifications/notifications.service';
import { decidingAs, personDeciders, personIdsVisibleTo } from './person-deciders';
import { normalizeGingappCode } from './gingapp-code';
import {
  PersonErrorCode,
  personBadRequest,
  personConflict,
  personNotFound,
  transferNotFound,
} from './person-errors';
import { canonicalPerson, findPersonByCode, findPersonByHash } from './person-linker';

/** Prazo para a pessoa decidir (dias; TRANSFER_EXPIRY_DAYS, padrao 14) e janela de contestacao do grupo antigo
 * (dias a partir do pedido; TRANSFER_CONTEST_DAYS, padrao 7). Lidos a cada pedido. */
export function transferExpiryDays(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.TRANSFER_EXPIRY_DAYS);
  return Number.isInteger(n) && n >= 1 && n <= 90 ? n : 14;
}
export function transferContestDays(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.TRANSFER_CONTEST_DAYS);
  return Number.isInteger(n) && n >= 1 && n <= 60 ? n : 7;
}
const DAY_MS = 86_400_000;

/** O que o grupo novo passa a ver da(s) matricula(s) antiga(s) apos a aprovacao (nunca financeiro). */
export const SHARED_ON_APPROVAL = ['ATTENDANCE', 'GRADUATIONS', 'CERTIFICATES'] as const;

const OPEN_FOR_CONTEST: TransferStatus[] = [TransferStatus.PENDING_PERSON, TransferStatus.APPROVED];

const REQUEST_INCLUDE = {
  person: { select: { id: true, name: true, nickname: true, photo: true, gingappCode: true, birthDate: true, userId: true } },
  fromOrganization: { select: { id: true, name: true, logo: true } },
  toOrganization: { select: { id: true, name: true, logo: true } },
  contests: { orderBy: { id: 'asc' as const } },
} satisfies Prisma.TransferRequestInclude;

type RequestRow = Prisma.TransferRequestGetPayload<{ include: typeof REQUEST_INCLUDE }>;

export interface CreateTransferInput {
  personId?: number;
  gingappCode?: string;
  document?: string;
  fromOrganizationId?: number;
  unitId?: number;
  note?: string;
}

/**
 * TRANSFERENCIA entre grupos (ficha unica, Fase 2 - docs/FICHA_UNICA.md secao 4). O MESTRE do grupo novo pede; a
 * PESSOA (ou o responsavel, se menor) aprova ou recusa pelo app; o grupo antigo e avisado e pode CONTESTAR pendencias
 * ate `contestUntil` sem bloquear nada. Na aprovacao: matricula nova ACTIVE no grupo novo (mesma Person, login ganha o
 * grupo), matricula antiga FORMER (leftAt, leftReason TRANSFER) e EnrollmentShare (o grupo novo le o historico antigo,
 * nunca o financeiro).
 */
@Injectable()
export class TransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ------------------------------------------------------------------------------------------------ equipe

  async create(organizationId: number, userId: number, input: CreateTransferInput, now = new Date()) {
    const person = await this.resolveTarget(input);
    const enrollments = await this.prisma.student.findMany({
      where: { personId: person.id },
      select: { id: true, organizationId: true, status: true, organization: { select: { id: true, name: true } } },
      orderBy: { id: 'desc' },
    });
    const here = enrollments.find((s) => s.organizationId === organizationId);
    if (here) throw personConflict(PersonErrorCode.PERSON_ALREADY_IN_GROUP, { studentId: here.id, studentStatus: here.status });
    const elsewhere = enrollments.filter((s) => s.organizationId !== organizationId);
    if (elsewhere.length === 0) throw personConflict(PersonErrorCode.PERSON_NOT_ENROLLED_ELSEWHERE);

    let from = input.fromOrganizationId ? elsewhere.find((s) => s.organizationId === input.fromOrganizationId) : undefined;
    if (!from) {
      const active = elsewhere.filter((s) => s.status === StudentStatus.ACTIVE);
      const choices = active.length > 0 ? active : elsewhere;
      const orgs = [...new Map(choices.map((s) => [s.organization.id, s.organization])).values()];
      // Varias matriculas ATIVAS em grupos diferentes (ou fromOrganizationId que nao confere): o Mestre escolhe.
      if (input.fromOrganizationId || orgs.length > 1) {
        throw personBadRequest(PersonErrorCode.FROM_ORGANIZATION_REQUIRED, { organizations: orgs });
      }
      // Sem matricula ativa em lugar nenhum (saiu do grupo antigo): origem = a matricula mais recente.
      from = choices[0]!;
    }

    if (input.unitId) {
      const unit = await this.prisma.unit.findFirst({ where: { id: input.unitId, organizationId }, select: { id: true } });
      if (!unit) throw personBadRequest(PersonErrorCode.TRANSFER_INVALID_UNIT);
    }

    const { request, created } = await this.prisma.$transaction(async (tx) => {
      // Trava a ficha: dois pedidos simultaneos para a mesma pessoa+grupo viram um so (idempotencia).
      await tx.$queryRaw`SELECT id FROM "Person" WHERE id = ${person.id} FOR UPDATE`;
      const open = await tx.transferRequest.findFirst({
        where: { personId: person.id, toOrganizationId: organizationId, status: TransferStatus.PENDING_PERSON },
      });
      if (open) return { request: open, created: false };
      const request = await tx.transferRequest.create({
        data: {
          personId: person.id,
          fromOrganizationId: from!.organizationId,
          fromStudentId: from!.id,
          toOrganizationId: organizationId,
          toUnitId: input.unitId ?? null,
          requestedByUserId: userId,
          requestedAt: now,
          expiresAt: new Date(now.getTime() + transferExpiryDays() * DAY_MS),
          contestUntil: new Date(now.getTime() + transferContestDays() * DAY_MS),
          note: input.note?.trim() || null,
        },
      });
      return { request, created: true };
    });

    const row = await this.load(request.id);
    if (created) {
      await this.audit.record({
        organizationId,
        action: AuditAction.TRANSFER_REQUEST,
        entity: AuditEntity.TRANSFER,
        entityId: request.id,
        meta: { personId: person.id, fromOrganizationId: request.fromOrganizationId },
      });
      const deciders = await this.deciders(person.id);
      await this.notify(null, deciders.userIds, {
        type: 'TRANSFER_REQUEST',
        title: 'Pedido de transferência',
        body: `${row.toOrganization.name} pediu a transferência de ${deciders.minor ? row.person.name : 'você'} vindo de ${row.fromOrganization.name}. Abra o app para aprovar ou recusar.`,
      });
      await this.notify(request.fromOrganizationId, await this.mestres(request.fromOrganizationId), {
        type: 'TRANSFER_REQUEST',
        title: 'Transferência solicitada',
        body: `${row.toOrganization.name} pediu a transferência de ${row.person.name}. Você pode registrar pendências até ${this.date(row.contestUntil)}.`,
      });
    }
    return { created, transfer: this.staffView(row, organizationId, now, await this.unitsOf([row])) };
  }

  async list(organizationId: number, direction?: 'sent' | 'received', now = new Date()) {
    const where: Prisma.TransferRequestWhereInput =
      direction === 'sent'
        ? { toOrganizationId: organizationId }
        : direction === 'received'
          ? { fromOrganizationId: organizationId }
          : { OR: [{ toOrganizationId: organizationId }, { fromOrganizationId: organizationId }] };
    const rows = await this.prisma.transferRequest.findMany({ where, include: REQUEST_INCLUDE, orderBy: { id: 'desc' }, take: 200 });
    const units = await this.unitsOf(rows);
    return rows.map((r) => this.staffView(r, organizationId, now, units));
  }

  async get(organizationId: number, id: number, now = new Date()) {
    const row = await this.visibleToGroup(organizationId, id);
    return this.staffView(row, organizationId, now, await this.unitsOf([row]));
  }

  async cancel(organizationId: number, userId: number, id: number, now = new Date()) {
    const row = await this.visibleToGroup(organizationId, id);
    if (row.toOrganizationId !== organizationId) throw new ForbiddenException('Só o grupo que pediu pode cancelar.');
    const { count } = await this.prisma.transferRequest.updateMany({
      where: { id, status: TransferStatus.PENDING_PERSON },
      data: { status: TransferStatus.CANCELLED, decidedAt: now, decidedByUserId: userId },
    });
    if (count !== 1) throw personConflict(PersonErrorCode.TRANSFER_NOT_PENDING);
    await this.audit.record({ organizationId, action: AuditAction.TRANSFER_CANCEL, entity: AuditEntity.TRANSFER, entityId: id });
    const deciders = await this.deciders(row.personId);
    await this.notify(null, deciders.userIds, {
      type: 'TRANSFER_CANCELLED',
      title: 'Pedido de transferência cancelado',
      body: `${row.toOrganization.name} cancelou o pedido de transferência.`,
    });
    const updated = await this.load(id);
    return this.staffView(updated, organizationId, now, await this.unitsOf([updated]));
  }

  async contest(organizationId: number, userId: number, id: number, dto: { reason: TransferContestReason; note?: string }, now = new Date()) {
    const row = await this.visibleToGroup(organizationId, id);
    if (row.fromOrganizationId !== organizationId) throw new ForbiddenException('Só o grupo de origem pode contestar.');
    if (!OPEN_FOR_CONTEST.includes(row.status) || now.getTime() > row.contestUntil.getTime()) {
      throw personConflict(PersonErrorCode.TRANSFER_CONTEST_CLOSED);
    }
    const contest = await this.prisma.transferContest.create({
      data: { requestId: id, organizationId, byUserId: userId, reason: dto.reason, note: dto.note?.trim() || null },
    });
    await this.audit.record({
      organizationId,
      action: AuditAction.TRANSFER_CONTEST,
      entity: AuditEntity.TRANSFER,
      entityId: id,
      meta: { reason: dto.reason },
    });
    const body = `${row.fromOrganization.name} registrou uma pendência na transferência (${CONTEST_LABEL[dto.reason]}). Isso não impede a transferência.`;
    const deciders = await this.deciders(row.personId);
    await this.notify(null, deciders.userIds, { type: 'TRANSFER_CONTESTED', title: 'Pendência registrada pelo grupo', body });
    await this.notify(row.toOrganizationId, await this.mestres(row.toOrganizationId), {
      type: 'TRANSFER_CONTESTED',
      title: 'Pendência registrada pelo grupo de origem',
      body,
    });
    return { id: contest.id, reason: contest.reason, note: contest.note, createdAt: contest.createdAt, organization: this.org(row.fromOrganization) };
  }

  // ------------------------------------------------------------------------------------------------ pessoa

  /** Pedidos para a propria pessoa (Person.userId) e para os dependentes (StudentGuardian.userId, qualquer grupo). */
  async listMine(userId: number, now = new Date()) {
    const personIds = await this.personIdsVisibleTo(userId);
    if (personIds.length === 0) return [];
    const rows = await this.prisma.transferRequest.findMany({
      where: { personId: { in: personIds } },
      include: REQUEST_INCLUDE,
      orderBy: { id: 'desc' },
      take: 100,
    });
    const units = await this.unitsOf(rows);
    const out = [];
    for (const r of rows) out.push(await this.personView(r, userId, now, units));
    return out;
  }

  async decide(userId: number, id: number, approve: boolean, now = new Date()) {
    const row = await this.prisma.transferRequest.findUnique({ where: { id }, include: REQUEST_INCLUDE });
    if (!row) throw transferNotFound();
    const deciders = await this.deciders(row.personId);
    const decidingAs = this.decidingAs(deciders, userId);
    // Sem direito de decidir (outra pessoa, aluno de outro grupo, menor decidindo por si) = o MESMO 404.
    if (!decidingAs) throw transferNotFound();
    if (row.status !== TransferStatus.PENDING_PERSON) throw personConflict(PersonErrorCode.TRANSFER_NOT_PENDING);
    if (row.expiresAt.getTime() < now.getTime()) {
      await this.expireOne(row.id, row.toOrganizationId, now);
      throw personConflict(PersonErrorCode.TRANSFER_EXPIRED);
    }
    if (approve) await this.approve(row, userId, now);
    else {
      const { count } = await this.prisma.transferRequest.updateMany({
        where: { id, status: TransferStatus.PENDING_PERSON },
        data: { status: TransferStatus.DECLINED, decidedAt: now, decidedByUserId: userId },
      });
      if (count !== 1) throw personConflict(PersonErrorCode.TRANSFER_NOT_PENDING);
      await this.audit.record({
        organizationId: null,
        action: AuditAction.TRANSFER_DECLINE,
        entity: AuditEntity.TRANSFER,
        entityId: id,
        meta: { decidingAs, toOrganizationId: row.toOrganizationId },
      });
      await this.notify(row.toOrganizationId, await this.mestres(row.toOrganizationId), {
        type: 'TRANSFER_DECLINED',
        title: 'Transferência recusada',
        body: `O pedido de transferência de ${row.person.name} foi recusado.`,
      });
    }
    const updated = await this.load(id);
    return this.personView(updated, userId, now, await this.unitsOf([updated]));
  }

  private async approve(row: RequestRow, userId: number, now: Date): Promise<void> {
    const toOrg = row.toOrganizationId;
    const newStudentId = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.transferRequest.updateMany({
        where: { id: row.id, status: TransferStatus.PENDING_PERSON },
        data: { status: TransferStatus.APPROVED, decidedAt: now, decidedByUserId: userId },
      });
      if (count !== 1) throw personConflict(PersonErrorCode.TRANSFER_NOT_PENDING);
      const person = (await canonicalPerson(tx, await tx.person.findUnique({ where: { id: row.personId } })))!;
      const already = await tx.student.findFirst({ where: { personId: person.id, organizationId: toOrg }, select: { id: true, status: true } });
      if (already) throw personConflict(PersonErrorCode.PERSON_ALREADY_IN_GROUP, { studentId: already.id, studentStatus: already.status });
      const from = row.fromStudentId
        ? await tx.student.findUnique({ where: { id: row.fromStudentId }, include: { guardians: true } })
        : null;

      // Login: a pessoa ganha o grupo novo (vinculo ALUNO), se ainda nao tem matricula nele com o mesmo User.
      let loginUserId: number | null = null;
      if (person.userId && (await tx.student.count({ where: { organizationId: toOrg, userId: person.userId } })) === 0) {
        loginUserId = person.userId;
        await this.ensureMembership(tx, toOrg, person.userId, OrgRole.ALUNO);
      }
      const student = await tx.student.create({
        data: {
          organizationId: toOrg,
          unitId: row.toUnitId,
          personId: person.id,
          userId: loginUserId,
          name: person.name,
          birthDate: person.birthDate ?? from?.birthDate ?? null,
          photo: person.photo ?? from?.photo ?? null,
          phone: person.phone ?? from?.phone ?? null,
          email: person.email ?? from?.email ?? null,
          document: from?.document ?? null,
          status: StudentStatus.ACTIVE,
          joinedAt: now,
        },
      });
      // Responsaveis do grupo antigo passam a acompanhar o aluno no grupo novo (sem o consentimento publico, que e por grupo).
      for (const g of from?.guardians ?? []) {
        await tx.studentGuardian.create({
          data: { organizationId: toOrg, studentId: student.id, userId: g.userId, name: g.name, relationship: g.relationship, phone: g.phone, email: g.email },
        });
        if (g.userId) await this.ensureMembership(tx, toOrg, g.userId, OrgRole.RESPONSAVEL);
      }
      // Encerra a matricula de origem (e as turmas dela). Matriculas de outros grupos nao mudam.
      if (from) {
        await tx.student.update({
          where: { id: from.id },
          data: { status: StudentStatus.FORMER, leftAt: from.leftAt ?? now, leftReason: from.leftReason ?? 'TRANSFER' },
        });
        await tx.classStudent.updateMany({ where: { studentId: from.id, status: 'ACTIVE' }, data: { status: 'INACTIVE' } });
      }
      // Compartilha com o grupo novo o historico de TODAS as matriculas anteriores da pessoa (somente leitura).
      const previous = await tx.student.findMany({
        where: { personId: person.id, organizationId: { not: toOrg } },
        select: { id: true, organizationId: true },
      });
      for (const p of previous) {
        await tx.enrollmentShare.upsert({
          where: { fromStudentId_toOrganizationId: { fromStudentId: p.id, toOrganizationId: toOrg } },
          create: { personId: person.id, fromStudentId: p.id, fromOrganizationId: p.organizationId, toOrganizationId: toOrg, requestId: row.id, grantedAt: now },
          update: { revokedAt: null, requestId: row.id, grantedAt: now },
        });
      }
      await tx.transferRequest.update({ where: { id: row.id }, data: { toStudentId: student.id } });
      return student.id;
    });

    await this.audit.record({
      organizationId: null,
      action: AuditAction.TRANSFER_APPROVE,
      entity: AuditEntity.TRANSFER,
      entityId: row.id,
      meta: { toStudentId: newStudentId, fromStudentId: row.fromStudentId, toOrganizationId: toOrg, fromOrganizationId: row.fromOrganizationId },
    });
    await this.notify(toOrg, await this.mestres(toOrg), {
      type: 'TRANSFER_APPROVED',
      title: 'Transferência aprovada',
      body: `${row.person.name} aprovou a transferência e já é aluno(a) do grupo.`,
    });
    await this.notify(row.fromOrganizationId, await this.mestres(row.fromOrganizationId), {
      type: 'TRANSFER_APPROVED',
      title: 'Transferência concluída',
      body: `${row.person.name} foi transferido(a) para ${row.toOrganization.name}. A matrícula no seu grupo foi encerrada.`,
    });
  }

  private async ensureMembership(tx: Prisma.TransactionClient, organizationId: number, userId: number, role: OrgRole): Promise<void> {
    const existing = await tx.organizationUser.findUnique({ where: { organizationId_userId: { organizationId, userId } } });
    if (!existing) await tx.organizationUser.create({ data: { organizationId, userId, role, status: 'ACTIVE' } });
  }

  // ------------------------------------------------------------------------------------------------ job

  /** Expira os pedidos sem decisao vencidos e encerra (COMPLETED) as aprovacoes com a contestacao fechada. */
  async runMaintenance(now = new Date()): Promise<{ expired: number; completed: number }> {
    const due = await this.prisma.transferRequest.findMany({
      where: { status: TransferStatus.PENDING_PERSON, expiresAt: { lt: now } },
      select: { id: true, toOrganizationId: true },
    });
    let expired = 0;
    for (const r of due) if (await this.expireOne(r.id, r.toOrganizationId, now)) expired++;
    const { count: completed } = await this.prisma.transferRequest.updateMany({
      where: { status: TransferStatus.APPROVED, contestUntil: { lt: now } },
      data: { status: TransferStatus.COMPLETED },
    });
    return { expired, completed };
  }

  private async expireOne(id: number, toOrganizationId: number, now: Date): Promise<boolean> {
    const { count } = await this.prisma.transferRequest.updateMany({
      where: { id, status: TransferStatus.PENDING_PERSON },
      data: { status: TransferStatus.EXPIRED, decidedAt: now },
    });
    if (count !== 1) return false;
    await this.audit.record({ organizationId: toOrganizationId, userId: null, action: AuditAction.TRANSFER_EXPIRE, entity: AuditEntity.TRANSFER, entityId: id });
    await this.notify(toOrganizationId, await this.mestres(toOrganizationId), {
      type: 'TRANSFER_EXPIRED',
      title: 'Pedido de transferência expirado',
      body: 'Um pedido de transferência expirou sem resposta. Você pode pedir de novo.',
    });
    return true;
  }

  // ------------------------------------------------------------------------------------------------ apoio

  private async resolveTarget(input: CreateTransferInput) {
    let person = null;
    if (input.personId) {
      person = await canonicalPerson(this.prisma, await this.prisma.person.findUnique({ where: { id: input.personId } }));
    } else if (input.gingappCode?.trim()) {
      const code = normalizeGingappCode(input.gingappCode);
      if (!code) throw personBadRequest(PersonErrorCode.GINGAPP_CODE_NOT_FOUND);
      person = await findPersonByCode(this.prisma, code);
      if (!person) throw personBadRequest(PersonErrorCode.GINGAPP_CODE_NOT_FOUND);
    } else if (input.document?.trim()) {
      const cpf = parseCpf(input.document);
      if (!cpf) throw personBadRequest(PersonErrorCode.INVALID_CPF, { field: 'document' });
      person = await findPersonByHash(this.prisma, hashPersonDocument(canonicalDocument('CPF', cpf)));
    } else {
      throw personBadRequest(PersonErrorCode.TRANSFER_TARGET_REQUIRED);
    }
    if (!person) throw personNotFound();
    return person;
  }

  /** Quem decide: SSOT em person-deciders.ts (adulto = proprio login; menor = responsaveis). */
  private deciders(personId: number) {
    return personDeciders(this.prisma, personId);
  }

  private decidingAs(d: Parameters<typeof decidingAs>[0], userId: number) {
    return decidingAs(d, userId);
  }

  private personIdsVisibleTo(userId: number): Promise<number[]> {
    return personIdsVisibleTo(this.prisma, userId);
  }

  private async visibleToGroup(organizationId: number, id: number): Promise<RequestRow> {
    const row = await this.prisma.transferRequest.findFirst({
      where: { id, OR: [{ toOrganizationId: organizationId }, { fromOrganizationId: organizationId }] },
      include: REQUEST_INCLUDE,
    });
    if (!row) throw transferNotFound();
    return row;
  }

  private load(id: number): Promise<RequestRow> {
    return this.prisma.transferRequest.findUniqueOrThrow({ where: { id }, include: REQUEST_INCLUDE });
  }

  private async mestres(organizationId: number): Promise<number[]> {
    const rows = await this.prisma.organizationUser.findMany({
      where: { organizationId, role: OrgRole.MESTRE, status: 'ACTIVE' },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }

  /** Notificacao pessoal (organizationId nulo para a pessoa: o pedido envolve dois grupos). Nunca derruba a acao. */
  private async notify(organizationId: number | null, userIds: number[], payload: { type: string; title: string; body: string }): Promise<void> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return;
    await this.notifications.safely('transfer', () =>
      this.notifications.createMany(unique.map((userId) => ({ organizationId, userId, ...payload }))),
    );
  }

  private async unitsOf(rows: { toUnitId: number | null }[]): Promise<Map<number, { id: number; name: string }>> {
    const ids = [...new Set(rows.map((r) => r.toUnitId).filter((v): v is number => v !== null))];
    if (ids.length === 0) return new Map();
    const units = await this.prisma.unit.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    return new Map(units.map((u) => [u.id, u]));
  }

  private org(o: { id: number; name: string; logo: string | null }) {
    return { id: o.id, name: o.name, logoUrl: o.logo ?? null };
  }

  private date(d: Date): string {
    return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  }

  private base(row: RequestRow, units?: Map<number, { id: number; name: string }>) {
    return {
      id: row.id,
      status: row.status,
      fromOrganization: this.org(row.fromOrganization),
      toOrganization: this.org(row.toOrganization),
      toUnit: row.toUnitId ? (units?.get(row.toUnitId) ?? null) : null,
      requestedAt: row.requestedAt,
      expiresAt: row.expiresAt,
      contestUntil: row.contestUntil,
      decidedAt: row.decidedAt,
      note: row.note,
      contests: row.contests.map((c) => ({
        id: c.id,
        reason: c.reason,
        note: c.note,
        createdAt: c.createdAt,
        organization: { id: row.fromOrganization.id, name: row.fromOrganization.name },
      })),
    };
  }

  private staffView(row: RequestRow, organizationId: number, now: Date, units?: Map<number, { id: number; name: string }>) {
    const sent = row.toOrganizationId === organizationId;
    return {
      ...this.base(row, units),
      direction: sent ? ('SENT' as const) : ('RECEIVED' as const),
      person: { id: row.person.id, name: row.person.name, nickname: row.person.nickname, photo: row.person.photo, gingappCode: row.person.gingappCode },
      toStudentId: sent ? row.toStudentId : null,
      canCancel: sent && row.status === TransferStatus.PENDING_PERSON,
      canContest: !sent && OPEN_FOR_CONTEST.includes(row.status) && now.getTime() <= row.contestUntil.getTime(),
    };
  }

  private async personView(row: RequestRow, userId: number, now: Date, units?: Map<number, { id: number; name: string }>) {
    const decidingAs = this.decidingAs(await this.deciders(row.personId), userId);
    return {
      ...this.base(row, units),
      person: { id: row.person.id, name: row.person.name, photo: row.person.photo },
      canDecide: decidingAs !== null && row.status === TransferStatus.PENDING_PERSON && row.expiresAt.getTime() >= now.getTime(),
      decidingAs,
      sharedOnApproval: [...SHARED_ON_APPROVAL],
    };
  }
}

export const CONTEST_LABEL: Record<TransferContestReason, string> = {
  PENDING_PAYMENT: 'pendência financeira',
  EQUIPMENT: 'material/equipamento',
  OTHER: 'outro motivo',
};
