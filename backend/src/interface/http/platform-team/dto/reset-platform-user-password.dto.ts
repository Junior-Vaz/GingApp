import { IsNewPassword } from '../../../../shared/security/new-password.decorator';

export class ResetPlatformUserPasswordDto {
  /** Política SSOT da senha nova (@IsNewPassword): 12..72 bytes, sem Dev@12345. */
  @IsNewPassword()
  password!: string;
}
