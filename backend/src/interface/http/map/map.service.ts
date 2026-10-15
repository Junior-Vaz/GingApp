import { BadRequestException, Injectable } from '@nestjs/common';
import { EventStatus, OrganizationType, Prisma, RecordStatus } from '@prisma/client';
import { isRestricted, UnitScopeService } from '../../../shared/access/unit-scope';
import { haversineKm } from '../../../shared/geo/coordinates';
import { OCCUPYING_STATUSES, spotsLeft } from '../events/event-registration';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  MAP_DEFAULT_LIMIT,
  MAP_PLACE_TYPES,
  MapPlaceType,
  MapPlacesQueryDto,
} from './dto/map-places-query.dto';

/** Grupo dono do ponto (so' dados publicos do perfil institucional — nunca contato nem membros). */
export interface MapPlaceOrganization {
  id: number;
  name: string;
  slug: string;
  logoUrl: string | null;
  description: string | null;
}

export interface MapPlace {
  /** `${type}:${id}` — unico no mapa (ids de tabelas diferentes colidem). */
  id: string;
  type: MapPlaceType;
  title: string;
  /** Curta (<= 240). UNIT/CLASS = apresentacao do grupo; EVENT/RODA = descricao do proprio evento/roda. */
  description: string | null;
  latitude: number;
  longitude: number;
  address: string | null;
  city: string | null;
  state: string | null;
  /** EVENT/RODA: data de inicio (ISO 8601). Evento/roda nao tem fim. */
  startsAt: string | null;
  endsAt: string | null;
  /** CLASS: dia da semana (0 = domingo .. 6 = sabado) e horarios "HH:MM". */
  weekday: number | null;
  startTime: string | null;
  endTime: string | null;
  /** UNIT/CLASS: nome da unidade. */
  unitName: string | null;
  /** CLASS: nome livre do local do treino (ex.: "Praca X"); null = sem rotulo. Com `address` proprio, `address/city/state` sao os do treino. */
  locationLabel: string | null;
  /** null so' em roda sem grupo organizador. */
  organization: MapPlaceOrganization | null;
  /** Presente (km, 2 casas) somente quando a query traz lat/lng. */
  distanceKm: number | null;
  imageUrl: string | null;
  /** EVENT: total de vagas (null = ilimitado ou nao e' evento) e vagas restantes (0 = lotado). */
  capacity: number | null;
  spotsLeft: number | null;
  /** O ponto e' do grupo do usuario do token. */
  isMine: boolean;
}

export interface MapPlacesResult {
  items: MapPlace[];
  /** Pontos que casam com os filtros ANTES do corte por `limit`. */
  total: number;
}

/** Cada fonte e' lida ate este teto antes do corte final (protege a memoria; o mapa mostra no maximo `limit`). */
const SOURCE_FETCH_CAP = 2000;
const DESCRIPTION_MAX = 240;
/** Eventos/rodas passados: no maximo 30 dias para tras (alem disso o mapa nao tem utilidade). */
const PAST_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

/** Grupo que pode aparecer no mapa: GROUP, ACTIVE e com `mapVisible` ligado pelo Mestre. */
const ORG_VISIBLE: Prisma.OrganizationWhereInput = {
  type: OrganizationType.GROUP,
  status: RecordStatus.ACTIVE,
  mapVisible: true,
};
const ORG_SELECT = { id: true, name: true, slug: true, logo: true, description: true } as const;
type OrgRow = { id: number; name: string; slug: string; logo: string | null; description: string | null };

const short = (text: string | null | undefined): string | null => {
  const trimmed = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  return trimmed.length > DESCRIPTION_MAX ? `${trimmed.slice(0, DESCRIPTION_MAX - 1).trimEnd()}…` : trimmed;
};

