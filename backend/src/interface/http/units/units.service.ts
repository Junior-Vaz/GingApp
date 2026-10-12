import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RecordStatus, Unit } from '@prisma/client';
import { Page, pageArgs } from '../../../shared/pagination/pagination';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { isRestricted, UnitScopeService } from '../../../shared/access/unit-scope';
import { resolveCoordinatesInput } from '../../../shared/geo/coordinates';
import { GeocodingService } from '../../../shared/geo/geocoding.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CreateUnitDto } from './dto/create-unit.dto';
import { ListUnitsQueryDto } from './dto/list-units-query.dto';
import { UpdateUnitDto } from './dto/update-unit.dto';

const UNIT_NOT_FOUND = 'Unidade não encontrada.';

/**
 * Matriz/filiais do grupo — CRUD completo, sempre isolado por organizationId.
 *
 * Regras (todas aplicadas SOB UM LOCK da linha da organização — `SELECT ... FOR UPDATE` —, o que
 * serializa as escritas de unidades do mesmo grupo: sem corrida entre duas criações no limite do plano
 * nem entre duas trocas de matriz):
 *  - Nunca apaga: DELETE e PATCH status=INACTIVE só inativam (histórico de alunos/turmas/aulas preservado).
 *  - A matriz (isMain) é ÚNICA por grupo: marcar uma unidade como matriz desmarca a anterior. Uma unidade
 *    inativa não pode ser matriz; a matriz não pode ser inativada nem desmarcada sem que outra assuma
 *    (defina a nova matriz primeiro). Nunca se inativa a única unidade ativa do grupo.
 *  - Plan.maxUnits (assinatura em aberto) limita as unidades ATIVAS: criar ou reativar além do limite = 403.
 *    Sem assinatura em aberto, ou plano sem limite, não bloqueia (mesmo critério de Plan.maxStudents).
 *    OrganizationFeatureOverride é só liga/desliga de funcionalidade (sem valor de limite): não se aplica.
 */
