import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { StudentsService } from './students.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';

@Controller('students')
export class StudentsController {
  constructor(private readonly studentsService: StudentsService) {}

  @Get()
  @CanAccess('students', 'view')
  findAll(@CurrentOrganization() organizationId: number) {
    return this.studentsService.findAll(organizationId);
  }

  @Get(':id')
  @CanAccess('students', 'view')
  findOne(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number) {
    return this.studentsService.findOne(organizationId, id);
  }

  @Post()
  @CanAccess('students', 'create')
  create(@CurrentOrganization() organizationId: number, @Body() dto: CreateStudentDto) {
    return this.studentsService.create(organizationId, dto);
  }

  @Patch(':id')
  @CanAccess('students', 'edit')
  update(
    @CurrentOrganization() organizationId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStudentDto,
  ) {
    return this.studentsService.update(organizationId, id, dto);
  }

  @Delete(':id')
  @CanAccess('students', 'delete')
  remove(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number) {
    return this.studentsService.remove(organizationId, id);
  }
}