/**
 * Mapa da comunidade (Google Maps no app): TODOS os pontos de capoeira com coordenadas — unidades, treinos
 * (turmas ativas), eventos e rodas — de grupos que o MESTRE deixou visiveis (`Organization.mapVisible`).
 *
 * Visibilidade (as MESMAS regras do restante da comunidade, nada novo e nada privado):
 *  - UNIT: unidades ACTIVE de grupos ACTIVE + mapVisible;
 *  - CLASS: turmas ACTIVE (de unidade ACTIVE, ou sem unidade) com posicao: a PROPRIA do local do treino (Class.latitude/
 *    longitude + address/city/state/locationLabel) quando existir; senao a da unidade (heranca — turmas antigas). So'
 *    nome da turma + dia/horario + local (sem professor nem alunos). Mesmo conceito da unidade: o grupo ja a expoe;
 *  - EVENT: eventos PUBLICOS de qualquer grupo (isPublic, como GET /calendar) + os do PROPRIO grupo do usuario
 *    (como GET /events), respeitando o escopo de unidade do professor restrito;
 *  - RODA: rodas sao publicas (como GET /rodas e /calendar); roda sem grupo organizador sempre aparece.
 * Nenhum dado de pessoa (aluno, responsavel, professor, e-mail, telefone) e' lido nem devolvido.
 */
