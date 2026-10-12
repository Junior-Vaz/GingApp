import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_FEATURE_KEY } from '../decorators/require-feature.decorator';
import { FeatureAccessService, GATED_FEATURES, GatedFeatureKey } from '../features/feature-access.service';
import { AuthenticatedRequest } from '../interfaces/authenticated-request.interface';

/**
 * Bloqueia rotas marcadas com @RequireFeature(key) quando o recurso esta desligado para o grupo do token (ver
 * FeatureAccessService). Global (APP_GUARD), depois do JwtAuthGuard/CanAccessGuard: rotas sem a marca passam direto
 * (zero consulta), assim como usuarios PLATFORM/super admin e requisicoes sem grupo (publicas).
 */
@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly features: FeatureAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.getAllAndOverride<GatedFeatureKey | undefined>(REQUIRE_FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!feature) return true;

    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user || user.userType === 'PLATFORM' || user.isSuperAdmin || user.organizationId === undefined) return true;

    if (!(await this.features.isEnabled(user.organizationId, feature))) {
      throw new ForbiddenException(`O recurso "${GATED_FEATURES[feature]}" não está disponível para o seu grupo.`);
    }
    return true;
  }
}
