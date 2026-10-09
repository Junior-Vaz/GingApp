import { Module } from '@nestjs/common';
import { StudentsModule } from '../students/students.module';
import { GraduationsController } from './graduations.controller';
import { GraduationsService } from './graduations.service';

@Module({
  imports: [StudentsModule],
  controllers: [GraduationsController],
  providers: [GraduationsService],
  exports: [GraduationsService],
})
export class GraduationsModule {}
