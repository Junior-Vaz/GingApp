import { IsBoolean, IsDateString, IsInt, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateEventDto {
  @IsString()
  @MinLength(2)
  title!: string;

  @IsDateString()
  date!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsInt()
  unitId?: number;

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}
