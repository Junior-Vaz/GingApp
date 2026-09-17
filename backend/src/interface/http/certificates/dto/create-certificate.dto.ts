import { IsDateString, IsInt, IsOptional, IsString, IsUrl, MinLength } from 'class-validator';

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
}
