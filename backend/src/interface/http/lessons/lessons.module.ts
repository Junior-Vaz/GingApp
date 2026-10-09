import { Module } from '@nestjs/common';
import { ClassesModule } from '../classes/classes.module';
import { StudentsModule } from '../students/students.module';
import { LessonsController } from './lessons.controller';
import { LessonsService } from './lessons.service';

@Module({
  imports: [ClassesModule, StudentsModule],
  controllers: [LessonsController],
  providers: [LessonsService],
  exports: [LessonsService],
})
export class LessonsModule {}
