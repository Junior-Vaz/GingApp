import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { Public } from '../../../shared/decorators/public.decorator';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { RodasService } from './rodas.service';
import { CreateRodaDto } from './dto/create-roda.dto';
import { UpdateRodaDto } from './dto/update-roda.dto';

@Controller('rodas')
export class RodasController {
  constructor(private readonly rodasService: RodasService) {}

  @Public()
  @Get()
  findAll() {
    return this.rodasService.findAll();
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
}
