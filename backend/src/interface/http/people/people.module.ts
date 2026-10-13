import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { StudentsModule } from '../students/students.module';
import { PeopleAdminService } from './people-admin.service';
import { PeopleController } from './people.controller';
import { PeopleCoreModule } from './people-core.module';
import { PublicTransferApprovalController } from './public-transfer-approval.controller';
import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';
import { OccurrencesController } from './occurrences.controller';
import { OccurrencesService } from './occurrences.service';

@Module({
  imports: [PeopleCoreModule, StudentsModule, NotificationsModule],
  controllers: [PeopleController, TransfersController, OccurrencesController, PublicTransferApprovalController],
  providers: [PeopleAdminService, TransfersService, OccurrencesService],
  exports: [TransfersService],
})
export class PeopleModule {}
