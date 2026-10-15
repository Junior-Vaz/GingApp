import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
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
import { ReactivateLessonsDto } from './dto/reactivate-lessons.dto';
import { BulkDeleteLessonsDto } from './dto/bulk-delete-lessons.dto';
import { MestreOnlyGuard } from '../../../shared/guards/mestre-only.guard';

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

  /** Reativa em massa as aulas canceladas do periodo/turma (padrao: sem avisar os alunos). Reativar = editar => `lessons:edit`. */
  @Post('reactivate')
  @HttpCode(200)
  @CanAccess('lessons', 'edit')
  reactivate(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReactivateLessonsDto,
  ) {
    return this.lessonsService.reactivate(organizationId, dto, user);
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

  /** Apaga em lote aulas CANCELADAS (hard delete), so o Mestre. dryRun so conta; presencas exigem confirm: true (409 com a contagem). */
  @Post('bulk-delete')
  @HttpCode(200)
  @CanAccess('lessons', 'delete')
  @UseGuards(MestreOnlyGuard)
  bulkDelete(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BulkDeleteLessonsDto,
  ) {
    return this.lessonsService.bulkDelete(organizationId, dto, user);
  }

  /** Quantas presencas seriam apagadas junto com a aula (diálogo de confirmação do painel). */
  @Get(':id/delete-impact')
  @CanAccess('lessons', 'delete')
  @UseGuards(MestreOnlyGuard)
  deleteImpact(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.lessonsService.deleteImpact(organizationId, id, user);
  }

  /**
   * APAGA de verdade a aula (hard delete), so o Mestre. Cancelar = PATCH /lessons/:id { status: 'INACTIVE' }.
   * Com presencas registradas exige ?confirm=true (sem ele: 409 com { attendances: N }).
   */
  @Delete(':id')
  @CanAccess('lessons', 'delete')
  @UseGuards(MestreOnlyGuard)
  remove(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Query('confirm') confirm?: string,
  ) {
    return this.lessonsService.destroy(organizationId, id, confirm === 'true', user);
  }
}
