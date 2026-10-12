import { ConflictException } from '@nestjs/common';
import { EventStatus, ParticipantStatus } from '@prisma/client';

/**
 * Regras puras de inscricao em eventos (vagas, lista de espera, prazo, status). Sem Prisma/Nest: o EventsService
 * resolve os numeros e estas funcoes decidem.
 *
 * Vaga ocupada = inscricao CONFIRMED ou ATTENDED (INVITED/DECLINED/CANCELLED/WAITLIST nao ocupam).
 */
export const OCCUPYING_STATUSES: ParticipantStatus[] = [ParticipantStatus.CONFIRMED, ParticipantStatus.ATTENDED];

/** Codigo estavel (campo `code` do corpo do 409) que o painel/app usam para oferecer "Entrar na lista de espera". */
export const EVENT_FULL_CODE = 'EVENT_FULL';

export function occupiesSpot(status: ParticipantStatus): boolean {
  return OCCUPYING_STATUSES.includes(status);
}

/** Vagas restantes (null = ilimitado). Nunca negativo (a equipe pode inscrever alem da capacidade). */
export function spotsLeft(capacity: number | null | undefined, occupied: number): number | null {
  return capacity == null ? null : Math.max(0, capacity - occupied);
}

export function isFull(capacity: number | null | undefined, occupied: number): boolean {
  return capacity != null && occupied >= capacity;
}

export interface RegistrationEvent {
  status: EventStatus;
  date: Date;
  registrationDeadline: Date | null;
}

/**
 * Motivo pelo qual a INSCRICAO esta fechada, ou null se aberta. A equipe (MESTRE/PROFESSOR) ignora o prazo e o
 * encerramento (pode inscrever alunos depois), mas ninguem se inscreve em evento cancelado.
 */
export function registrationClosedReason(event: RegistrationEvent, isAdmin: boolean, now: Date = new Date()): string | null {
  if (event.status === EventStatus.CANCELLED) return 'Este evento foi cancelado.';
  if (isAdmin) return null;
  if (event.status === EventStatus.CLOSED) return 'As inscrições deste evento estão encerradas.';
  if (event.registrationDeadline && now.getTime() > event.registrationDeadline.getTime()) {
    return 'O prazo de inscrição deste evento terminou.';
  }
  return null;
}

export function assertRegistrationOpen(event: RegistrationEvent, isAdmin: boolean, now: Date = new Date()): void {
  const reason = registrationClosedReason(event, isAdmin, now);
  if (reason) throw new ConflictException(reason);
}

/** 409 de evento lotado, com `code` estavel para o front oferecer a lista de espera. */
export function eventFullConflict(): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    code: EVENT_FULL_CODE,
    message: 'Evento lotado. Você pode entrar na lista de espera.',
  });
}
