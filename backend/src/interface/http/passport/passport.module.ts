import { Module } from '@nestjs/common';
import { StudentsModule } from '../students/students.module';
import { PassportController } from './passport.controller';
import { PublicPassportController } from './public-passport.controller';
import { PassportService } from './passport.service';

@Module({
  imports: [StudentsModule],
  controllers: [PassportController, PublicPassportController],
  providers: [PassportService],
})
export class PassportModule {}
