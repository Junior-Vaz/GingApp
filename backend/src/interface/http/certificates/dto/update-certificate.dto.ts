import { IsDateString, IsOptional, IsString, IsUrl, MinLength, ValidateIf } from 'class-validator';

/** studentId/studentGraduationId nunca mudam num certificado já emitido — corrigir o aluno
 * errado é apagar e emitir de novo (evita reescrever a autoria de um documento já
 * potencialmente compartilhado via QR Code).
 *
 * Limpar campo: só `fileUrl` aceita null. `title` é obrigatório e `issuedAt` é sempre preenchido
 * na emissão (create usa agora) e é exibido na verificação pública — por regra de negócio não se
 * limpa: ausente = não muda; null = 400. */
export class UpdateCertificateDto {
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MinLength(2)
  title?: string;

  @ValidateIf((_, v) => v !== undefined)
  @IsDateString()
  issuedAt?: string;

  @IsOptional()
  @IsUrl()
  fileUrl?: string | null;
}
