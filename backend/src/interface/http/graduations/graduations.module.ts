import { Module } from '@nestjs/common';
import { GraduationsController } from './graduations.controller';
import { GraduationsService } from './graduations.service';

@Module({
  controllers: [GraduationsController],
  providers: [GraduationsService],
  exports: [GraduationsService],
})
export class GraduationsModule {}
