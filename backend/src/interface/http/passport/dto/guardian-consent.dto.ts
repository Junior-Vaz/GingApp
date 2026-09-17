import { IsBoolean, IsInt } from 'class-validator';

export class GuardianConsentDto {
  @IsInt()
  studentId!: number;

  @IsBoolean()
  consent!: boolean;
}
