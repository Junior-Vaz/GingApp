import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserType } from '@prisma/client';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { SuperAdminGuard } from '../../../shared/guards/super-admin.guard';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { OrganizationsService } from './organizations.service';

/** Criar grupo é raro e sensível (cria também credenciais): 10/min por IP por padrão. Configurável por
 * env só para os e2e, que criam dezenas de grupos em sequência (mesmo padrão de LOGIN_THROTTLE_LIMIT). */
export const ORG_CREATE_THROTTLE_LIMIT = Number(process.env.ORG_CREATE_THROTTLE_LIMIT ?? 10);

/**
 * GET /organizations serve os dois públicos do sistema, seguindo a mesma rota descrita em
 * PLANO_PROJETO.md §4: equipe PLATFORM (equivalente a /tenants do GestorPrint) vê todas as
 * organizações; um usuário MEMBER vê apenas a própria (nunca a de outro grupo).
 *
 * POST /organizations é exclusivo de super admin ATIVO da plataforma (SuperAdminGuard, a mesma regra
 * da gestão da equipe e das escritas de configurações): cria o grupo + o seu MESTRE.
 */
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    const isPlatformUser = user.userType === UserType.PLATFORM || user.isSuperAdmin;

    if (isPlatformUser) {
      return this.organizationsService.findAllForPlatform();
    }

    return this.organizationsService.findOwn(user.organizationId!);
  }

  @Post()
  @UseGuards(SuperAdminGuard)
  @Throttle({ default: { limit: ORG_CREATE_THROTTLE_LIMIT, ttl: 60_000 } })
  create(@Body() dto: CreateOrganizationDto) {
    return this.organizationsService.createGroup(dto);
  }
}
