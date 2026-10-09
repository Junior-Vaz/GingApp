import { BadRequestException, Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../../shared/decorators/public.decorator';
import { MAX_PAGE_SIZE, sendPage } from '../../../shared/pagination/pagination';
import { EVENT_TYPES } from '../events/dto/event-type';
import { CalendarService } from './calendar.service';

const SCOPES = ['today', 'week', 'month'] as const;
const TYPES = ['RODA', ...EVENT_TYPES] as const;
/** Teto do offset: a rota é pública e cada fonte carrega `offset + limit` linhas para a fusão. */
const MAX_OFFSET = 10_000;

/** Inteiro da query string dentro de [min, max]; ausente => undefined; fora disso => 400. */
function intParam(name: string, raw: string | undefined, min: number, max: number): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new BadRequestException(`${name} inválido — use um inteiro entre ${min} e ${max}.`);
  }
  return value;
}

/** Público, sem autenticação — é o "calendário geral da capoeira" (projeto.txt §42), pensado
 * pra ser consultado por qualquer capoeirista, com ou sem conta GingApp. Reaproveita
 * /rodas/reference/states e /rodas/reference/cities para os selects de filtro (não duplica). */
@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  @Public()
  @Get()
  async findAll(
    @Res({ passthrough: true }) res: Response,
    @Query('stateId') stateId?: string,
    @Query('cityId') cityId?: string,
    @Query('type') type?: string,
    @Query('scope') scope?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    if (scope && !SCOPES.includes(scope as (typeof SCOPES)[number])) {
      throw new BadRequestException(`scope inválido — use um de: ${SCOPES.join(', ')}.`);
    }
    if (type && !TYPES.includes(type as (typeof TYPES)[number])) {
      throw new BadRequestException(`type inválido — use um de: ${TYPES.join(', ')}.`);
    }

    const page = await this.calendarService.findAll(
      {
        stateId: stateId ? Number(stateId) : undefined,
        cityId: cityId ? Number(cityId) : undefined,
        type,
        scope: scope as 'today' | 'week' | 'month' | undefined,
      },
      { limit: intParam('limit', limit, 1, MAX_PAGE_SIZE), offset: intParam('offset', offset, 0, MAX_OFFSET) },
    );
    return sendPage(res, page);
  }
}
