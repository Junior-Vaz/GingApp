import { Module } from '@nestjs/common';
import { CompetitorAnonymizer } from '../../../shared/privacy/competitor-anonymizer';
import { AnonymizationService } from './anonymization.service';
import { DataDeletionRequestsController } from './data-deletion-requests.controller';
import { DataDeletionRequestsService } from './data-deletion-requests.service';

@Module({
  controllers: [DataDeletionRequestsController],
  providers: [DataDeletionRequestsService, AnonymizationService, CompetitorAnonymizer],
})
export class DataDeletionRequestsModule {}
