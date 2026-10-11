import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { OrgRole, UserType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { BCRYPT_ROUNDS } from './password-policy';
import { revocationCutoff } from './token-revocation';

/** Conta que também pertence a outro grupo: a senha é do USUÁRIO, então redefinir aqui daria a este grupo
 * acesso à conta dele em todos os outros (a mesma pessoa pode ser aluno aqui e mestre em outro lugar). */
export const SHARED_ACCOUNT_MESSAGE =
  'Esta conta também pertence a outro grupo; a senha só pode ser alterada pelo próprio usuário.';

export interface ResetMemberPasswordOptions {
  /** Grupo do chamador (do token) — o alvo precisa ter vínculo ATIVO nele. */
  organizationId: number;
  /** User alvo. */
  userId: number;
  newPassword: string;
  /** Papéis que este endpoint pode redefinir (o chamador já passou pelo @CanAccess do recurso certo). */
  roles: readonly OrgRole[];
  /** 404 (alvo inexistente, de outro grupo, inativo ou PLATFORM — sempre a mesma resposta). */
  notFoundMessage: string;
  /** 403 quando o vínculo existe mas o papel não é um dos permitidos (ex.: professor via rota de aluno). */
  wrongRoleMessage: string;
}

/**
 * SSOT do "Mestre/Professor redefine a senha de um membro do PRÓPRIO grupo" (espelha
 * OrganizationsService.resetMestrePassword, do super admin): grava o novo hash, REVOGA todas as sessões
 * do usuário (tokenValidAfter) e marca mustChangePassword (a senha foi definida por outra pessoa — os
 * frontends pedem a troca no próximo login). A senha só existe em memória para gerar o hash; nada
 * sensível é devolvido. A política da senha nova é validada no DTO (@IsNewPassword).
 *
 * Isolamento: o alvo é procurado SEMPRE por (organizationId do token, userId). Recusa (409) contas com
 * vínculo em OUTRO grupo e nunca toca usuários PLATFORM/super admin. A escrita revalida tudo no mesmo
 * `updateMany` (corrida com desativação/novo vínculo enquanto o bcrypt roda).
 */
export async function resetMemberPassword(prisma: PrismaService, options: ResetMemberPasswordOptions): Promise<void> {
  const { organizationId, userId, newPassword, roles } = options;

  const membership = await prisma.organizationUser.findFirst({
    where: {
      organizationId,
      userId,
      status: 'ACTIVE',
      user: { userType: UserType.MEMBER, isSuperAdmin: false, status: 'ACTIVE' },
    },
    select: { role: true },
  });
  if (!membership) throw new NotFoundException(options.notFoundMessage);
  if (!roles.includes(membership.role)) throw new ForbiddenException(options.wrongRoleMessage);

  const otherGroups = await prisma.organizationUser.count({
    where: { userId, organizationId: { not: organizationId } },
  });
  if (otherGroups > 0) throw new ConflictException(SHARED_ACCOUNT_MESSAGE);

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

  const { count } = await prisma.user.updateMany({
    where: {
      id: userId,
      userType: UserType.MEMBER,
      isSuperAdmin: false,
      status: 'ACTIVE',
      memberships: {
        some: { organizationId, role: { in: [...roles] }, status: 'ACTIVE' },
        none: { organizationId: { not: organizationId } },
      },
    },
    data: { passwordHash, tokenValidAfter: revocationCutoff(), mustChangePassword: true },
  });
  if (count !== 1) throw new ConflictException('A conta foi alterada enquanto a senha era redefinida. Tente novamente.');
}
