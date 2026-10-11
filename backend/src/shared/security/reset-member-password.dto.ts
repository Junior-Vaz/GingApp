import { IsNewPassword } from './new-password.decorator';

/** Corpo de POST /teachers/:id/reset-password, /students/:id/reset-password e
 * /students/:id/guardians/:guardianId/reset-password (senha provisória definida pelo Mestre/Professor). */
export class ResetMemberPasswordDto {
  /** NÃO é aparada e NUNCA é devolvida nem logada. */
  @IsNewPassword()
  newPassword!: string;
}
