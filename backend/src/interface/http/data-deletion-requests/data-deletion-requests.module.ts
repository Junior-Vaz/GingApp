import { Module } from '@nestjs/common';
import { DataDeletionRequestsController } from './data-deletion-requests.controller';
import { DataDeletionRequestsService } from './data-deletion-requests.service';

@Module({
  controllers: [DataDeletionRequestsController],
  providers: [DataDeletionRequestsService],
})
export class DataDeletionRequestsModule {}
