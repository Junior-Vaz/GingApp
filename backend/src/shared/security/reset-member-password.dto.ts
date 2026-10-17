import { IsOptional } from 'class-validator';
import { IsNewPassword } from './new-password.decorator';

/** Corpo de POST /teachers/:id/reset-password (senha provisória definida pelo Mestre/Professor): `newPassword` obrigatória. */
export class ResetMemberPasswordDto {
  /** NÃO é aparada e NUNCA é devolvida nem logada. */
  @IsNewPassword()
  newPassword!: string;
}

/**
 * Corpo de POST /students/:id/reset-password e /students/:id/guardians/:guardianId/reset-password: `newPassword` é
 * OPCIONAL — omitida (ou null), o servidor gera uma senha provisória fácil (generateTemporaryPassword) e a devolve UMA
 * vez na resposta (`temporaryPassword`). Informada, segue a política de @IsNewPassword e nada é devolvido (204).
 */
export class ResetStudentPasswordDto {
  @IsOptional()
  @IsNewPassword()
  newPassword?: string;
}
