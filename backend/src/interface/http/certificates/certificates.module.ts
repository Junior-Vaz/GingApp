import { Module } from '@nestjs/common';
import { RankingModule } from '../ranking/ranking.module';
import { StudentsModule } from '../students/students.module';
import { CertificateTemplatesController } from './certificate-templates.controller';
import { CertificateTemplatesService } from './certificate-templates.service';
import { CertificatesController } from './certificates.controller';
import { PublicCertificatesController } from './public-certificates.controller';
import { CertificatesService } from './certificates.service';

@Module({
  imports: [StudentsModule, RankingModule],
  controllers: [CertificatesController, PublicCertificatesController, CertificateTemplatesController],
  providers: [CertificatesService, CertificateTemplatesService],
  exports: [CertificatesService, CertificateTemplatesService],
})
export class CertificatesModule {}
