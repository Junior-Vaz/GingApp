import { Module } from '@nestjs/common';
import { StudentsModule } from '../students/students.module';
import { PeopleAdminService } from './people-admin.service';
import { PeopleController } from './people.controller';
import { PeopleCoreModule } from './people-core.module';

@Module({
  imports: [PeopleCoreModule, StudentsModule],
  controllers: [PeopleController],
  providers: [PeopleAdminService],
})
export class PeopleModule {}
