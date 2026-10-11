import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { PlatformOnlyGuard } from '../../../shared/guards/platform-only.guard';
import { SubscriptionsService } from './subscriptions.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { ListSubscriptionsQueryDto } from './dto/list-subscriptions-query.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  /** Único endpoint deste controller acessível a um MEMBER — a própria organização vendo seu
   * plano/limites. Devolve plano, preço (priceCents) e ids do gateway de pagamento, ou seja, é
   * informação FINANCEIRA do grupo: exige `finance.view` na matriz RolePermission (hoje só o
   * MESTRE; PROFESSOR/ALUNO/RESPONSAVEL = 403; PLATFORM/superAdmin têm bypass do guard) — a
   * mesma permissão que já separa quem vê o financeiro do grupo. Além disso a segurança vem de
   * sempre escopar por CurrentOrganization (nunca por um :id vindo do cliente). Precisa vir
   * antes de qualquer rota ':id' do controller. Consumidor legítimo: painel (Configurações,
   * só MESTRE). */
  @Get('me')
  @CanAccess('finance', 'view')
  findMine(@CurrentOrganization() organizationId: number) {
    return this.subscriptionsService.findMine(organizationId);
  }

  @Get()
  @UseGuards(PlatformOnlyGuard)
  findAll(@Query() query: ListSubscriptionsQueryDto) {
    return this.subscriptionsService.findAll(query.organizationId);
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
