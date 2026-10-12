import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, Max, Min } from 'class-validator';

/** Filtros comuns dos relatórios: período (datas civis, inclusivas) e unidade. Cada relatório define o período padrão. */
export class ReportPeriodQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  unitId?: number;
}

export class AttendanceReportQueryDto extends ReportPeriodQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  classId?: number;
}
