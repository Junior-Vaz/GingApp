import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { RodasModule } from '../rodas/rodas.module';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';

@Module({
  imports: [RodasModule, EventsModule],
  controllers: [CalendarController],
  providers: [CalendarService],
})
export class CalendarModule {}
