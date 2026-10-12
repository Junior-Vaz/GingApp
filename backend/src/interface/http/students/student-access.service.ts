import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { resetMemberPassword } from '../../../shared/security/reset-member-password';
import { ResetMemberPasswordDto } from '../../../shared/security/reset-member-password.dto';
import { CreateStudentAccountDto } from './dto/create-student-account.dto';
import { PasswordResetService } from '../../../shared/security/password-reset.service';
import {
  assertInviteRequest,
  EMAIL_REQUIRED_MESSAGE,
  EMAIL_UNAVAILABLE_MESSAGE,
  isUniqueViolation,
  provisionMemberUser,
} from './member-account';

const STUDENT_NOT_FOUND = 'Aluno não encontrado.';
const ALREADY_HAS_ACCOUNT = 'Este aluno já tem uma conta de acesso.';
const USER_ALREADY_LINKED = 'Este usuário já está vinculado a outro aluno.';
const NO_ACCOUNT = 'Este aluno ainda não tem conta de acesso.';

/** Dados do login de um membro, sem nada sensível (nunca senha/hash). */
export interface MemberAccountView {
  userId: number;
  name: string;
  email: string;
  status: string;
  role: OrgRole | null;
  /** A senha atual foi definida por outra pessoa: o titular deve trocá-la no próximo login. */
  mustChangePassword: boolean;
}

export interface StudentAccountResult {
  studentId: number;
  /** true = o e-mail já era usuário do sistema e foi apenas vinculado (senha dele intocada). */
  linkedExistingUser: boolean;
  account: MemberAccountView;
  /** true = e-mail de convite enviado (sendInvite + SMTP ativo + usuário novo). false = sem convite ou falha no envio. */
  inviteSent: boolean;
}

/**
 * Acesso (login) do aluno — E01 do plano. Sempre isolado por organizationId do token: aluno de outro
 * grupo = 404. O User é compartilhado entre grupos, então a regra é "nunca duplicar User": um e-mail já
 * existente só ganha o vínculo (OrganizationUser ALUNO) neste grupo e o Student.userId.
 */
@Injectable()
export class StudentAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordReset: PasswordResetService,
    private readonly audit: AuditService,
  ) {}

  private async groupName(organizationId: number): Promise<string> {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
    return org?.name ?? 'GingApp';
  }

  /** Login do aluno (ou `hasAccount: false`). */
  async getAccount(organizationId: number, studentId: number): Promise<{ hasAccount: boolean; account?: MemberAccountView }> {
    const student = await this.requireStudent(organizationId, studentId);
    if (student.userId === null) return { hasAccount: false };
    return { hasAccount: true, account: await this.loadAccount(organizationId, student.userId) };
  }

  async createAccount(organizationId: number, studentId: number, dto: CreateStudentAccountDto): Promise<StudentAccountResult> {
    const student = await this.requireStudent(organizationId, studentId);
    if (student.userId !== null) throw new ConflictException(ALREADY_HAS_ACCOUNT);
    assertInviteRequest(this.passwordReset, dto.sendInvite, dto.password);

    const email = dto.email ?? student.email;
    if (!email) throw new BadRequestException(EMAIL_REQUIRED_MESSAGE);

    let result: { userId: number; created: boolean };
    try {
      result = await this.prisma.$transaction(async (tx) => {
        const provisioned = await provisionMemberUser(tx, {
          organizationId,
          email,
          name: student.name,
          phone: student.phone,
          password: dto.password,
          role: OrgRole.ALUNO,
          invite: dto.sendInvite,
        });
        // Student.userId é único: este usuário não pode já ser (ou ser ao mesmo tempo) outro aluno.
        if ((await tx.student.count({ where: { userId: provisioned.userId } })) > 0) {
          throw new ConflictException(USER_ALREADY_LINKED);
        }
        // Condicional a userId nulo: duas criações simultâneas para o mesmo aluno => só uma vence.
        const { count } = await tx.student.updateMany({
          where: { id: studentId, organizationId, userId: null },
          data: { userId: provisioned.userId },
        });
        if (count !== 1) throw new ConflictException(ALREADY_HAS_ACCOUNT);
        return provisioned;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(EMAIL_UNAVAILABLE_MESSAGE);
      throw error;
    }

    const account = await this.loadAccount(organizationId, result.userId);
    // Convite só para User NOVO (quem já era usuário mantém a própria senha e não precisa de link).
    const inviteSent =
      !!dto.sendInvite && result.created
        ? await this.passwordReset.sendInvite(
            { id: result.userId, email: account.email, name: account.name },
            await this.groupName(organizationId),
          )
        : false;
    await this.audit.record({
      organizationId,
      // Usuario ja existente apenas vinculado ao aluno = LINK; usuario novo = CREATE.
      action: result.created ? AuditAction.STUDENT_ACCOUNT_CREATE : AuditAction.STUDENT_ACCOUNT_LINK,
      entity: AuditEntity.STUDENT,
      entityId: studentId,
      meta: { userId: result.userId, linkedExistingUser: !result.created, inviteSent },
    });
    return { studentId, linkedExistingUser: !result.created, account, inviteSent };
  }

  /** Mestre/Professor redefine a senha do aluno (senha provisória) e revoga as sessões dele. */
  async resetPassword(organizationId: number, studentId: number, dto: ResetMemberPasswordDto): Promise<void> {
    const student = await this.requireStudent(organizationId, studentId);
    if (student.userId === null) throw new ConflictException(NO_ACCOUNT);
    await resetMemberPassword(this.prisma, {
      organizationId,
      userId: student.userId,
      newPassword: dto.newPassword,
      roles: [OrgRole.ALUNO, OrgRole.RESPONSAVEL],
      notFoundMessage: STUDENT_NOT_FOUND,
      wrongRoleMessage: 'Esta conta pertence à equipe do grupo; a senha é redefinida em Professores.',
    });
    await this.audit.record({
      organizationId,
      action: AuditAction.MEMBER_PASSWORD_RESET,
      entity: AuditEntity.STUDENT,
      entityId: studentId,
      meta: { userId: student.userId, kind: 'ALUNO' },
    });
  }

  private async requireStudent(organizationId: number, studentId: number) {
    const student = await this.prisma.student.findFirst({ where: { id: studentId, organizationId } });
    if (!student) throw new NotFoundException(STUDENT_NOT_FOUND);
    return student;
  }

  /** @internal compartilhado com o serviço de responsáveis. */
  async loadAccount(organizationId: number, userId: number): Promise<MemberAccountView> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        mustChangePassword: true,
        memberships: { where: { organizationId }, select: { role: true } },
      },
    });
    return {
      userId: user.id,
      name: user.name,
      email: user.email,
      status: user.status,
      role: user.memberships[0]?.role ?? null,
      mustChangePassword: user.mustChangePassword,
    };
  }
}
