import { Prisma, PrismaClient } from '@prisma/client';
import { isMinor } from '../ranking/ranking-rules';

/**
 * SSOT de "quem decide pela PESSOA" (transferencia - Fase 2; contestacao de ocorrencia - Fase 4): adulto = o proprio
 * login (Person.userId); MENOR (nascimento < 18 anos) = so os responsaveis com login de qualquer matricula da pessoa.
 * Nascimento ausente = tratado como adulto.
 */
export interface PersonDeciders {
  minor: boolean;
  selfUserId: number | null;
  guardianUserIds: number[];
  /** Quem e avisado/decide: o proprio login (adulto) ou os responsaveis (menor). */
  userIds: number[];
}

type Db = PrismaClient | Prisma.TransactionClient;

export async function personDeciders(db: Db, personId: number): Promise<PersonDeciders> {
  const person = await db.person.findUniqueOrThrow({ where: { id: personId }, select: { userId: true, birthDate: true } });
  const minor = isMinor(person.birthDate);
  const guardians = await db.studentGuardian.findMany({
    where: { student: { personId }, userId: { not: null } },
    select: { userId: true },
  });
  const guardianUserIds = [...new Set(guardians.map((g) => g.userId!))];
  const userIds = minor ? guardianUserIds : person.userId ? [person.userId] : [];
  return { minor, selfUserId: person.userId, guardianUserIds, userIds };
}

export function decidingAs(d: Pick<PersonDeciders, 'minor' | 'selfUserId' | 'guardianUserIds'>, userId: number): 'SELF' | 'GUARDIAN' | null {
  if (d.minor) return d.guardianUserIds.includes(userId) ? 'GUARDIAN' : null;
  return d.selfUserId === userId ? 'SELF' : null;
}

/** Fichas visiveis ao login: a propria (Person.userId) e as dos dependentes (StudentGuardian.userId, qualquer grupo). */
export async function personIdsVisibleTo(db: Db, userId: number): Promise<number[]> {
  const [own, guarded] = await Promise.all([
    db.person.findMany({ where: { userId }, select: { id: true } }),
    db.studentGuardian.findMany({ where: { userId, student: { personId: { not: null } } }, select: { student: { select: { personId: true } } } }),
  ]);
  return [...new Set([...own.map((p) => p.id), ...guarded.map((g) => g.student.personId!)])];
}
