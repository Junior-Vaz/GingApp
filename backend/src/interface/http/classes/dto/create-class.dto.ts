import { IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import { IsAfterTimeOf, IsTimeOfDay } from '../../../../shared/dates/time-of-day';

export class CreateClassDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsInt()
  unitId?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  weekday?: number;

  @IsOptional()
  @IsTimeOfDay()
  startTime?: string;

  @IsOptional()
  @IsTimeOfDay()
  @IsAfterTimeOf('startTime')
  endTime?: string;
}
