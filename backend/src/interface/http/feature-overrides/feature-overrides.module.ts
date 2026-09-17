import { Module } from '@nestjs/common';
import { FeatureOverridesController } from './feature-overrides.controller';
import { FeatureOverridesService } from './feature-overrides.service';

@Module({
  controllers: [FeatureOverridesController],
  providers: [FeatureOverridesService],
})
export class FeatureOverridesModule {}
