import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PublicRegistrationFormsController } from './public-registration-forms.controller';
import { PublicRegistrationService } from './public-registration.service';
import { RegistrationEffectsService } from './registration-effects.service';
import { RegistrationFormsController } from './registration-forms.controller';
import { RegistrationFormsService } from './registration-forms.service';
import { RegistrationSubmissionsService } from './registration-submissions.service';

/** Formularios de inscricao publicos (docs/PLANO_FORMULARIOS_INSCRICAO.md, F1). */
@Module({
  imports: [NotificationsModule],
  controllers: [RegistrationFormsController, PublicRegistrationFormsController],
  providers: [RegistrationFormsService, RegistrationSubmissionsService, PublicRegistrationService, RegistrationEffectsService],
})
export class RegistrationFormsModule {}
