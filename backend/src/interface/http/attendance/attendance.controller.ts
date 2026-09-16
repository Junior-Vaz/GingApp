import { Body, Controller, Get, Param, ParseArrayPipe, ParseIntPipe, Post } from '@nestjs/common';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { AttendanceService } from './attendance.service';
import { AttendanceEntryDto } from './dto/mark-attendance.dto';

@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Get()
  @CanAccess('attendance', 'view')
  findAll(@CurrentOrganization() organizationId: number) {
    return this.attendanceService.findAll(organizationId);
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
