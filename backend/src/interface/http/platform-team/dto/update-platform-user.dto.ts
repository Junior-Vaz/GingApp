import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

export const PLATFORM_USER_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type PlatformUserStatus = (typeof PLATFORM_USER_STATUSES)[number];

/** Update parcial. `null` é rejeitado em name/status/isSuperAdmin (ValidateIf só pula undefined);
 * `phone: null` limpa o telefone. */
export class UpdatePlatformUserDto {
  @ValidateIf((o: UpdatePlatformUserDto) => o.name !== undefined)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @ValidateIf((o: UpdatePlatformUserDto) => o.status !== undefined)
  @IsIn(PLATFORM_USER_STATUSES)
  status?: PlatformUserStatus;

  @ValidateIf((o: UpdatePlatformUserDto) => o.isSuperAdmin !== undefined)
  @IsBoolean()
  isSuperAdmin?: boolean;
}
