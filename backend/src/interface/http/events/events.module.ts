import { Module } from '@nestjs/common';
import { StudentsModule } from '../students/students.module';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({
  imports: [StudentsModule],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
