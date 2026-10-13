import { Module } from '@nestjs/common';
import { AnonymizationService } from './anonymization.service';
import { DataDeletionRequestsController } from './data-deletion-requests.controller';
import { DataDeletionRequestsService } from './data-deletion-requests.service';

@Module({
  controllers: [DataDeletionRequestsController],
  providers: [DataDeletionRequestsService, AnonymizationService],
})
export class DataDeletionRequestsModule {}
