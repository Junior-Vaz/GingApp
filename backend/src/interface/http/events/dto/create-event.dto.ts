import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, MinLength } from 'class-validator';
import { EVENT_TYPES } from './event-type';

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

  @IsOptional()
  @IsIn(EVENT_TYPES)
  type?: string;

  @IsOptional()
  @IsInt()
  stateId?: number;

  @IsOptional()
  @IsInt()
  cityId?: number;
}
