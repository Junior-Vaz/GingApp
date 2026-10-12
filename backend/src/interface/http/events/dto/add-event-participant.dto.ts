import { ParticipantStatus } from '@prisma/client';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Adiciona um participante a um evento: OU um aluno cadastrado (studentId) OU um convidado
 * sem cadastro (guestName) — nunca os dois nem nenhum dos dois. A validação de
 * "exatamente um dos dois" é feita no service (regra de negócio, não de forma do campo).
 */
export class AddEventParticipantDto {
  @IsOptional()
  @IsInt()
  studentId?: number;

  @IsOptional()
  @IsString()
  @MinLength(2)
  guestName?: string;

  @IsOptional()
  @IsEnum(ParticipantStatus)
  status?: ParticipantStatus;

  /** Evento lotado: com `true` a inscrição entra na lista de espera (WAITLIST) em vez de responder 409. */
  @IsOptional()
  @IsBoolean()
  joinWaitlist?: boolean;
}
