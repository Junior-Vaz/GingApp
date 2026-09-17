import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { PlatformOnlyGuard } from '../../../shared/guards/platform-only.guard';
import { PlansService } from './plans.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';

/** Catálogo de planos — exclusivo da equipe PLATFORM (admin.gingapp.com.br), primeiro uso
 * real do PlatformOnlyGuard (existia desde a fundação, nunca tinha sido aplicado a um
 * controller — ver PLANO_PROJETO.md §10.13). */
@Controller('plans')
@UseGuards(PlatformOnlyGuard)
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  @Get()
  findAll() {
    return this.plansService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.plansService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreatePlanDto) {
    return this.plansService.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePlanDto) {
    return this.plansService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.plansService.deactivate(id);
  }
}
