import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { DELETION_REQUEST_STATUSES, DeletionRequestStatus } from '../deletion-request-status';

/** PATCH /data-deletion-requests/:id. `note` = nota interna do tratamento (obrigatoria ao REJEITAR; ver o service). */
export class UpdateDataDeletionRequestDto {
  @IsIn(DELETION_REQUEST_STATUSES, { message: `status deve ser um de: ${DELETION_REQUEST_STATUSES.join(', ')}.` })
  status!: DeletionRequestStatus;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(1000)
  note?: string;
}
