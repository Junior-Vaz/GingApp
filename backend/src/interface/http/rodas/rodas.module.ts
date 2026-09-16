import { Module } from '@nestjs/common';
import { RodasController } from './rodas.controller';
import { RodasService } from './rodas.service';

@Module({
  controllers: [RodasController],
  providers: [RodasService],
  exports: [RodasService],
})
export class RodasModule {}
