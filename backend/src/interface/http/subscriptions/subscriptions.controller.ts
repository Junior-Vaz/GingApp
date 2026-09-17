import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { PlatformOnlyGuard } from '../../../shared/guards/platform-only.guard';
import { SubscriptionsService } from './subscriptions.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  /** Único endpoint deste controller acessível a um MEMBER — a própria organização vendo seu
   * plano/limites. Sem @UseGuards(PlatformOnlyGuard) e sem @CanAccess: a segurança vem de
   * sempre escopar por CurrentOrganization (nunca por um :id vindo do cliente). Precisa vir
   * antes de qualquer rota ':id' do controller. */
  @Get('me')
  findMine(@CurrentOrganization() organizationId: number) {
    return this.subscriptionsService.findMine(organizationId);
  }

  @Get()
  @UseGuards(PlatformOnlyGuard)
  findAll() {
    return this.subscriptionsService.findAll();
  }

  @Get(':id')
  @UseGuards(PlatformOnlyGuard)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.subscriptionsService.findOne(id);
  }

  @Post()
  @UseGuards(PlatformOnlyGuard)
  create(@Body() dto: CreateSubscriptionDto) {
    return this.subscriptionsService.create(dto);
  }

  @Patch(':id')
  @UseGuards(PlatformOnlyGuard)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSubscriptionDto) {
    return this.subscriptionsService.update(id, dto);
  }

  @Post(':id/cancel')
  @UseGuards(PlatformOnlyGuard)
  cancel(@Param('id', ParseIntPipe) id: number) {
    return this.subscriptionsService.cancel(id);
  }
}
