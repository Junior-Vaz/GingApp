import { OrgRole } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';
import { blankImageToNull, IsImageRef } from '../../../../shared/uploads/image-ref';

/**
 * Update parcial. Campos limpaveis: `phone` e `photo` (User.phone/photo sao nullable): `null` limpa (photo tambem aceita '').
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

  /** Foto de perfil do usuário (User.photo — vale em todos os grupos). null ou '' LIMPA. */
  @IsOptional()
  @Transform(blankImageToNull)
  @IsImageRef()
  photo?: string | null;

  @ValidateIf((_, v) => v !== undefined)
  @IsIn([OrgRole.MESTRE, OrgRole.PROFESSOR, OrgRole.INSTRUTOR, OrgRole.MONITOR])
  role?: OrgRole;

  @ValidateIf((_, v) => v !== undefined)
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: string;
}