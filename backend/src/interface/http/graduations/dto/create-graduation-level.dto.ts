import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateGraduationLevelDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsInt()
  @Min(0)
  order!: number;

  @IsOptional()
  @IsString()
  color?: string;
}
