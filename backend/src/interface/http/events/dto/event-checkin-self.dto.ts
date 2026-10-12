import { IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

/** Corpo de POST /events/:id/checkin-self e POST /attendance/self-checkin: o código lido do QR (ou digitado) e,
 * opcionalmente, qual dependente faz o check-in. */
export class EventCheckinSelfDto {
  /** Token de check-in (ex.: "E12-K7QXM3PA2B") ou a URL do QR (…/checkin?token=…). */
  @IsString()
  @Length(4, 300)
  token!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  studentId?: number;
}
