import { Injectable } from '@nestjs/common';
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

  async findAll(filters: CalendarFilters): Promise<CalendarItem[]> {
    const { from, to } = this.resolveDateRange(filters.scope);
    const includeRodas = !filters.type || filters.type === 'RODA';
    const includeEvents = !filters.type || filters.type !== 'RODA';
    const eventType = filters.type && filters.type !== 'RODA' ? filters.type : undefined;

    const [rodas, events] = await Promise.all([
      includeRodas
        ? this.prisma.roda.findMany({
            where: {
              date: { gte: from, lte: to },
              stateId: filters.stateId,
              cityId: filters.cityId,
            },
            include: { state: true, city: true },
            orderBy: { date: 'asc' },
            take: 100,
          })
        : Promise.resolve([]),
      includeEvents
        ? this.prisma.event.findMany({
            where: {
              isPublic: true,
              date: { gte: from, lte: to },
              stateId: filters.stateId,
              cityId: filters.cityId,
              type: eventType,
            },
            include: { state: true, city: true },
            orderBy: { date: 'asc' },
            take: 100,
          })
        : Promise.resolve([]),
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
        state: e.state,
        city: e.city,
      })),
    ];

    items.sort((a, b) => a.date.getTime() - b.date.getTime());
    return items;
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
