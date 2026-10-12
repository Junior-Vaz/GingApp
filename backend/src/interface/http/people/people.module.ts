import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { StudentsModule } from '../students/students.module';
import { PeopleAdminService } from './people-admin.service';
import { PeopleController } from './people.controller';
import { PeopleCoreModule } from './people-core.module';
import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';

@Module({
  imports: [PeopleCoreModule, StudentsModule, NotificationsModule],
  controllers: [PeopleController, TransfersController],
  providers: [PeopleAdminService, TransfersService],
  exports: [TransfersService],
})
export class PeopleModule {}
