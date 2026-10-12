import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { OrgRole, ParticipantStatus, Prisma } from '@prisma/client';
import { Page, pageArgs } from '../../../shared/pagination/pagination';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { ListRodasQueryDto } from './dto/list-rodas-query.dto';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { PermissionsService } from '../../../shared/access/permissions.service';
import { NotificationsService } from '../notifications/notifications.service';
import { formatInstantBR } from '../../../shared/dates/format-br';
import { MyParticipation, redactParticipant } from '../../../shared/access/participant-privacy';
import { GeocodingService } from '../../../shared/geo/geocoding.service';
import { locationGeocodeParts } from '../../../shared/geo/location-text';
import { parseRecurrenceUntil } from './roda-recurrence';
import { CreateRodaDto } from './dto/create-roda.dto';
import { UpdateRodaDto } from './dto/update-roda.dto';

const ADMIN_ROLES: OrgRole[] = [OrgRole.MESTRE, OrgRole.PROFESSOR];

/**
 * Rodas pertencem ao domínio "Comunidade" (PLANO_PROJETO.md §2.3): dados públicos, listados
 * sem autenticação e sem isolamento multi-tenant no findAll/findOne — nenhum dado privado do
 * grupo é exposto nesta entidade.
 *
 * `organizationId` (adicionado em §10.7 do plano, gap do schema original) identifica quem
 * organiza a roda, só para restringir create/update/delete a quem criou — nunca usado para
 * filtrar a listagem pública.
 */
