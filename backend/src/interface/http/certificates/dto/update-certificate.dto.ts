import { IsDateString, IsOptional, IsString, IsUrl, MinLength } from 'class-validator';

/** studentId/studentGraduationId nunca mudam num certificado já emitido — corrigir o aluno
 * errado é apagar e emitir de novo (evita reescrever a autoria de um documento já
 * potencialmente compartilhado via QR Code). */
export class UpdateCertificateDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  title?: string;

  @IsOptional()
  @IsDateString()
  issuedAt?: string;

  @IsOptional()
  @IsUrl()
  fileUrl?: string;
}
