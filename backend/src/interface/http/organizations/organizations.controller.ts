import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { PageQueryDto, sendPage } from '../../../shared/pagination/pagination';
import { Throttle } from '@nestjs/throttler';
import { RecordStatus, UserType } from '@prisma/client';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { PlatformOnlyGuard } from '../../../shared/guards/platform-only.guard';
import { SuperAdminGuard } from '../../../shared/guards/super-admin.guard';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { ResetMestrePasswordDto } from './dto/reset-mestre-password.dto';
import { OrganizationsService } from './organizations.service';

/** Criar grupo é raro e sensível (cria também credenciais): 10/min por IP por padrão. Configurável por
 * env só para os e2e, que criam dezenas de grupos em sequência (mesmo padrão de LOGIN_THROTTLE_LIMIT). */
export const ORG_CREATE_THROTTLE_LIMIT = Number(process.env.ORG_CREATE_THROTTLE_LIMIT ?? 10);
/** Reset de senha de MESTRE (operação rara e sensível do super admin): 10/min por IP; env só para os e2e. */
export const MESTRE_RESET_THROTTLE_LIMIT = Number(process.env.MESTRE_RESET_THROTTLE_LIMIT ?? 10);

/**
 * GET /organizations serve os dois públicos do sistema, seguindo a mesma rota descrita em
 * PLANO_PROJETO.md §4: equipe PLATFORM (equivalente a /tenants do GestorPrint) vê todas as
 * organizações; um usuário MEMBER vê apenas a própria (nunca a de outro grupo).
 *
 * POST /organizations é exclusivo de super admin ATIVO da plataforma (SuperAdminGuard, a mesma regra
 * da gestão da equipe e das escritas de configurações): cria o grupo + o seu MESTRE.
 *
 * GET /organizations/:id é só da equipe PLATFORM (PlatformOnlyGuard, a mesma condição do ramo PLATFORM
 * do GET /organizations): a organização + os MESTREs. POST :orgId/members/:userId/reset-password é do
 * super admin ativo: redefine a senha de um MESTRE do grupo e revoga as sessões dele.
 *
 * PATCH /organizations/:id (name, document, email, phone; slug imutável) e POST :id/deactivate|reactivate
 * são do super admin ativo. Desativar NUNCA apaga dados: só marca o grupo INACTIVE, e os usuários dele
 * deixam de logar/usar token (ver AuthService.login e JwtStrategy).
 */
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get()
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PageQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const isPlatformUser = user.userType === UserType.PLATFORM || user.isSuperAdmin;

    if (isPlatformUser) {
      // Corpo continua um array; o total vem em X-Total-Count (padrão das demais listagens).
      return sendPage(res, await this.organizationsService.findAllForPlatform(query));
    }

    return this.organizationsService.findOwn(user.organizationId!);
  }

  @Post()
  @UseGuards(SuperAdminGuard)
  @Throttle({ default: { limit: ORG_CREATE_THROTTLE_LIMIT, ttl: 60_000 } })
  create(@Body() dto: CreateOrganizationDto) {
    return this.organizationsService.createGroup(dto);
  }

  @Get(':id')
  @UseGuards(PlatformOnlyGuard)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.organizationsService.findOneForPlatform(id);
  }

  @Patch(':id')
  @UseGuards(SuperAdminGuard)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateOrganizationDto) {
    return this.organizationsService.update(id, dto);
  }

  @Post(':id/deactivate')
  @UseGuards(SuperAdminGuard)
  @HttpCode(HttpStatus.OK)
  deactivate(@Param('id', ParseIntPipe) id: number) {
    return this.organizationsService.setStatus(id, RecordStatus.INACTIVE);
  }

  @Post(':id/reactivate')
  @UseGuards(SuperAdminGuard)
  @HttpCode(HttpStatus.OK)
  reactivate(@Param('id', ParseIntPipe) id: number) {
    return this.organizationsService.setStatus(id, RecordStatus.ACTIVE);
  }

  @Post(':orgId/members/:userId/reset-password')
  @UseGuards(SuperAdminGuard)
  @Throttle({ default: { limit: MESTRE_RESET_THROTTLE_LIMIT, ttl: 60_000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetMestrePassword(
    @Param('orgId', ParseIntPipe) orgId: number,
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: ResetMestrePasswordDto,
  ): Promise<void> {
    await this.organizationsService.resetMestrePassword(orgId, userId, dto);
  }
}
