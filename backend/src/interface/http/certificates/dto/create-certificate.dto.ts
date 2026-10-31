import { IsDateString, IsInt, IsOptional, IsString, IsUrl, Min, MinLength } from 'class-validator';

export class CreateCertificateDto {
  @IsInt()
  studentId!: number;

  @IsString()
  @MinLength(2)
  title!: string;

  @IsOptional()
  @IsInt()
  studentGraduationId?: number;

  @IsOptional()
  @IsDateString()
  issuedAt?: string;

  @IsOptional()
  @IsUrl()
  fileUrl?: string;

  /** Modelo de certificado do grupo (docs/CONTRATO_CERTIFICADOS_MODELOS.md secao 7). Omitido = padrão do uso ou o clássico. */
  @IsOptional()
  @IsInt()
  @Min(1)
  templateId?: number;
}
