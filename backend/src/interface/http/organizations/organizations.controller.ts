import { Controller, Get } from '@nestjs/common';
import { UserType } from '@prisma/client';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { OrganizationsService } from './organizations.service';

/**
 * GET /organizations serve os dois públicos do sistema, seguindo a mesma rota descrita em
 * PLANO_PROJETO.md §4: equipe PLATFORM (equivalente a /tenants do GestorPrint) vê todas as
 * organizações; um usuário MEMBER vê apenas a própria (nunca a de outro grupo).
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
}
