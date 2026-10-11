import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { sendPage } from '../../../shared/pagination/pagination';
import { ListLessonsQueryDto } from './dto/list-lessons-query.dto';
import { ListMyLessonsQueryDto } from './dto/list-my-lessons-query.dto';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { LessonsService } from './lessons.service';
import { CreateLessonDto } from './dto/create-lesson.dto';
import { UpdateLessonDto } from './dto/update-lesson.dto';

@Controller('lessons')
export class LessonsController {
  constructor(private readonly lessonsService: LessonsService) {}

  @Get()
  @CanAccess('lessons', 'view')
  async findAll(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListLessonsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendPage(res, await this.lessonsService.findAll(organizationId, query, user));
  }

  /** Sem @CanAccess: escopado por construção às turmas do próprio usuário. Paginado (total em
   * X-Total-Count), com from/to/status/order — ver LessonsService.findMine. */
  @Get('me')
  async findMine(
    @CurrentOrganization() organizationId: number,
    @CurrentUser('id') userId: number,
    @Query() query: ListMyLessonsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendPage(res, await this.lessonsService.findMine(organizationId, userId, query));
  }

  @Get(':id')
  @CanAccess('lessons', 'view')
  findOne(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.lessonsService.findOne(organizationId, id, user);
  }

  @Post()
  @CanAccess('lessons', 'create')
  create(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateLessonDto,
  ) {
    return this.lessonsService.create(organizationId, dto, user);
  }

  @Patch(':id')
  @CanAccess('lessons', 'edit')
  update(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateLessonDto,
  ) {
    return this.lessonsService.update(organizationId, id, dto, user);
  }

  @Delete(':id')
  @CanAccess('lessons', 'delete')
  remove(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.lessonsService.remove(organizationId, id, user);
  }
}
