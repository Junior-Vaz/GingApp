import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UnitScope, unitScopeFilter } from '../../../shared/access/unit-scope';
import { PrismaService } from '../../../shared/prisma/prisma.service';

type Db = PrismaService | Prisma.TransactionClient;

/**
 * SSOT da MATRÍCULA de um aluno numa turma (POST /classes/:id/students e o cadastro rápido de aluno com `classIds`):
 * idempotente — repetir não duplica e reativa uma matrícula inativa. Quem chama já validou turma/aluno (grupo e escopo
 * de unidade). Arquivo sem dependência de módulo Nest: StudentsService e ClassesService o importam sem ciclo.
 */
export function enrollStudentInClass(db: Db, organizationId: number, classId: number, studentId: number) {
  return db.classStudent.upsert({
    where: { classId_studentId: { classId, studentId } },
    create: { organizationId, classId, studentId },
    update: { status: 'ACTIVE' },
  });
}

/**
 * Confere que TODAS as turmas são do grupo e do escopo de unidade do usuário (o mesmo filtro de ClassesService.findOne).
 * Alguma inexistente/de outro grupo/fora do escopo => 404 único (não vaza existência), com os ids que falharam.
 */
export async function assertClassesEnrollable(
  db: Db,
  organizationId: number,
  classIds: number[],
  scope: UnitScope,
): Promise<void> {
  if (classIds.length === 0) return;
  const found = await db.class.findMany({
    where: { id: { in: classIds }, organizationId, ...unitScopeFilter(scope) },
    select: { id: true },
  });
  const foundIds = new Set(found.map((c) => c.id));
  const missing = classIds.filter((id) => !foundIds.has(id));
  if (missing.length > 0) {
    throw new NotFoundException(`Turma não encontrada neste grupo: ${missing.join(', ')}.`);
  }
}
