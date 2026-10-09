import { Module } from '@nestjs/common';
import { PlatformTeamController } from './platform-team.controller';
import { PlatformTeamService } from './platform-team.service';

@Module({
  controllers: [PlatformTeamController],
  providers: [PlatformTeamService],
})
export class PlatformTeamModule {}
