import { IsInt, Max, Min } from 'class-validator';

export class EnrollStudentDto {
  @IsInt()
  @Min(1)
  @Max(2147483647)
  studentId!: number;
}
