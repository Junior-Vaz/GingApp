import { OrgRole, Prisma, StudentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Mensagem do 401 quando o vínculo ALUNO está bloqueado pelo aluno inativo (genérica no login). */
export const INACTIVE_STUDENT_MESSAGE = 'Acesso do aluno inativo.';

type Db = PrismaService | Prisma.TransactionClient;

/**
 * Inativar um aluno (DELETE /students/:id => Student.status != ACTIVE) bloqueia o acesso do VÍNCULO ALUNO:
 * login e tokens já emitidos para aquele grupo deixam de valer (checado a cada requisição pela JwtStrategy
 * e no login). Reativar o aluno (PATCH status = ACTIVE) devolve o acesso na hora.
 *
 * O bloqueio é do vínculo, não do usuário:
 *  - só vale para a membership de papel ALUNO daquele grupo (vínculos em outros grupos, ex.: RESPONSAVEL ou
 *    MESTRE, seguem funcionando);
 *  - se, no mesmo grupo, a pessoa for também responsável por algum aluno ATIVO (StudentGuardian.userId), ela
 *    NÃO é derrubada - continua acompanhando os dependentes;
 *  - quem não tem Student próprio nesse grupo (conta ALUNO sem ficha) não é afetado.
 *
 * Status que bloqueiam: qualquer um diferente de ACTIVE (INACTIVE, SUSPENDED, FORMER).
 */
export async function isMembershipBlockedByInactiveStudent(
  db: Db,
  membership: { userId: number; organizationId: number; role: OrgRole },
): Promise<boolean> {
  if (membership.role !== OrgRole.ALUNO) return false;
  const { userId, organizationId } = membership;

  const own = await db.student.findFirst({ where: { organizationId, userId }, select: { status: true } });
  if (!own || own.status === StudentStatus.ACTIVE) return false;

  const activeDependents = await db.studentGuardian.count({
    where: { organizationId, userId, student: { status: StudentStatus.ACTIVE } },
  });
  return activeDependents === 0;
}
