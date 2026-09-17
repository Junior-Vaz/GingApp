import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { PassportService } from './passport.service';
import { PublishPassportDto } from './dto/publish-passport.dto';
import { GuardianConsentDto } from './dto/guardian-consent.dto';

/** Sem @CanAccess em nenhuma rota: tudo aqui é self-service, escopado por vínculo com o aluno
 * (o próprio ou um dependente), nunca por papel/RBAC — mesmo espírito de StudentsService.findMine. */
@Controller('passport')
export class PassportController {
  constructor(private readonly passportService: PassportService) {}

  @Get('me')
  getMine(@CurrentOrganization() organizationId: number, @CurrentUser('id') userId: number) {
    return this.passportService.getMine(organizationId, userId);
  }

  @Post('publish')
  publish(
    @CurrentOrganization() organizationId: number,
    @CurrentUser('id') userId: number,
    @Body() dto: PublishPassportDto,
  ) {
    return this.passportService.publish(organizationId, userId, dto.studentId);
  }

  @Post('unpublish')
  unpublish(
    @CurrentOrganization() organizationId: number,
    @CurrentUser('id') userId: number,
    @Body() dto: PublishPassportDto,
  ) {
    return this.passportService.unpublish(organizationId, userId, dto.studentId);
  }

  /** Só um responsável cadastrado do aluno pode chamar isto (checado no service) — autoriza
   * (ou revoga) a publicação do Passaporte de um dependente. */
  @Patch('guardian-consent')
  setGuardianConsent(
    @CurrentOrganization() organizationId: number,
    @CurrentUser('id') userId: number,
    @Body() dto: GuardianConsentDto,
  ) {
    return this.passportService.setGuardianConsent(organizationId, userId, dto.studentId, dto.consent);
  }
}