@Injectable()
export class RodasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly notifications: NotificationsService,
    private readonly geocoding: GeocodingService,
  ) {}

  /** Lista PÚBLICA (todas as organizações, sem filtro de tenant — regra existente): o total
   * também é global. `id` como desempate mantém a paginação determinística.
   * Cada item ganha `participantsCount` (agregado, sem dado pessoal) e `myParticipation`
   * (`{ id, studentId, status }` da participação do usuário do token; `null` para anônimos) —
   * um groupBy + um findMany por página, nunca por item (evita o N+1 do app). */
  async findAll(query: ListRodasQueryDto = {}, requester?: AuthenticatedUser): Promise<Page<unknown>> {
    const q = query.q?.trim();
    const where: Prisma.RodaWhereInput = {
      ...(query.stateId !== undefined ? { stateId: query.stateId } : {}),
      ...(query.cityId !== undefined ? { cityId: query.cityId } : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: 'insensitive' } },
              { location: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.roda.findMany({ where, orderBy: [{ date: 'asc' }, { id: 'asc' }], ...pageArgs(query) }),
      this.prisma.roda.count({ where }),
    ]);
    return { items: await this.withParticipationSummary(items, requester), total };
  }

  /** Anexa `participantsCount` e `myParticipation` a uma página de rodas (um groupBy + um
   * findMany, nunca por item). Reusado por GET /rodas e GET /calendar. */
  async withParticipationSummary<T extends { id: number }>(
    rodas: T[],
    requester?: AuthenticatedUser,
  ): Promise<Array<T & { participantsCount: number; myParticipation: MyParticipation | null }>> {
    if (rodas.length === 0) return [];
    const rodaIds = rodas.map((r) => r.id);
    const [counts, mine] = await Promise.all([
      this.prisma.rodaParticipant.groupBy({
        by: ['rodaId'],
        where: { rodaId: { in: rodaIds } },
        _count: { _all: true },
      }),
      requester
        ? this.prisma.rodaParticipant.findMany({
            where: { rodaId: { in: rodaIds }, userId: requester.id },
            select: { id: true, rodaId: true, studentId: true, status: true },
            orderBy: { id: 'asc' },
          })
        : Promise.resolve([]),
    ]);
    const countByRoda = new Map(counts.map((c) => [c.rodaId, c._count._all]));
    return rodas.map((roda) => {
      const own = mine.find((p) => p.rodaId === roda.id);
      const myParticipation: MyParticipation | null = own
        ? { id: own.id, studentId: own.studentId, status: own.status }
        : null;
      return { ...roda, participantsCount: countByRoda.get(roda.id) ?? 0, myParticipation };
    });
  }

  /** Dados públicos de referência (não há endpoint dedicado de State/City ainda) — usados
   * para popular os selects de estado/cidade no formulário de criar/editar roda. */
  listStates() {
    return this.prisma.state.findMany({ orderBy: { name: 'asc' } });
  }

  listCities(stateId?: number) {
    return this.prisma.city.findMany({
      where: stateId ? { stateId } : undefined,
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: number) {
    const roda = await this.prisma.roda.findUnique({ where: { id } });
    if (!roda) {
      throw new NotFoundException('Roda não encontrada.');
    }
    return roda;
  }

  /** Só para uso interno (update/remove): garante que a roda pertence à organização do token. */
  private async findOwned(organizationId: number, id: number) {
    const roda = await this.prisma.roda.findFirst({ where: { id, organizationId } });
    if (!roda) {
      throw new NotFoundException('Roda não encontrada ou não organizada por esta organização.');
    }
    return roda;
  }

  async create(organizationId: number, dto: CreateRodaDto) {
    await this.assertReferencesExist(dto);
    // Coordenadas do mapa: as do corpo, ou geocodificadas a partir de location + cidade/UF (so' com chave do Google).
    const coordinates = await this.geocoding.forCreate(dto, await locationGeocodeParts(this.prisma, dto));

    const roda = await this.prisma.roda.create({
      data: {
        organizationId,
        title: dto.title,
        description: dto.description,
        date: new Date(dto.date),
        location: dto.location,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        stateId: dto.stateId,
        cityId: dto.cityId,
        communityId: dto.communityId,
        imageUrl: dto.imageUrl,
        recurrence: dto.recurrence,
        recurrenceUntil: dto.recurrenceUntil ? parseRecurrenceUntil(dto.recurrenceUntil) : undefined,
      },
    });

    // Gatilho de notificação (E09): roda NOVA e FUTURA avisa os membros ativos do grupo (teto de
    // destinatários; efeito colateral SEGURO — nunca derruba a criação). Roda passada não notifica.
    if (roda.date.getTime() > Date.now()) {
      await this.notifications.notifyGroupMembers(organizationId, null, {
        title: 'Nova roda',
        body: `${roda.title} — ${formatInstantBR(roda.date)}${roda.location ? ` · ${roda.location}` : ''}`,
        type: 'RODA',
      });
    }
    return roda;
  }

  async update(organizationId: number, id: number, dto: UpdateRodaDto) {
    const current = await this.findOwned(organizationId, id);
    await this.assertReferencesExist(dto);
    if (current.parentRodaId !== null && dto.recurrence !== undefined && dto.recurrence !== 'NONE') {
      throw new BadRequestException('Uma ocorrência gerada não pode ter recorrência: edite a roda principal da série.');
    }

    // Coordenadas: as do corpo; senao, se o local (texto/cidade/estado) mudou, geocodifica o novo (so' com chave do Google).
    const next = {
      location: dto.location === undefined ? current.location : dto.location,
      stateId: dto.stateId === undefined ? current.stateId : dto.stateId,
      cityId: dto.cityId === undefined ? current.cityId : dto.cityId,
    };
    const textChanged =
      next.location !== current.location || next.stateId !== current.stateId || next.cityId !== current.cityId;
    const coordinates = await this.geocoding.forUpdate(
      dto,
      textChanged,
      textChanged ? await locationGeocodeParts(this.prisma, next) : [],
    );

    return this.prisma.roda.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        date: dto.date ? new Date(dto.date) : undefined,
        location: dto.location,
        latitude: coordinates?.latitude,
        longitude: coordinates?.longitude,
        stateId: dto.stateId,
        cityId: dto.cityId,
        communityId: dto.communityId,
        imageUrl: dto.imageUrl,
        recurrence: dto.recurrence,
        recurrenceUntil:
          dto.recurrenceUntil === undefined ? undefined : dto.recurrenceUntil === null ? null : parseRecurrenceUntil(dto.recurrenceUntil),
      },
    });
  }

  /** Apaga de verdade (não há conceito de "roda inativa" no domínio) — remove os participantes
   * primeiro numa transação para não violar a FK. */
  async remove(organizationId: number, id: number, series = false) {
    await this.findOwned(organizationId, id);

    // `series`: apaga tambem as ocorrencias geradas (filhas); sem ele elas viram rodas avulsas (FK SET NULL).
    const ids = series
      ? [id, ...(await this.prisma.roda.findMany({ where: { parentRodaId: id, organizationId }, select: { id: true } })).map((r) => r.id)]
      : [id];
    await this.prisma.$transaction([
      this.prisma.rodaParticipant.deleteMany({ where: { rodaId: { in: ids } } }),
      this.prisma.roda.deleteMany({ where: { id: { in: ids } } }),
    ]);

    return { success: true, removed: ids.length };
  }

  /**
   * Quem confirmou presença. A rota segue pública (o tamanho da lista = "N na roda"), mas NOMES
   * e ids de usuário/aluno são dado pessoal (LGPD; participantes podem ser menores, de qualquer
   * organização): só a equipe que ORGANIZA a roda (MESTRE/PROFESSOR da organização dona, mesma
   * regra de `leave`) ou PLATFORM recebe a lista identificada — é o que o painel usa. Qualquer
   * outro autenticado vê a PRÓPRIA participação completa e as demais anonimizadas; anônimo vê
   * todas anonimizadas (redactParticipant).
   */
  async listParticipants(rodaId: number, requester?: AuthenticatedUser) {
    const roda = await this.findOne(rodaId);
    const participants = await this.prisma.rodaParticipant.findMany({
      where: { rodaId },
      include: { user: { select: { id: true, name: true } }, student: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    if (requester && (this.permissions.isPlatform(requester) || this.isOrganizerAdmin(roda, requester))) {
      return participants;
    }
    return participants.map((p) => (requester && p.userId === requester.id ? p : redactParticipant(p)));
  }

  /** MESTRE/PROFESSOR da organização que organiza a roda (gestão da lista de participantes). */
  private isOrganizerAdmin(roda: { organizationId: number | null }, requester: AuthenticatedUser): boolean {
    return (
      roda.organizationId != null &&
      roda.organizationId === requester.organizationId &&
      !!requester.role &&
      ADMIN_ROLES.includes(requester.role)
    );
  }

  /**
   * "Quero participar" (projeto.txt §41) — autoregistro do próprio usuário autenticado.
   * Idempotente: clicar de novo não duplica, só devolve a participação existente.
   */
  async join(rodaId: number, userId: number) {
    await this.findOne(rodaId);

    const existing = await this.prisma.rodaParticipant.findFirst({ where: { rodaId, userId } });
    if (existing) return existing;

    return this.prisma.rodaParticipant.create({
      data: { rodaId, userId, status: ParticipantStatus.CONFIRMED },
    });
  }

  /**
   * Cancelar presença: o próprio participante pode remover a si mesmo; MESTRE/PROFESSOR da
   * organização que organiza a roda também pode remover qualquer participante (gestão da
   * lista). Qualquer outra pessoa recebe 403.
   */
  async leave(rodaId: number, participantId: number, requester: AuthenticatedUser) {
    const participant = await this.prisma.rodaParticipant.findFirst({ where: { id: participantId, rodaId } });
    if (!participant) {
      throw new NotFoundException('Participante não encontrado nesta roda.');
    }

    const isSelf = participant.userId === requester.id;
    if (!isSelf) {
      const roda = await this.prisma.roda.findUnique({ where: { id: rodaId }, select: { organizationId: true } });
      if (!roda || !this.isOrganizerAdmin(roda, requester)) {
        throw new ForbiddenException('Você só pode cancelar a própria participação.');
      }
    }

    await this.prisma.rodaParticipant.delete({ where: { id: participantId } });
    return { success: true };
  }

  /** State/City/Community são dados públicos (não pertencem a nenhuma organização) — aqui só
   * confirmamos que o id informado existe de verdade, não uma checagem de tenant. */
  private async assertReferencesExist(dto: {
    stateId?: number | null;
    cityId?: number | null;
    communityId?: number | null;
  }): Promise<void> {
    // `!= null`: null (limpar o campo no PATCH) não tem o que validar.
    if (dto.stateId != null) {
      const state = await this.prisma.state.findUnique({ where: { id: dto.stateId } });
      if (!state) throw new BadRequestException('Estado inválido.');
    }
    if (dto.cityId != null) {
      const city = await this.prisma.city.findUnique({ where: { id: dto.cityId } });
      if (!city) throw new BadRequestException('Cidade inválida.');
    }
    if (dto.communityId != null) {
      const community = await this.prisma.community.findUnique({ where: { id: dto.communityId } });
      if (!community) throw new BadRequestException('Comunidade inválida.');
    }
  }
}
