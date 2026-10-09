import { OrgRole } from '@prisma/client';
import { IsIn, IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';

/**
 * Update parcial. Unico campo limpavel e `phone` (User.phone e nullable): `null` limpa.
 * name/role/status sao obrigatorios no schema: `null` falha a validacao (400) via
 * `@ValidateIf(v !== undefined)` (um `@IsOptional()` deixaria passar e o Prisma daria 500).
 */
export class UpdateTeacherDto {
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  phone?: string | null;

  @ValidateIf((_, v) => v !== undefined)
  @IsIn([OrgRole.MESTRE, OrgRole.PROFESSOR])
  role?: OrgRole;

  @ValidateIf((_, v) => v !== undefined)
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: string;
}