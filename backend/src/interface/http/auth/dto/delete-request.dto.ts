import { IsOptional, IsString, MaxLength } from 'class-validator';

/** POST /auth/me/delete-request: motivo opcional do pedido de exclusão/anonimização. */
export class DeleteRequestDto {
  @IsOptional()
  @IsString({ message: 'O motivo deve ser um texto.' })
  @MaxLength(1000, { message: 'O motivo deve ter no máximo 1000 caracteres.' })
  reason?: string;
}
