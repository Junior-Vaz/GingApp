import { SetMetadata } from '@nestjs/common';
import { GatedFeatureKey } from '../features/feature-access.service';

export const REQUIRE_FEATURE_KEY = 'requireFeature';

/**
 * Condiciona um controller/rota a um recurso do plano/grupo (Plan.features + OrganizationFeatureOverride).
 * Recurso desligado => 403 para os usuarios do grupo (a equipe PLATFORM nao e' afetada). Lido pelo FeatureGuard (global).
 *
 * Uso: @RequireFeature('certificates') no controller.
 */
export const RequireFeature = (feature: GatedFeatureKey): ReturnType<typeof SetMetadata> =>
  SetMetadata(REQUIRE_FEATURE_KEY, feature);
