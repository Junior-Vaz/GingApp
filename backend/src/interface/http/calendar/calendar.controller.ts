import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { Public } from '../../../shared/decorators/public.decorator';
import { EVENT_TYPES } from '../events/dto/event-type';
import { CalendarService } from './calendar.service';

const SCOPES = ['today', 'week', 'month'] as const;
const TYPES = ['RODA', ...EVENT_TYPES] as const;

/** Público, sem autenticação — é o "calendário geral da capoeira" (projeto.txt §42), pensado
 * pra ser consultado por qualquer capoeirista, com ou sem conta GingApp. Reaproveita
 * /rodas/reference/states e /rodas/reference/cities para os selects de filtro (não duplica). */
@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  @Public()
  @Get()
  findAll(
    @Query('stateId') stateId?: string,
    @Query('cityId') cityId?: string,
    @Query('type') type?: string,
    @Query('scope') scope?: string,
  ) {
    if (scope && !SCOPES.includes(scope as (typeof SCOPES)[number])) {
      throw new BadRequestException(`scope inválido — use um de: ${SCOPES.join(', ')}.`);
    }
    if (type && !TYPES.includes(type as (typeof TYPES)[number])) {
      throw new BadRequestException(`type inválido — use um de: ${TYPES.join(', ')}.`);
    }

    return this.calendarService.findAll({
      stateId: stateId ? Number(stateId) : undefined,
      cityId: cityId ? Number(cityId) : undefined,
      type,
      scope: scope as 'today' | 'week' | 'month' | undefined,
    });
  }
}
