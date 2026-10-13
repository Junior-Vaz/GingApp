import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { UpdateMyPersonDto } from './dto/transfers.dto';
import { TransfersService } from './transfers.service';
import { OccurrencesService } from './occurrences.service';
import { ContestOccurrenceDto } from './occurrences.controller';
import { requireLinkedStudent } from '../../../shared/access/linked-student';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { PlatformOnlyGuard } from '../../../shared/guards/platform-only.guard';
import { SuperAdminGuard } from '../../../shared/guards/super-admin.guard';
import { StudentsService } from '../students/students.service';
import { MergePeopleDto, PeopleMeQueryDto } from './dto/people.dto';
import { PeopleAdminService } from './people-admin.service';
import { PersonFichaService } from './person-ficha.service';

/**
 * FICHA UNICA (docs/FICHA_UNICA.md):
 *  - GET /people/me/ficha e /people/me/code: a PROPRIA pessoa (ou o responsavel, com ?studentId= do dependente,
 *    conferido por resolveLink - sem vinculo = 404). Sem @CanAccess: a seguranca vem do vinculo, como as outras /me.
 *  - GET /people/duplicates e POST /people/merge: so super admin ATIVO da plataforma.
 * A ficha vista pela EQUIPE do grupo e GET /students/:id/ficha (StudentsController).
 */
@Controller('people')
export class PeopleController {
  constructor(
    private readonly ficha: PersonFichaService,
    private readonly admin: PeopleAdminService,
    private readonly students: StudentsService,
    private readonly transfers: TransfersService,
    private readonly occurrences: OccurrencesService,
  ) {}

  private async linkedStudentId(organizationId: number, userId: number, studentId?: number): Promise<number | undefined> {
    if (studentId === undefined) return undefined;
    return (await requireLinkedStudent(this.students, organizationId, userId, studentId)).id;
  }

  @Get('me/ficha')
  async myFicha(
    @CurrentOrganization() organizationId: number,
    @CurrentUser('id') userId: number,
    @Query() query: PeopleMeQueryDto,
  ) {
    return this.ficha.forSelf(organizationId, userId, await this.linkedStudentId(organizationId, userId, query.studentId));
  }

  @Get('me/code')
  async myCode(
    @CurrentOrganization() organizationId: number,
    @CurrentUser('id') userId: number,
    @Query() query: PeopleMeQueryDto,
  ) {
    return this.ficha.myCode(organizationId, userId, await this.linkedStudentId(organizationId, userId, query.studentId));
  }

  /** A propria pessoa edita a ficha (nome, apelido, foto, contato); propaga as matriculas. */
  @Patch('me')
  updateMe(@CurrentUser('id') userId: number, @Body() dto: UpdateMyPersonDto) {
    return this.ficha.updateMyPerson(userId, dto);
  }

  /** Pedidos de transferencia para a propria pessoa e para os dependentes (responsavel). */
  @Get('me/transfers')
  myTransfers(@CurrentUser('id') userId: number) {
    return this.transfers.listMine(userId);
  }

  @Post('me/transfers/:id/approve')
  @HttpCode(HttpStatus.OK)
  approve(@CurrentUser('id') userId: number, @Param('id', ParseIntPipe) id: number) {
    return this.transfers.decide(userId, id, true);
  }

  @Post('me/transfers/:id/decline')
  @HttpCode(HttpStatus.OK)
  decline(@CurrentUser('id') userId: number, @Param('id', ParseIntPipe) id: number) {
    return this.transfers.decide(userId, id, false);
  }

  /** Ocorrencias registradas por grupos sobre a propria pessoa e os dependentes (com o motivo, para poder contestar). */
  @Get('me/occurrences')
  myOccurrences(@CurrentUser('id') userId: number) {
    return this.occurrences.listMine(userId);
  }

  @Post('me/occurrences/:id/contest')
  @HttpCode(HttpStatus.OK)
  contestOccurrence(@CurrentUser('id') userId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: ContestOccurrenceDto) {
    return this.occurrences.contest(userId, id, dto.note);
  }

  @Get('duplicates')
  @UseGuards(PlatformOnlyGuard, SuperAdminGuard)
  duplicates() {
    return this.admin.duplicates();
  }

  @Post('merge')
  @UseGuards(PlatformOnlyGuard, SuperAdminGuard)
  @HttpCode(HttpStatus.OK)
  merge(@Body() dto: MergePeopleDto) {
    return this.admin.merge(dto.keepId, dto.mergeId);
  }
}
