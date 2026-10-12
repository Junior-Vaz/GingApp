import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RodaRecurrence } from '@prisma/client';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { describeRecurrence, nextOccurrences } from './roda-recurrence';
import { GenerateOccurrencesDto } from './dto/generate-occurrences.dto';

export const DEFAULT_OCCURRENCES = 3;

/**
 * Geracao SOB DEMANDA das proximas ocorrencias de uma roda recorrente ("roda mensal"): cria rodas filhas
 * (parentRodaId) copiando os dados da roda mae. Idempotente: a constraint unica (parentRodaId, date) + skipDuplicates
 * garantem que repetir a chamada nao duplica nada — a resposta traz so as NOVAS e o total de proximas ocorrencias.
 * Nao ha cron: o Mestre (ou o painel, ao abrir a roda) chama o endpoint quando quer abrir mais datas.
 */
@Injectable()
export class RodasOccurrencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async generate(organizationId: number, rodaId: number, dto: GenerateOccurrencesDto, now: Date = new Date()) {
    const roda = await this.prisma.roda.findFirst({ where: { id: rodaId, organizationId } });
    if (!roda) throw new NotFoundException('Roda não encontrada ou não organizada por esta organização.');
    if (roda.parentRodaId !== null) {
      throw new BadRequestException('Esta roda já é uma ocorrência: gere a partir da roda principal da série.');
    }
    if (roda.recurrence === RodaRecurrence.NONE) {
      throw new BadRequestException('Esta roda não é recorrente. Defina a recorrência (semanal/mensal) antes.');
    }

    const count = dto.count ?? DEFAULT_OCCURRENCES;
    const wanted = nextOccurrences(roda.date, roda.recurrence, {
      after: now,
      until: roda.recurrenceUntil,
      count,
    });
    const existing = await this.prisma.roda.findMany({
      where: { parentRodaId: roda.id, date: { in: wanted } },
      select: { date: true },
    });
    const have = new Set(existing.map((e) => e.date.getTime()));
    const toCreate = wanted.filter((d) => !have.has(d.getTime()));

    if (toCreate.length > 0) {
      await this.prisma.roda.createMany({
        skipDuplicates: true,
        data: toCreate.map((date) => ({
          organizationId: roda.organizationId,
          communityId: roda.communityId,
          stateId: roda.stateId,
          cityId: roda.cityId,
          title: roda.title,
          description: roda.description,
          location: roda.location,
          latitude: roda.latitude,
          longitude: roda.longitude,
          imageUrl: roda.imageUrl,
          date,
          parentRodaId: roda.id,
          recurrence: RodaRecurrence.NONE,
        })),
      });
      await this.audit.record({
        organizationId,
        action: AuditAction.RODA_GENERATE_OCCURRENCES,
        entity: AuditEntity.RODA,
        entityId: roda.id,
        meta: { created: toCreate.length, recurrence: roda.recurrence },
      });
    }

    const occurrences = await this.prisma.roda.findMany({
      where: { parentRodaId: roda.id, date: { gt: now } },
      orderBy: { date: 'asc' },
    });
    return {
      rule: describeRecurrence(roda.recurrence, roda.date),
      created: toCreate.length,
      occurrences,
    };
  }
}
