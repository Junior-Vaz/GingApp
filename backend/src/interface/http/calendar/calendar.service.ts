import { Injectable } from '@nestjs/common';
import { Page, pageArgs } from '../../../shared/pagination/pagination';
import { PrismaService } from '../../../shared/prisma/prisma.service';

export interface CalendarFilters {
  stateId?: number;
  cityId?: number;
  /** 'RODA' ou um dos EVENT_TYPES — undefined inclui tudo. */
  type?: string;
  scope?: 'today' | 'week' | 'month';
}

export interface CalendarItem {
  id: number;
  source: 'RODA' | 'EVENTO';
  type: string;
  title: string;
  description: string | null;
  date: Date;
  location: string | null;
  imageUrl: string | null;
  state: { id: number; name: string; uf: string } | null;
  city: { id: number; name: string } | null;
}

/**
 * Calendário da capoeira (projeto.txt §42, Fase 2 — Jornada do Capoeirista, PLANO_PROJETO.md
 * §10.17): agrega Roda (já é pública desde a fundação, sem isolamento por organização) e Event
 * com `isPublic = true` (nunca eventos privados de um grupo) num único feed, cruzando TODAS as
 * organizações — diferente de `EventsService.findAll`, que é escopado a uma organização.
 *
 * `id` sozinho colide entre Roda e Event (tabelas diferentes) — por isso todo item carrega
 * `source`, e o front deve tratar a chave como `${source}-${id}`.
 */
@Injectable()
export class CalendarService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Feed paginado (limit/offset, padrão 50, teto 200) em ordem cronológica (data, depois origem e
   * id: determinística). `total` = rodas + eventos públicos que casam com os filtros (vai em
   * X-Total-Count). Como o feed junta duas tabelas, cada uma devolve só as primeiras
   * `offset + limit` linhas na MESMA ordem e a fusão corta a página — correto sem carregar tudo.
   */
  async findAll(
    filters: CalendarFilters,
    page: { limit?: number; offset?: number } = {},
  ): Promise<Page<CalendarItem>> {
    const { take, skip } = pageArgs(page);
    const window = skip + take;
    const { from, to } = this.resolveDateRange(filters.scope);
    const includeRodas = !filters.type || filters.type === 'RODA';
    const includeEvents = !filters.type || filters.type !== 'RODA';
    const eventType = filters.type && filters.type !== 'RODA' ? filters.type : undefined;
    const orderBy = [{ date: 'asc' as const }, { id: 'asc' as const }];

    const rodaWhere = { date: { gte: from, lte: to }, stateId: filters.stateId, cityId: filters.cityId };
    const eventWhere = { isPublic: true, ...rodaWhere, type: eventType };

    const [rodas, events, rodaTotal, eventTotal] = await Promise.all([
      includeRodas
        ? this.prisma.roda.findMany({ where: rodaWhere, include: { state: true, city: true }, orderBy, take: window })
        : Promise.resolve([]),
      includeEvents
        ? this.prisma.event.findMany({ where: eventWhere, include: { state: true, city: true }, orderBy, take: window })
        : Promise.resolve([]),
      includeRodas ? this.prisma.roda.count({ where: rodaWhere }) : Promise.resolve(0),
      includeEvents ? this.prisma.event.count({ where: eventWhere }) : Promise.resolve(0),
    ]);

    const items: CalendarItem[] = [
      ...rodas.map((r) => ({
        id: r.id,
        source: 'RODA' as const,
        type: 'RODA',
        title: r.title,
        description: r.description,
        date: r.date,
        location: r.location,
        imageUrl: r.imageUrl,
        state: r.state,
        city: r.city,
      })),
      ...events.map((e) => ({
        id: e.id,
        source: 'EVENTO' as const,
        type: e.type,
        title: e.title,
        description: e.description,
        date: e.date,
        location: e.location,
        imageUrl: e.imageUrl,
        state: e.state,
        city: e.city,
      })),
    ];

    items.sort(
      (a, b) => a.date.getTime() - b.date.getTime() || a.source.localeCompare(b.source) || a.id - b.id,
    );
    return { items: items.slice(skip, skip + take), total: rodaTotal + eventTotal };
  }

  /** Sem `scope`, mostra tudo a partir de hoje (sem limite futuro) — mesmo espírito do feed
   * de ComunidadeView.vue, que já filtrava "a partir de hoje" no cliente. */
  private resolveDateRange(scope?: 'today' | 'week' | 'month'): { from: Date; to?: Date } {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (scope === 'today') {
      const endOfToday = new Date(startOfToday);
      endOfToday.setDate(endOfToday.getDate() + 1);
      return { from: startOfToday, to: endOfToday };
    }
    if (scope === 'week') {
      const endOfWeek = new Date(startOfToday);
      endOfWeek.setDate(endOfWeek.getDate() + 7);
      return { from: startOfToday, to: endOfWeek };
    }
    if (scope === 'month') {
      const endOfMonth = new Date(startOfToday);
      endOfMonth.setMonth(endOfMonth.getMonth() + 1);
      return { from: startOfToday, to: endOfMonth };
    }
    return { from: startOfToday };
  }
}
