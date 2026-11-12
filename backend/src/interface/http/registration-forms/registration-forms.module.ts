import { Module } from '@nestjs/common';
import { CompetitorAnonymizer } from '../../../shared/privacy/competitor-anonymizer';
import { NotificationsModule } from '../notifications/notifications.module';
import { TOURNAMENT_PHOTO_SOURCE } from '../tournaments/tournament-photo-source';
import { PublicRegistrationFormsController } from './public-registration-forms.controller';
import { PublicRegistrationService } from './public-registration.service';
import { RegistrationEffectsService } from './registration-effects.service';
import { RegistrationFormsController } from './registration-forms.controller';
import { RegistrationFormsService } from './registration-forms.service';
import { RegistrationPhotoSource } from './registration-photo-source.service';
import { RegistrationSubmissionsService } from './registration-submissions.service';

/**
 * Formularios de inscricao publicos (docs/PLANO_FORMULARIOS_INSCRICAO.md, F1). Tambem exporta, com o token
 * TOURNAMENT_PHOTO_SOURCE, o provedor de foto/nascimento da inscricao para o chaveamento (docs/CONTRATO_FOTO_UPLOAD_CAMERA.md
 * secao 2): o TournamentsModule importa este modulo.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [RegistrationFormsController, PublicRegistrationFormsController],
  providers: [
    RegistrationFormsService,
    RegistrationSubmissionsService,
    PublicRegistrationService,
    RegistrationEffectsService,
    RegistrationPhotoSource,
    { provide: TOURNAMENT_PHOTO_SOURCE, useExisting: RegistrationPhotoSource },
    // Ponte LGPD -> chaveamento (anonimizar atletas ligados a inscricao anonimizada pelo Mestre).
    CompetitorAnonymizer,
  ],
  exports: [TOURNAMENT_PHOTO_SOURCE, RegistrationPhotoSource],
})
export class RegistrationFormsModule {}
