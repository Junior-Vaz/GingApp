import { BadRequestException } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Papéis que podem ser "professor responsável" (turma) ou "professor da aula" (mesma regra de TeachersService). */
// Fase 3: INSTRUTOR e MONITOR tambem podem ser o responsavel de uma turma/aula ("as turmas dele").
export const TEACHER_ROLES: OrgRole[] = [OrgRole.MESTRE, OrgRole.PROFESSOR, OrgRole.INSTRUTOR, OrgRole.MONITOR];

/**
 * SSOT de "professor válido para esta organização": `userId` precisa ter membership ATIVA
 * (OrganizationUser.status = 'ACTIVE') com papel MESTRE ou PROFESSOR NA organização informada.
 * Não existe model Teacher — o professor é o User.id do membro. Usuário de outro grupo,
 * ALUNO/RESPONSAVEL, membership inativa ou id inexistente => o MESMO 400 (não vaza quem existe).
 * Nunca confiar em teacherUserId vindo do corpo sem esta checagem.
 */
export async function assertActiveTeacher(
  prisma: PrismaService,
  organizationId: number,
  teacherUserId: number,
): Promise<void> {
  const membership = await prisma.organizationUser.findFirst({
    where: { organizationId, userId: teacherUserId, status: 'ACTIVE', role: { in: TEACHER_ROLES } },
    select: { id: true },
  });
  if (!membership) {
    throw new BadRequestException('Professor inválido para esta organização.');
  }
}