@Injectable()
export class MapService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly unitScope: UnitScopeService,
  ) {}

  async places(query: MapPlacesQueryDto, requester: AuthenticatedUser): Promise<MapPlacesResult> {
    const types = this.parseTypes(query.types);
    const hasCenter = query.lat !== undefined || query.lng !== undefined;
    if (hasCenter && (query.lat === undefined || query.lng === undefined)) {
      throw new BadRequestException('Informe lat e lng juntos.');
    }
    if (query.radiusKm !== undefined && !hasCenter) {
      throw new BadRequestException('radiusKm exige lat e lng.');
    }
    const center = hasCenter ? { latitude: query.lat!, longitude: query.lng! } : undefined;
    const box = center && query.radiusKm !== undefined ? this.boundingBox(center, query.radiusKm) : undefined;
    const q = query.q?.trim() || undefined;
    const ownOrganizationId = requester.organizationId;

    const [units, classes, events, rodas] = await Promise.all([
      types.includes('UNIT') ? this.units(q, box, ownOrganizationId) : [],
      types.includes('CLASS') ? this.classes(q, box, ownOrganizationId) : [],
      types.includes('EVENT') ? this.events(query, q, box, requester) : [],
      types.includes('RODA') ? this.rodas(query, q, box, ownOrganizationId) : [],
    ]);

    let items = [...units, ...classes, ...events, ...rodas];
    if (center) {
      const withDistance: MapPlace[] = [];
      for (const item of items) {
        const distanceKm = Math.round(haversineKm(center, item) * 100) / 100;
        if (query.radiusKm !== undefined && distanceKm > query.radiusKm) continue;
        withDistance.push({ ...item, distanceKm });
      }
      items = withDistance.sort((a, b) => a.distanceKm! - b.distanceKm! || a.id.localeCompare(b.id));
    } else {
      // Fixos (unidade/treino) primeiro, por titulo; depois eventos/rodas por data.
      const rank = (t: MapPlaceType) => MAP_PLACE_TYPES.indexOf(t);
      items.sort(
        (a, b) =>
          Number(a.startsAt !== null) - Number(b.startsAt !== null) ||
          (a.startsAt ?? '').localeCompare(b.startsAt ?? '') ||
          rank(a.type) - rank(b.type) ||
          a.title.localeCompare(b.title, 'pt-BR') ||
          a.id.localeCompare(b.id),
      );
    }
    return { items: items.slice(0, query.limit ?? MAP_DEFAULT_LIMIT), total: items.length };
  }

  private parseTypes(raw: string | undefined): MapPlaceType[] {
    const requested = (raw ?? '')
      .split(',')
      .map((t) => t.trim().toUpperCase())
      .filter((t) => t.length > 0);
    if (requested.length === 0) return [...MAP_PLACE_TYPES];
    const invalid = requested.filter((t) => !(MAP_PLACE_TYPES as readonly string[]).includes(t));
    if (invalid.length > 0) {
      throw new BadRequestException(`types inválido — use uma lista separada por vírgula de: ${MAP_PLACE_TYPES.join(', ')}.`);
    }
    return [...new Set(requested)] as MapPlaceType[];
  }

  /** Caixa de latitude/longitude que contem o circulo (pre-filtro barato no SQL; o corte exato e' haversine em JS). */
  private boundingBox(center: { latitude: number; longitude: number }, radiusKm: number) {
    const dLat = radiusKm / 111.32;
    const dLng = radiusKm / (111.32 * Math.max(0.01, Math.cos((center.latitude * Math.PI) / 180)));
    return {
      minLat: center.latitude - dLat,
      maxLat: center.latitude + dLat,
      minLng: center.longitude - dLng,
      maxLng: center.longitude + dLng,
    };
  }

  /** Filtro das colunas latitude/longitude: ambas preenchidas (e dentro da caixa, se houver raio). */
  private coords(box?: ReturnType<MapService['boundingBox']>) {
    return box
      ? { latitude: { gte: box.minLat, lte: box.maxLat }, longitude: { gte: box.minLng, lte: box.maxLng } }
      : { latitude: { not: null }, longitude: { not: null } };
  }

  private async units(q: string | undefined, box: ReturnType<MapService['boundingBox']> | undefined, ownOrgId?: number) {
    const rows = await this.prisma.unit.findMany({
      where: {
        status: RecordStatus.ACTIVE,
        ...this.coords(box),
        organization: ORG_VISIBLE,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { address: { contains: q, mode: 'insensitive' } },
                { city: { contains: q, mode: 'insensitive' } },
                { organization: { name: { contains: q, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: { organization: { select: ORG_SELECT } },
      orderBy: { id: 'asc' },
      take: SOURCE_FETCH_CAP,
    });
    return rows.map((u) =>
      this.place({
        type: 'UNIT',
        id: u.id,
        // Matriz = o proprio nome do grupo; filial = "Grupo — Filial".
        title: u.isMain ? u.organization.name : `${u.organization.name} — ${u.name}`,
        description: short(u.organization.description),
        latitude: u.latitude!,
        longitude: u.longitude!,
        address: u.address,
        city: u.city,
        state: u.state,
        unitName: u.name,
        imageUrl: u.photo,
        organization: u.organization,
        ownOrgId,
      }),
    );
  }

  private async classes(q: string | undefined, box: ReturnType<MapService['boundingBox']> | undefined, ownOrgId?: number) {
    const rows = await this.prisma.class.findMany({
      where: {
        status: RecordStatus.ACTIVE,
        organization: ORG_VISIBLE,
        AND: [
          // Turma de unidade inativa some; turma sem unidade so' aparece se tem local PROPRIO (abaixo).
          { OR: [{ unitId: null }, { unit: { status: RecordStatus.ACTIVE } }] },
          // Posicao: a PROPRIA da turma (local do treino); senao a da unidade (heranca, como sempre foi).
          { OR: [this.coords(box), { unit: this.coords(box) }] },
          ...(q
            ? [
                {
                  OR: [
                    { name: { contains: q, mode: 'insensitive' as const } },
                    { locationLabel: { contains: q, mode: 'insensitive' as const } },
                    { address: { contains: q, mode: 'insensitive' as const } },
                    { city: { contains: q, mode: 'insensitive' as const } },
                    { unit: { name: { contains: q, mode: 'insensitive' as const } } },
                    { unit: { city: { contains: q, mode: 'insensitive' as const } } },
                    { organization: { name: { contains: q, mode: 'insensitive' as const } } },
                  ],
                },
              ]
            : []),
        ],
      },
      // Nada de teacher/alunos: so' o necessario para "treino de <turma> as <dia/hora> em <local>".
      select: {
        id: true,
        name: true,
        photo: true,
        weekday: true,
        startTime: true,
        endTime: true,
        locationLabel: true,
        address: true,
        city: true,
        state: true,
        latitude: true,
        longitude: true,
        organization: { select: ORG_SELECT },
        unit: { select: { name: true, photo: true, address: true, city: true, state: true, latitude: true, longitude: true } },
      },
      orderBy: { id: 'asc' },
      take: SOURCE_FETCH_CAP,
    });
    return rows.flatMap((c) => {
      // Local PROPRIO do treino (par completo) vence; senao herda a posicao/endereco da unidade.
      const own = c.latitude !== null && c.longitude !== null;
      const latitude = own ? c.latitude : (c.unit?.latitude ?? null);
      const longitude = own ? c.longitude : (c.unit?.longitude ?? null);
      if (latitude === null || longitude === null) return [];
      return [
        this.place({
          type: 'CLASS',
          id: c.id,
          title: c.name,
          description: short(c.organization.description),
          latitude,
          longitude,
          // Com pino proprio, o endereco e' o do treino (nunca mistura com o da unidade); herdando, o da unidade.
          address: own ? c.address : (c.unit?.address ?? null),
          city: own ? c.city : (c.unit?.city ?? null),
          state: own ? c.state : (c.unit?.state ?? null),
          locationLabel: c.locationLabel,
          weekday: c.weekday,
          startTime: c.startTime,
          endTime: c.endTime,
          unitName: c.unit?.name ?? null,
          // Foto da turma; sem ela, a da unidade (so' imagens, nunca dado de pessoa).
          imageUrl: c.photo ?? c.unit?.photo ?? null,
          organization: c.organization,
          ownOrgId,
        }),
      ];
    });
  }

  /** Janela de data de evento/roda: de `from` (padrao hoje; passado ate 30 dias) ate `to` (dia inclusivo). */
  private dateWindow(query: MapPlacesQueryDto): Prisma.DateTimeFilter {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const earliest = new Date(now.getTime() - PAST_WINDOW_DAYS * DAY_MS);
    let gte = startOfToday;
    if (query.from) {
      const from = new Date(`${query.from.slice(0, 10)}T00:00:00.000Z`);
      if (!Number.isNaN(from.getTime())) gte = from < earliest ? earliest : from;
    }
    const filter: Prisma.DateTimeFilter = { gte };
    if (query.to) {
      const to = new Date(`${query.to.slice(0, 10)}T00:00:00.000Z`);
      if (!Number.isNaN(to.getTime())) filter.lt = new Date(to.getTime() + DAY_MS);
    }
    return filter;
  }

  private async events(
    query: MapPlacesQueryDto,
    q: string | undefined,
    box: ReturnType<MapService['boundingBox']> | undefined,
    requester: AuthenticatedUser,
  ) {
    const ownOrgId = requester.organizationId;
    const and: Prisma.EventWhereInput[] = [
      // Rascunho (so' a equipe ve) e cancelado nao vao ao mapa; "encerrado" (inscricoes fechadas) ainda acontece.
      { status: { in: [EventStatus.PUBLISHED, EventStatus.CLOSED] } },
      { date: this.dateWindow(query) },
      { organization: ORG_VISIBLE },
      // Publico (como /calendar) OU do proprio grupo do usuario (como /events).
      { OR: [{ isPublic: true }, ...(ownOrgId !== undefined ? [{ organizationId: ownOrgId }] : [])] },
      // Coordenadas proprias; sem elas, as da unidade do evento (evento "na filial X").
      { OR: [this.coords(box), { unit: { status: RecordStatus.ACTIVE, ...this.coords(box) } }] },
    ];
    if (q) {
      and.push({
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { location: { contains: q, mode: 'insensitive' } },
          { city: { name: { contains: q, mode: 'insensitive' } } },
          { organization: { name: { contains: q, mode: 'insensitive' } } },
        ],
      });
    }
    // Professor restrito: nao ve eventos privados de unidades fora do escopo (evento publico segue publico).
    if (ownOrgId !== undefined) {
      const scope = await this.unitScope.resolve(requester, ownOrgId);
      if (isRestricted(scope)) {
        and.push({
          NOT: { organizationId: ownOrgId, isPublic: false, unitId: { not: null, notIn: scope } },
        });
      }
    }
    const rows = await this.prisma.event.findMany({
      where: { AND: and },
      include: {
        organization: { select: ORG_SELECT },
        unit: { select: { name: true, address: true, city: true, state: true, latitude: true, longitude: true } },
        city: { select: { name: true } },
        state: { select: { uf: true } },
      },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
      take: SOURCE_FETCH_CAP,
    });
    // Vagas restantes so' dos eventos COM capacidade (uma consulta agregada; sem dados de pessoas).
    const capped = rows.filter((e) => e.capacity !== null);
    const occupiedByEvent = new Map<number, number>();
    if (capped.length > 0) {
      const counts = await this.prisma.eventParticipant.groupBy({
        by: ['eventId'],
        where: { eventId: { in: capped.map((e) => e.id) }, status: { in: OCCUPYING_STATUSES } },
        _count: { _all: true },
      });
      for (const c of counts) occupiedByEvent.set(c.eventId, c._count._all);
    }
    return rows.flatMap((e) => {
      const latitude = e.latitude ?? e.unit?.latitude ?? null;
      const longitude = e.longitude ?? e.unit?.longitude ?? null;
      if (latitude === null || longitude === null) return [];
      return [
        this.place({
          type: 'EVENT',
          id: e.id,
          title: e.title,
          description: short(e.description),
          latitude,
          longitude,
          address: e.location ?? e.unit?.address ?? null,
          city: e.city?.name ?? e.unit?.city ?? null,
          state: e.state?.uf ?? e.unit?.state ?? null,
          startsAt: e.date.toISOString(),
          unitName: e.unit?.name ?? null,
          organization: e.organization,
          imageUrl: e.imageUrl,
          capacity: e.capacity,
          spotsLeft: spotsLeft(e.capacity, occupiedByEvent.get(e.id) ?? 0),
          ownOrgId,
        }),
      ];
    });
  }

  private async rodas(
    query: MapPlacesQueryDto,
    q: string | undefined,
    box: ReturnType<MapService['boundingBox']> | undefined,
    ownOrgId?: number,
  ) {
    const rows = await this.prisma.roda.findMany({
      where: {
        date: this.dateWindow(query),
        ...this.coords(box),
        // Roda sem grupo organizador e' publica e aparece; com grupo, respeita o mapVisible dele.
        AND: [
          { OR: [{ organizationId: null }, { organization: ORG_VISIBLE }] },
          ...(q
            ? [
                {
                  OR: [
                    { title: { contains: q, mode: 'insensitive' as const } },
                    { location: { contains: q, mode: 'insensitive' as const } },
                    { city: { name: { contains: q, mode: 'insensitive' as const } } },
                    { organization: { name: { contains: q, mode: 'insensitive' as const } } },
                  ],
                },
              ]
            : []),
        ],
      },
      include: {
        organization: { select: ORG_SELECT },
        city: { select: { name: true } },
        state: { select: { uf: true } },
      },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
      take: SOURCE_FETCH_CAP,
    });
    return rows.map((r) =>
      this.place({
        type: 'RODA',
        id: r.id,
        title: r.title,
        description: short(r.description),
        latitude: r.latitude!,
        longitude: r.longitude!,
        address: r.location,
        city: r.city?.name ?? null,
        state: r.state?.uf ?? null,
        startsAt: r.date.toISOString(),
        organization: r.organization,
        imageUrl: r.imageUrl,
        ownOrgId,
      }),
    );
  }

  private place(input: {
    type: MapPlaceType;
    id: number;
    title: string;
    description: string | null;
    latitude: number;
    longitude: number;
    address: string | null;
    city: string | null;
    state: string | null;
    startsAt?: string | null;
    weekday?: number | null;
    startTime?: string | null;
    endTime?: string | null;
    unitName?: string | null;
    locationLabel?: string | null;
    organization: OrgRow | null;
    imageUrl?: string | null;
    capacity?: number | null;
    spotsLeft?: number | null;
    ownOrgId?: number;
  }): MapPlace {
    const org = input.organization;
    return {
      id: `${input.type}:${input.id}`,
      type: input.type,
      title: input.title,
      description: input.description,
      latitude: input.latitude,
      longitude: input.longitude,
      address: input.address,
      city: input.city,
      state: input.state,
      startsAt: input.startsAt ?? null,
      endsAt: null,
      weekday: input.weekday ?? null,
      startTime: input.startTime ?? null,
      endTime: input.endTime ?? null,
      unitName: input.unitName ?? null,
      locationLabel: input.locationLabel ?? null,
      organization: org
        ? { id: org.id, name: org.name, slug: org.slug, logoUrl: org.logo, description: short(org.description) }
        : null,
      distanceKm: null,
      imageUrl: input.imageUrl ?? null,
      capacity: input.capacity ?? null,
      spotsLeft: input.spotsLeft ?? null,
      isMine: org !== null && input.ownOrgId !== undefined && org.id === input.ownOrgId,
    };
  }
}
