import { BadRequestException, ConflictException } from '@nestjs/common';
import { OrgRole, Prisma, UserType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { PasswordResetService } from '../../../shared/security/password-reset.service';
import { findUserIdsByEmail } from '../../../shared/security/email-lookup';
import { BCRYPT_ROUNDS, normalizeEmail } from '../../../shared/security/password-policy';

export const EMAIL_UNAVAILABLE_MESSAGE = 'Este e-mail não pode ser usado para criar um acesso.';
export const MEMBERSHIP_INACTIVE_MESSAGE = 'O vínculo deste usuário com o grupo está inativo.';
export const EMAIL_REQUIRED_MESSAGE = 'Informe o e-mail de acesso.';
export const PASSWORD_REQUIRED_MESSAGE = 'Informe a senha provisória para criar o acesso.';

export interface ProvisionMemberUserInput {
  organizationId: number;
  /** E-mail de login (normalizado aqui). */
  email: string;
  /** Nome/telefone do User NOVO (um User já existente nunca é alterado). */
  name: string;
  phone?: string | null;
  /** Senha provisória — obrigatória só quando o User ainda não existe; ignorada ao vincular. */
  password?: string;
  /** Papel do vínculo NOVO no grupo (um vínculo já existente mantém o papel que tem). */
  role: OrgRole;
  /** true = convite por e-mail: ignora `password` e cria o User com senha aleatória (a pessoa define a sua pelo link). */
  invite?: boolean;
}

export const INVITE_DISABLED_MESSAGE = 'O envio de convite por e-mail não está habilitado neste ambiente.';
export const INVITE_WITH_PASSWORD_MESSAGE = 'Não informe senha provisória junto com o convite por e-mail.';

/** Valida o pedido de convite (400 se e-mail desligado ou se veio senha junto). Sem `sendInvite` não faz nada. */
export function assertInviteRequest(passwordReset: PasswordResetService, sendInvite?: boolean, password?: string): void {
  if (!sendInvite) return;
  if (!passwordReset.isEnabled()) throw new BadRequestException(INVITE_DISABLED_MESSAGE);
  if (password !== undefined) throw new BadRequestException(INVITE_WITH_PASSWORD_MESSAGE);
}

export interface ProvisionedMemberUser {
  userId: number;
  /** true = User criado agora (com senha provisória); false = e-mail já era usuário do sistema (só vinculado). */
  created: boolean;
}

/**
 * SSOT do "cria ou vincula o login" usado pelo acesso do aluno (OrgRole.ALUNO) e do responsável
 * (OrgRole.RESPONSAVEL). Roda dentro da transação do chamador (`tx`).
 *
 *  - E-mail já é usuário (compara por lower(email), como o login): NUNCA duplica o User e nunca mexe na
 *    senha/nome dele — só garante o OrganizationUser deste grupo (cria com `role` se ainda não houver;
 *    mantém o papel de um vínculo existente). Recusa (409) usuário PLATFORM/super admin/inativo e vínculo
 *    inativo.
 *  - E-mail novo: exige a senha provisória (a política @IsNewPassword já foi validada no DTO), cria o User
 *    com mustChangePassword = true e o vínculo.
 */
export async function provisionMemberUser(
  tx: Prisma.TransactionClient,
  input: ProvisionMemberUserInput,
): Promise<ProvisionedMemberUser> {
  const { organizationId } = input;
  const email = normalizeEmail(input.email);
  if (!email) throw new BadRequestException(EMAIL_REQUIRED_MESSAGE);

  const [existingId] = await findUserIdsByEmail(tx, email, 1);
  if (existingId !== undefined) {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: existingId },
      select: {
        id: true,
        userType: true,
        isSuperAdmin: true,
        status: true,
        memberships: { where: { organizationId }, select: { id: true, status: true } },
      },
    });
    if (user.userType !== UserType.MEMBER || user.isSuperAdmin || user.status !== 'ACTIVE') {
      throw new ConflictException(EMAIL_UNAVAILABLE_MESSAGE);
    }
    const membership = user.memberships[0];
    if (membership && membership.status !== 'ACTIVE') {
      throw new ConflictException(MEMBERSHIP_INACTIVE_MESSAGE);
    }
    if (!membership) {
      await tx.organizationUser.create({ data: { organizationId, userId: user.id, role: input.role, status: 'ACTIVE' } });
    }
    return { userId: user.id, created: false };
  }

  // Convite por e-mail: a senha inicial é aleatória e NUNCA conhecida por ninguém; a pessoa define a própria pelo
  // link enviado (mustChangePassword fica false: a troca obrigatória é só da senha provisória definida por outrem).
  const secret = input.invite ? randomBytes(32).toString('base64url') : input.password;
  if (!secret) throw new BadRequestException(PASSWORD_REQUIRED_MESSAGE);
  const passwordHash = await bcrypt.hash(secret, BCRYPT_ROUNDS);
  const user = await tx.user.create({
    data: {
      email,
      passwordHash,
      name: input.name,
      phone: input.phone ?? null,
      userType: UserType.MEMBER,
      status: 'ACTIVE',
      mustChangePassword: !input.invite,
    },
    select: { id: true },
  });
  await tx.organizationUser.create({ data: { organizationId, userId: user.id, role: input.role, status: 'ACTIVE' } });
  return { userId: user.id, created: true };
}

/** P2002 (unique) — corrida entre duas criações do mesmo e-mail/vínculo. */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
