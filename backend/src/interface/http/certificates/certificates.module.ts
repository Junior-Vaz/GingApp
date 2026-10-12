import { Module } from '@nestjs/common';
import { RankingModule } from '../ranking/ranking.module';
import { StudentsModule } from '../students/students.module';
import { CertificatesController } from './certificates.controller';
import { PublicCertificatesController } from './public-certificates.controller';
import { CertificatesService } from './certificates.service';

@Module({
  imports: [StudentsModule, RankingModule],
  controllers: [CertificatesController, PublicCertificatesController],
  providers: [CertificatesService],
  exports: [CertificatesService],
})
export class CertificatesModule {}
