import { IsDateString, IsInt, IsOptional, IsString } from 'class-validator';

export class CreateStudentGraduationDto {
  @IsInt()
  graduationLevelId!: number;

  @IsDateString()
  graduatedAt!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
