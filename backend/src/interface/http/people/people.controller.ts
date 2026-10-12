import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
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
