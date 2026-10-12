import { Body, Controller, Get, HttpCode, Param, ParseArrayPipe, ParseIntPipe, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
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
