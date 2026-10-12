import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { Page, pageArgs } from '../../../shared/pagination/pagination';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { FINAL_DELETION_STATUSES } from './deletion-request-status';
import { ListDataDeletionRequestsQueryDto } from './dto/list-data-deletion-requests-query.dto';
import { UpdateDataDeletionRequestDto } from './dto/update-data-deletion-request.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DataDeletionRequestView {
  id: number;
  status: string;
  reason: string | null;
  requestedAt: Date;
  resolvedAt: Date | null;
  resolutionNote: string | null;
  userId: number;
  userName: string;
  userEmail: string;
  organizationId: number | null;
  organizationName: string | null;
}

const WITH_USER = { user: { select: { name: true, email: true } } } satisfies Prisma.DataDeletionRequestInclude;
type RequestRow = Prisma.DataDeletionRequestGetPayload<{ include: typeof WITH_USER }>;

/**
 * Tratamento dos pedidos de exclusao/anonimizacao de dados (LGPD art. 18) pela equipe da plataforma. Os pedidos sao
 * criados pelo proprio usuario (POST /auth/me/delete-request); aqui a equipe lista e muda o estado. NADA e' apagado
 * ou anonimizado por esta API — nem ao marcar DONE (so' registra data e nota); o processo e' manual e documentado.
 */
@Injectable()
export class DataDeletionRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(query: ListDataDeletionRequestsQueryDto): Promise<Page<DataDeletionRequestView>> {
    const where: Prisma.DataDeletionRequestWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.organizationId !== undefined ? { organizationId: query.organizationId } : {}),
    };
    const range = requestedAtRange(query.from, query.to);
    if (range) where.requestedAt = range;
    const q = query.q?.trim();
    if (q) {
      where.user = {
        OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }],
      };
    }

    const [rows, total] = await Promise.all([
      this.prisma.dataDeletionRequest.findMany({
        where,
        include: WITH_USER,
        orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
        ...pageArgs(query),
      }),
      this.prisma.dataDeletionRequest.count({ where }),
    ]);
    return { items: await this.toViews(rows), total };
  }

  async update(id: number, dto: UpdateDataDeletionRequestDto): Promise<DataDeletionRequestView> {
    const current = await this.prisma.dataDeletionRequest.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Pedido de exclusão não encontrado.');
    const note = dto.note?.trim() || null;
    if (dto.status === 'REJECTED' && !note) {
      throw new BadRequestException('Informe a justificativa (note) ao rejeitar o pedido.');
    }

    const final = FINAL_DELETION_STATUSES.includes(dto.status);
    const updated = await this.prisma.dataDeletionRequest.update({
      where: { id },
      data: {
        status: dto.status,
        // Reabrir (PENDING/IN_PROGRESS) limpa a data de resolucao; a nota so' muda quando enviada.
        resolvedAt: final ? new Date() : null,
        ...(dto.note !== undefined ? { resolutionNote: note } : {}),
      },
      include: WITH_USER,
    });
    await this.audit.record({
      organizationId: current.organizationId,
      entity: AuditEntity.DATA_DELETION_REQUEST,
      entityId: id,
      action: AuditAction.DATA_DELETION_REQUEST_UPDATE,
      meta: { from: current.status, to: dto.status, userId: current.userId, hasNote: note !== null },
    });
    return (await this.toViews([updated]))[0];
  }

  private async toViews(rows: RequestRow[]): Promise<DataDeletionRequestView[]> {
    const orgIds = [...new Set(rows.map((r) => r.organizationId).filter((v): v is number => v !== null))];
    const orgs = orgIds.length
      ? await this.prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } })
      : [];
    const names = new Map(orgs.map((o) => [o.id, o.name]));
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      reason: r.reason,
      requestedAt: r.requestedAt,
      resolvedAt: r.resolvedAt,
      resolutionNote: r.resolutionNote,
      userId: r.userId,
      userName: r.user.name,
      userEmail: r.user.email,
      organizationId: r.organizationId,
      organizationName: r.organizationId !== null ? (names.get(r.organizationId) ?? null) : null,
    }));
  }
}

/** from/to: so a data (yyyy-MM-dd) = dia inteiro (UTC); com hora = o instante. */
function requestedAtRange(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined;
  const range: Prisma.DateTimeFilter = {};
  if (from) range.gte = new Date(from.length === 10 ? `${from}T00:00:00.000Z` : from);
  if (to) {
    range.lt =
      to.length === 10 ? new Date(new Date(`${to}T00:00:00.000Z`).getTime() + DAY_MS) : new Date(new Date(to).getTime() + 1);
  }
  return range;
}
