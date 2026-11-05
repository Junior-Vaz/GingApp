import { OrgRole } from '@prisma/client';
import type { PrismaService } from '../../../shared/prisma/prisma.service';
import { ageOn } from './feed-text';

/**
 * SSOT da regra de MENOR usada pelo feed (FeedService.isMinor) e pelos patrocinadores (docs/CONTRATO_PATROCINADORES.md
 * secao 5: "igual ao criterio do feed"). Extraida do FeedService sem mudar o comportamento.
 */

/** Data de nascimento conhecida: < 18 anos (dia civil de Sao Paulo) = menor. Sem data: decide `undatedIsMinor`. */
export function isMinorByBirthDate(birthDate: Date | null | undefined, undatedIsMinor: boolean, now: Date = new Date()): boolean {
  if (!birthDate) return undatedIsMinor;
  return ageOn(birthDate, now) < 18;
}

type MinorDb = Pick<PrismaService, 'person' | 'student'>;

/**
 * O USUARIO (no grupo do token) e menor? Data da FICHA (Person do login); sem ficha, a da matricula dele no grupo. Sem
 * nenhuma data: papel ALUNO conta como menor (nao da para provar que e adulto: decisao conservadora); os demais papeis, adulto.
 */
export async function isUserMinor(
  db: MinorDb,
  viewer: { organizationId: number; userId: number; role?: OrgRole | null },
  now: Date = new Date(),
): Promise<boolean> {
  const [person, student] = await Promise.all([
    db.person.findUnique({ where: { userId: viewer.userId }, select: { birthDate: true } }),
    db.student.findFirst({ where: { organizationId: viewer.organizationId, userId: viewer.userId }, select: { birthDate: true } }),
  ]);
  return isMinorByBirthDate(person?.birthDate ?? student?.birthDate ?? null, viewer.role === OrgRole.ALUNO, now);
}
