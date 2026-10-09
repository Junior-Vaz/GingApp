import { IsNewPassword } from '../../../../shared/security/new-password.decorator';

/** Corpo de POST /organizations/:orgId/members/:userId/reset-password (nova senha de um MESTRE). */
export class ResetMestrePasswordDto {
  /** NÃO é aparada e NUNCA é devolvida nem logada. */
  @IsNewPassword()
  newPassword!: string;
}
