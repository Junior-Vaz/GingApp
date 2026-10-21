import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { MestreOnlyGuard } from '../../../shared/guards/mestre-only.guard';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { BirthdaysService } from './birthdays.service';
import { GreetBirthdayDto, ListBirthdaysQueryDto, UpdateBirthdaySettingsDto } from './dto/birthdays.dto';

/**
 * Aniversariantes (docs/CONTRATO_FEED_ANIVERSARIOS_COMUNICACAO.md secao 2).
 *  - EQUIPE (painel): GET /birthdays e /birthdays/summary = quem le alunos (`students:view`); POST :personId/greet = quem envia
 *    aviso (`announcements:create`); GET/PUT /birthdays/settings = so MESTRE.
 *  - MEMBROS (app): GET /birthdays/week e POST :personId/congratulate - sem @CanAccess (qualquer membro autenticado do grupo);
 *    a privacidade (menores, opt-out, sem idade) e aplicada no service.
 * As rotas estaticas (summary/week/settings) nao colidem com `:personId` (so POST).
 */
@Controller('birthdays')
export class BirthdaysController {
  constructor(private readonly birthdays: BirthdaysService) {}

  @Get()
  @CanAccess('students', 'view')
  list(@CurrentOrganization() organizationId: number, @CurrentUser() user: AuthenticatedUser, @Query() query: ListBirthdaysQueryDto) {
    return this.birthdays.list(organizationId, user, query);
  }

  @Get('summary')
  @CanAccess('students', 'view')
  summary(@CurrentOrganization() organizationId: number, @CurrentUser() user: AuthenticatedUser) {
    return this.birthdays.summary(organizationId, user);
  }

  @Get('week')
  week(@CurrentOrganization() organizationId: number, @CurrentUser() user: AuthenticatedUser) {
    return this.birthdays.week(organizationId, user);
  }

  @Get('settings')
  @UseGuards(MestreOnlyGuard)
  getSettings(@CurrentOrganization() organizationId: number) {
    return this.birthdays.getSettings(organizationId);
  }

  @Put('settings')
  @UseGuards(MestreOnlyGuard)
  updateSettings(@CurrentOrganization() organizationId: number, @Body() dto: UpdateBirthdaySettingsDto) {
    return this.birthdays.updateSettings(organizationId, dto);
  }

  @Post(':personId/greet')
  @HttpCode(HttpStatus.OK)
  @CanAccess('announcements', 'create')
  greet(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('personId', ParseIntPipe) personId: number,
    @Body() dto: GreetBirthdayDto,
  ) {
    return this.birthdays.greet(organizationId, user, personId, dto);
  }

  @Post(':personId/congratulate')
  @HttpCode(HttpStatus.OK)
  congratulate(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('personId', ParseIntPipe) personId: number,
  ) {
    return this.birthdays.congratulate(organizationId, user, personId);
  }
}
