import { Transform } from 'class-transformer';
import { IsOptional } from 'class-validator';
import { blankImageToNull, IsImageRef } from '../../../../shared/uploads/image-ref';

/**
 * PATCH /auth/me/profile — perfil da PRÓPRIA conta (User). Hoje só a foto (User.photo, vale em todos os grupos;
 * é a foto do professor/mestre mostrada nas turmas e aulas). `photo`: caminho de POST /uploads
 * (/api/uploads/<uuid>.<ext>) ou URL http(s); null ou '' LIMPA. O aluno continua usando PATCH /students/me/profile
 * (foto do cadastro de aluno).
 */
export class UpdateAccountProfileDto {
  @IsOptional()
  @Transform(blankImageToNull)
  @IsImageRef()
  photo?: string | null;
}
