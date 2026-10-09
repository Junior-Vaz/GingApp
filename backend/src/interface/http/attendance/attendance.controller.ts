import { Body, Controller, Get, Param, ParseArrayPipe, ParseIntPipe, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { sendPage } from '../../../shared/pagination/pagination';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { AttendanceService } from './attendance.service';
import { ListMyAttendanceQueryDto } from './dto/list-my-attendance-query.dto';
import { AttendanceEntryDto } from './dto/mark-attendance.dto';

@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Get()
  @CanAccess('attendance', 'view')
  findAll(@CurrentOrganization() organizationId: number) {
    return this.attendanceService.findAll(organizationId);
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

  @Get('lessons/:lessonId')
  @CanAccess('attendance', 'view')
  getRoster(
    @CurrentOrganization() organizationId: number,
    @Param('lessonId', ParseIntPipe) lessonId: number,
  ) {
    return this.attendanceService.getRoster(organizationId, lessonId);
  }

  @Post('lessons/:lessonId')
  @CanAccess('attendance', 'create')
  markAttendance(
    @CurrentOrganization() organizationId: number,
    @Param('lessonId', ParseIntPipe) lessonId: number,
    @Body(new ParseArrayPipe({ items: AttendanceEntryDto })) entries: AttendanceEntryDto[],
  ) {
    return this.attendanceService.markAttendance(organizationId, lessonId, entries);
  }
}
