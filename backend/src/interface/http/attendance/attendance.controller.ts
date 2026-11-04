import {
  Body,
  Controller,
  ExecutionContext,
  Get,
  HttpCode,
  Param,
  ParseArrayPipe,
  ParseIntPipe,
  Post,
  Query,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { UserThrottlerGuard } from '../../../shared/guards/user-throttler.guard';
import { CommunicationsExceptionFilter } from '../communications/communications-http';
import { GeoCheckinDto } from './dto/geo-checkin.dto';
import { sendPage } from '../../../shared/pagination/pagination';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { AttendanceService } from './attendance.service';
import { ListMyAttendanceQueryDto } from './dto/list-my-attendance-query.dto';
import { AttendanceEntryDto } from './dto/mark-attendance.dto';
import { AttendanceCheckinService } from './attendance-checkin.service';
import { EventCheckinSelfDto } from '../events/dto/event-checkin-self.dto';

/** Limite lido a cada pedido (os e2e trocam a env). */
const envNumber = (name: string, fallback: number): number => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * POST /attendance/geo-checkin: o mesmo @Throttle vale para o guard global (antes do login: conta por IP) e para o
 * UserThrottlerGuard da rota (depois do login: conta por usuario), como em certificate-templates/feed. Por usuario 10/min;
 * por IP o mesmo teto global do QR (GLOBAL_THROTTLE_LIMIT, 600/min) — o check-in da turma inteira sai do mesmo Wi-Fi.
 */
const GEO_CHECKIN_THROTTLE = {
  default: {
    ttl: 60_000,
    limit: (ctx: ExecutionContext) =>
      ctx.switchToHttp().getRequest<{ user?: unknown }>().user
        ? envNumber('GEO_CHECKIN_THROTTLE_LIMIT', 10)
        : envNumber('GEO_CHECKIN_IP_THROTTLE_LIMIT', envNumber('GLOBAL_THROTTLE_LIMIT', 600)),
  },
};

@Controller('attendance')
export class AttendanceController {
  constructor(
    private readonly attendanceService: AttendanceService,
    private readonly checkinService: AttendanceCheckinService,
  ) {}

  /** O aluno (ou responsável, por um dependente) confirma a PRÓPRIA presença na aula lendo o QR da turma.
   * Sem @CanAccess: self-service; a autorização é o vínculo aluno/matrícula validado no service. */
  @Post('self-checkin')
  @HttpCode(200)
  selfCheckin(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: EventCheckinSelfDto,
  ) {
    return this.checkinService.selfCheckin(organizationId, user, dto);
  }

  /**
   * Check-in por LOCALIZACAO (docs/CONTRATO_CHECKIN_GEOLOCALIZACAO.md secao 3): o que o usuario (e seus dependentes)
   * pode registrar AGORA. Sem @CanAccess (self-service, como o QR); nunca devolve coordenadas.
   */
  @Get('geo-checkin/available')
  @UseFilters(CommunicationsExceptionFilter)
  geoCheckinAvailable(@CurrentOrganization() organizationId: number, @CurrentUser() user: AuthenticatedUser) {
    return this.checkinService.geoAvailable(organizationId, user);
  }

  /**
   * Registra a presenca do proprio aluno (ou dependente) pela posicao do aparelho. 10/min POR USUARIO
   * (GEO_CHECKIN_THROTTLE_LIMIT) e o teto por IP do QR (GEO_CHECKIN_IP_THROTTLE_LIMIT, padrao = o global de 600/min: a
   * turma inteira faz check-in atras do mesmo Wi-Fi). 429 com code TOO_MANY_REQUESTS. Latitude/longitude/precisao NUNCA
   * sao gravadas nem logadas (o log de requisicao nao registra corpo).
   */
  @Post('geo-checkin')
  @HttpCode(200)
  @UseGuards(UserThrottlerGuard)
  @Throttle(GEO_CHECKIN_THROTTLE)
  @UseFilters(CommunicationsExceptionFilter)
  geoCheckin(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GeoCheckinDto,
  ) {
    return this.checkinService.geoCheckin(organizationId, user, dto);
  }

  /** Token + QR (data URL) de check-in da aula, para a equipe exibir/imprimir. */
  @Get('lessons/:lessonId/checkin-token')
  @CanAccess('attendance', 'create')
  checkinToken(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('lessonId', ParseIntPipe) lessonId: number,
  ) {
    return this.checkinService.issueToken(organizationId, lessonId, user);
  }

  @Get()
  @CanAccess('attendance', 'view')
  findAll(@CurrentOrganization() organizationId: number, @CurrentUser() user: AuthenticatedUser) {
    return this.attendanceService.findAll(organizationId, user);
  }

  /** Sem @CanAccess: escopado por construção aos alunos do próprio usuário. Corpo
   * { records, last30dPercent, currentStreak }; `records` é paginado (limit/offset) e filtrável
   * por from/to (data da aula), com o total em X-Total-Count. Os indicadores são agregados no banco. */
  @Get('me')
  async findMine(
    @CurrentOrganization() organizationId: number,
    @CurrentUser('id') userId: number,
    @Query() query: ListMyAttendanceQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { records, total, last30dPercent, currentStreak } = await this.attendanceService.findMine(
      organizationId,
      userId,
      query,
    );
    return { records: sendPage(res, { items: records, total }), last30dPercent, currentStreak };
  }

  /** Chamada rápida: aulas de HOJE (São Paulo) visíveis ao usuário, com contagem de alunos e de marcados. Equipe (attendance:view). */
  @Get('quick-sessions')
  @CanAccess('attendance', 'view')
  quickSessions(@CurrentOrganization() organizationId: number, @CurrentUser() user: AuthenticatedUser) {
    return this.attendanceService.quickSessions(organizationId, user);
  }

  @Get('lessons/:lessonId')
  @CanAccess('attendance', 'view')
  getRoster(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('lessonId', ParseIntPipe) lessonId: number,
  ) {
    return this.attendanceService.getRoster(organizationId, lessonId, user);
  }

  @Post('lessons/:lessonId')
  @CanAccess('attendance', 'create')
  markAttendance(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('lessonId', ParseIntPipe) lessonId: number,
    @Body(new ParseArrayPipe({ items: AttendanceEntryDto })) entries: AttendanceEntryDto[],
  ) {
    return this.attendanceService.markAttendance(organizationId, lessonId, entries, user);
  }
}
