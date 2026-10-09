import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { sendPage } from '../../../shared/pagination/pagination';
import { ListRodasQueryDto } from './dto/list-rodas-query.dto';
import { Public } from '../../../shared/decorators/public.decorator';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { RodasService } from './rodas.service';
import { CreateRodaDto } from './dto/create-roda.dto';
import { UpdateRodaDto } from './dto/update-roda.dto';

@Controller('rodas')
export class RodasController {
  constructor(private readonly rodasService: RodasService) {}

  @Public()
  @Get()
  async findAll(@Query() query: ListRodasQueryDto, @Res({ passthrough: true }) res: Response) {
    return sendPage(res, await this.rodasService.findAll(query));
  }

  @Public()
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.rodasService.findOne(id);
  }

  /** Dados públicos de referência para os selects de estado/cidade do formulário. */
  @Public()
  @Get('reference/states')
  listStates() {
    return this.rodasService.listStates();
  }

  @Public()
  @Get('reference/cities')
  listCities(@Query('stateId') stateId?: string) {
    return this.rodasService.listCities(stateId ? Number(stateId) : undefined);
  }

  @Post()
  @CanAccess('rodas', 'create')
  create(@CurrentOrganization() organizationId: number, @Body() dto: CreateRodaDto) {
    return this.rodasService.create(organizationId, dto);
  }

  @Patch(':id')
  @CanAccess('rodas', 'edit')
  update(
    @CurrentOrganization() organizationId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRodaDto,
  ) {
    return this.rodasService.update(organizationId, id, dto);
  }

  @Delete(':id')
  @CanAccess('rodas', 'delete')
  remove(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number) {
    return this.rodasService.remove(organizationId, id);
  }

  /** Lista pública (quem confirmou presença) — mesmo espírito de findAll/findOne. */
  @Public()
  @Get(':id/participants')
  listParticipants(@Param('id', ParseIntPipe) id: number) {
    return this.rodasService.listParticipants(id);
  }

  /** "Quero participar" — sem @CanAccess: qualquer MEMBER autenticado pode confirmar
   * presença na própria conta (não é uma ação administrativa da organização). */
  @Post(':id/participants')
  join(@CurrentUser('id') userId: number, @Param('id', ParseIntPipe) id: number) {
    return this.rodasService.join(id, userId);
  }

  @Delete(':id/participants/:participantId')
  leave(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('participantId', ParseIntPipe) participantId: number,
  ) {
    return this.rodasService.leave(id, participantId, user);
  }
}
