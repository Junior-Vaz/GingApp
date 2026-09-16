import { IsDateString, IsInt, IsOptional, IsString } from 'class-validator';

export class CreateLessonDto {
  @IsInt()
  classId!: number;

  @IsOptional()
  @IsInt()
  unitId?: number;

  @IsOptional()
  @IsInt()
  teacherUserId?: number;

  @IsDateString()
  date!: string;

  @IsOptional()
  @IsString()
  startTime?: string;

  @IsOptional()
  @IsString()
  endTime?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
