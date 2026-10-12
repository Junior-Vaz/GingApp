import { Module } from '@nestjs/common';
import { StudentsModule } from '../students/students.module';
import { ClassLessonsRollingService } from './class-lessons-rolling.service';
import { ClassesController } from './classes.controller';
import { ClassesService } from './classes.service';

@Module({
  imports: [StudentsModule],
  controllers: [ClassesController],
  providers: [ClassesService, ClassLessonsRollingService],
  exports: [ClassesService, ClassLessonsRollingService],
})
export class ClassesModule {}
