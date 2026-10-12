import { Injectable } from '@nestjs/common';
import { Prisma, UserType } from '@prisma/client';
import { Page, pageArgs } from '../../../shared/pagination/pagination';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { ListAuditQueryDto } from './dto/list-audit-query.dto';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Nome mostrado ao Mestre quando o autor e' da equipe da plataforma (nao expomos a identidade da equipe aos grupos). */
export const PLATFORM_ACTOR_LABEL = 'Equipe GingApp';

export interface AuditLogView {
  id: number;
  createdAt: Date;
  action: string;
  entity: string;
  entityId: string | null;
  organizationId: number | null;
  organizationName: string | null;
  userId: number | null;
  userName: string | null;
  userEmail: string | null;
  /** IP do cliente; omitido (null) para o Mestre quando o autor e' da equipe da plataforma. */
  ip: string | null;
  meta: unknown;
}

/** Consulta da trilha de auditoria (leitura). A GRAVACAO esta em shared/audit/audit.service.ts (AuditService). */
@Injectable()
export class AuditQueryService {
  constructor(private readonly prisma: PrismaService) {}

  /** Plataforma: tudo; `organizationId` e' um filtro opcional. */
  listAll(query: ListAuditQueryDto): Promise<Page<AuditLogView>> {
    return this.list(query, query.organizationId, false);
  }

  /** Mestre: SEMPRE so o proprio grupo (o `organizationId` da query e' ignorado). */
  listGroup(organizationId: number, query: ListAuditQueryDto): Promise<Page<AuditLogView>> {
    return this.list(query, organizationId, true);
  }

  private async list(
    query: ListAuditQueryDto,
    organizationId: number | undefined,
    maskPlatformActors: boolean,
  ): Promise<Page<AuditLogView>> {
    const where: Prisma.AuditLogWhereInput = {
      ...(organizationId !== undefined ? { organizationId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.entity ? { resource: query.entity } : {}),
      ...(query.userId !== undefined ? { userId: query.userId } : {}),
    };
    const range = createdAtRange(query.from, query.to);
    if (range) where.createdAt = range;

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: {
          user: { select: { name: true, email: true, userType: true } },
          organization: { select: { name: true } },
        },
        // id desempata o mesmo instante => paginacao deterministica.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageArgs(query),
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    const items = rows.map((r): AuditLogView => {
      const hideActor = maskPlatformActors && r.user?.userType === UserType.PLATFORM;
      return {
        id: r.id,
        createdAt: r.createdAt,
        action: r.action,
        entity: r.resource,
        entityId: r.resourceId,
        organizationId: r.organizationId,
        organizationName: r.organization?.name ?? null,
        userId: hideActor ? null : r.userId,
        userName: hideActor ? PLATFORM_ACTOR_LABEL : (r.user?.name ?? null),
        userEmail: hideActor ? null : (r.user?.email ?? null),
        ip: hideActor ? null : r.ipAddress,
        meta: r.metadata,
      };
    });
    return { items, total };
  }
}

/** from/to: so a data (yyyy-MM-dd) = dia inteiro (UTC); com hora = o instante. */
function createdAtRange(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined;
  const range: Prisma.DateTimeFilter = {};
  if (from) range.gte = new Date(from.length === 10 ? `${from}T00:00:00.000Z` : from);
  if (to) {
    range.lt =
      to.length === 10 ? new Date(new Date(`${to}T00:00:00.000Z`).getTime() + DAY_MS) : new Date(new Date(to).getTime() + 1);
  }
  return range;
}