@Injectable()
export class UnitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly unitScope: UnitScopeService,
    private readonly audit: AuditService,
    private readonly geocoding: GeocodingService,
  ) {}

  /**
   * Escopo por unidade (E08, shared/access/unit-scope.ts): o PROFESSOR com unidades atribuídas só lista/lê as
   * suas unidades (os pickers do painel passam a oferecer só elas); `user` omitido ou qualquer outro papel = todas.
   */
  async findAll(organizationId: number, query: ListUnitsQueryDto = {}, user?: AuthenticatedUser): Promise<Page<Unit>> {
    const where: Prisma.UnitWhereInput = { organizationId }; // organizationId SEMPRE no where (findMany e count)
    const scope = await this.unitScope.resolve(user, organizationId);
    if (isRestricted(scope)) where.id = { in: scope };
    if (query.status) where.status = query.status;
    const q = query.q?.trim();
    if (q) where.name = { contains: q, mode: 'insensitive' };

    const [items, total] = await Promise.all([
      this.prisma.unit.findMany({ where, orderBy: { id: 'desc' }, ...pageArgs(query) }),
      this.prisma.unit.count({ where }),
    ]);
    return { items, total };
  }

  async findOne(organizationId: number, id: number, user?: AuthenticatedUser): Promise<Unit> {
    const scope = await this.unitScope.resolve(user, organizationId);
    const unit = await this.prisma.unit.findFirst({
      where: { id, organizationId, ...(isRestricted(scope) ? { id: { in: scope.includes(id) ? [id] : [] } } : {}) },
    });
    if (!unit) throw new NotFoundException(UNIT_NOT_FOUND);
    return unit;
  }

  async create(organizationId: number, dto: CreateUnitDto): Promise<Unit> {
    const maxUnits = await this.unitLimit(organizationId);
    // Coordenadas do mapa: as do corpo, ou geocodificadas (so' com chave do Google; antes da transacao, que segura o lock).
    const coordinates = await this.geocoding.forCreate(dto, [dto.address, dto.city, dto.state]);
    const created = await this.prisma.$transaction(async (tx) => {
      await this.lockOrganization(tx, organizationId);
      await this.assertWithinLimit(tx, organizationId, maxUnits);

      // Sem matriz ativa, a nova unidade assume o papel (a menos que peça explicitamente isMain=false).
      const hasMain = (await tx.unit.count({ where: { organizationId, isMain: true, status: 'ACTIVE' } })) > 0;
      const isMain = dto.isMain ?? !hasMain;
      if (isMain) await this.clearMain(tx, organizationId);

      return tx.unit.create({
        data: {
          organizationId,
          name: dto.name,
          address: dto.address,
          city: dto.city,
          state: dto.state,
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
          isMain,
        },
      });
    });
    await this.audit.record({
      organizationId,
      action: AuditAction.UNIT_CREATE,
      entity: AuditEntity.UNIT,
      entityId: created.id,
      meta: { name: created.name, isMain: created.isMain },
    });
    return created;
  }

  async update(organizationId: number, id: number, dto: UpdateUnitDto): Promise<Unit> {
    const data: Prisma.UnitUpdateInput = {
      name: dto.name,
      address: dto.address,
      city: dto.city,
      state: dto.state,
      latitude: dto.latitude,
      longitude: dto.longitude,
      isMain: dto.isMain,
      status: dto.status,
    };
    if (Object.values(data).every((value) => value === undefined)) {
      throw new BadRequestException(
        'Informe ao menos um campo para atualizar (name, address, city, state, latitude, longitude, isMain ou status).',
      );
    }
    resolveCoordinatesInput(dto); // 400 se so' uma das duas coordenadas veio
    const updated = await this.apply(organizationId, id, dto, await this.coordinatesForUpdate(organizationId, id, dto));
    await this.audit.record({
      organizationId,
      action: dto.status === 'INACTIVE' ? AuditAction.UNIT_INACTIVATE : AuditAction.UNIT_UPDATE,
      entity: AuditEntity.UNIT,
      entityId: id,
      meta: {
        fields: Object.entries(data)
          .filter(([, value]) => value !== undefined)
          .map(([key]) => key),
        status: updated.status,
      },
    });
    return updated;
  }

  /**
   * "Remover" uma unidade nunca apaga o registro: marca status = INACTIVE (mesmo padrão de turmas/alunos).
   * Idempotente: já inativa devolve a unidade como está. As travas de matriz/única ativa valem aqui também.
   */
  async remove(organizationId: number, id: number): Promise<Unit> {
    const updated = await this.apply(organizationId, id, { status: RecordStatus.INACTIVE });
    await this.audit.record({
      organizationId,
      action: AuditAction.UNIT_INACTIVATE,
      entity: AuditEntity.UNIT,
      entityId: id,
    });
    return updated;
  }

  /**
   * Coordenadas a gravar no PATCH (ou undefined = nao mexer): as do corpo; senao, se address/city/state mudaram,
   * geocodifica o endereco novo (so' com chave do Google). Unidade inexistente: undefined (apply responde 404).
   */
  private async coordinatesForUpdate(
    organizationId: number,
    id: number,
    dto: UpdateUnitDto,
  ): Promise<{ latitude: number | null; longitude: number | null } | undefined> {
    const given = resolveCoordinatesInput(dto);
    if (given) return given;
    if (dto.address === undefined && dto.city === undefined && dto.state === undefined) return undefined;
    const current = await this.prisma.unit.findFirst({ where: { id, organizationId } });
    if (!current) return undefined;
    const next = {
      address: dto.address === undefined ? current.address : dto.address,
      city: dto.city === undefined ? current.city : dto.city,
      state: dto.state === undefined ? current.state : dto.state,
    };
    const textChanged = next.address !== current.address || next.city !== current.city || next.state !== current.state;
    return this.geocoding.forUpdate(dto, textChanged, [next.address, next.city, next.state]);
  }

  private async apply(
    organizationId: number,
    id: number,
    dto: UpdateUnitDto,
    coordinates?: { latitude: number | null; longitude: number | null },
  ): Promise<Unit> {
    const maxUnits = await this.unitLimit(organizationId);
    return this.prisma.$transaction(async (tx) => {
      await this.lockOrganization(tx, organizationId);
      const current = await tx.unit.findFirst({ where: { id, organizationId } });
      if (!current) throw new NotFoundException(UNIT_NOT_FOUND);

      const nextStatus = dto.status ?? current.status;
      const deactivating = current.status === 'ACTIVE' && nextStatus === 'INACTIVE';
      const reactivating = current.status === 'INACTIVE' && nextStatus === 'ACTIVE';

      if (nextStatus === 'INACTIVE' && dto.isMain === true) {
        throw new ConflictException('Uma unidade inativa não pode ser a matriz. Reative-a antes de defini-la como matriz.');
      }
      if (deactivating) {
        if (current.isMain) {
          throw new ConflictException(
            'A matriz não pode ser inativada. Defina outra unidade como matriz antes de inativar esta.',
          );
        }
        const otherActive = await tx.unit.count({ where: { organizationId, status: 'ACTIVE', id: { not: id } } });
        if (otherActive === 0) {
          throw new ConflictException('Não é possível inativar a única unidade ativa do grupo.');
        }
      }
      if (reactivating) await this.assertWithinLimit(tx, organizationId, maxUnits);

      if (dto.isMain === false && current.isMain) {
        throw new ConflictException(
          'O grupo precisa de uma matriz. Para trocar, defina OUTRA unidade como matriz (a atual deixa de ser matriz automaticamente).',
        );
      }
      if (dto.isMain === true && !current.isMain) {
        await this.clearMain(tx, organizationId);
      }

      return tx.unit.update({
        where: { id },
        data: {
          name: dto.name,
          address: dto.address,
          city: dto.city,
          state: dto.state,
          latitude: coordinates?.latitude,
          longitude: coordinates?.longitude,
          isMain: dto.isMain,
          status: dto.status,
        },
      });
    });
  }

  /** Serializa as escritas de unidades do grupo (lock de linha da organização até o fim da transação). */
  private async lockOrganization(tx: Prisma.TransactionClient, organizationId: number): Promise<void> {
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;
  }

  private async clearMain(tx: Prisma.TransactionClient, organizationId: number): Promise<void> {
    await tx.unit.updateMany({ where: { organizationId, isMain: true }, data: { isMain: false } });
  }

  /** Plan.maxUnits da assinatura em aberto (null = sem assinatura/sem limite) + nome do plano p/ a mensagem. */
  private async unitLimit(organizationId: number): Promise<{ max: number; planName: string } | null> {
    const subscription = await this.subscriptionsService.findOpenForOrganization(organizationId);
    const max = subscription?.plan.maxUnits;
    return max ? { max, planName: subscription!.plan.name } : null;
  }

  private async assertWithinLimit(
    tx: Prisma.TransactionClient,
    organizationId: number,
    limit: { max: number; planName: string } | null,
  ): Promise<void> {
    if (!limit) return;
    const active = await tx.unit.count({ where: { organizationId, status: 'ACTIVE' } });
    if (active >= limit.max) {
      throw new ForbiddenException(
        `Limite de ${limit.max} unidade(s) ativa(s) do plano "${limit.planName}" atingido. Inative uma unidade ou faça upgrade do plano.`,
      );
    }
  }
}
