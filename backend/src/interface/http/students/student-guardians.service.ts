import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { OrgRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { resetMemberPassword } from '../../../shared/security/reset-member-password';
import { ResetStudentPasswordDto } from '../../../shared/security/reset-member-password.dto';
import { providedOrGeneratedPassword } from '../../../shared/security/temporary-password';
import { CreateGuardianDto } from './dto/create-guardian.dto';
import { CreateStudentAccountDto } from './dto/create-student-account.dto';
import { UpdateGuardianDto } from './dto/update-guardian.dto';
import { PasswordResetService } from '../../../shared/security/password-reset.service';
import {
  assertInviteRequest,
  EMAIL_REQUIRED_MESSAGE,
  EMAIL_UNAVAILABLE_MESSAGE,
  isUniqueViolation,
  provisionMemberUser,
} from './member-account';

const STUDENT_NOT_FOUND = 'Aluno não encontrado.';
const GUARDIAN_NOT_FOUND = 'Responsável não encontrado.';
const GUARDIAN_HAS_ACCOUNT = 'Este responsável já tem uma conta de acesso.';
const GUARDIAN_NO_ACCOUNT = 'Este responsável ainda não tem conta de acesso.';
const GUARDIAN_DUPLICATED = 'Este usuário já é responsável por este aluno.';
const GUARDIAN_IS_STUDENT = 'O próprio aluno não pode ser cadastrado como responsável de si mesmo.';

const GUARDIAN_SELECT = {
  id: true,
  studentId: true,
  name: true,
  relationship: true,
  phone: true,
  email: true,
  // Somente leitura aqui: quem altera é o próprio responsável, no fluxo do Passaporte.
  consentPublicProfile: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { id: true, email: true, mustChangePassword: true } },
} satisfies Prisma.StudentGuardianSelect;

type GuardianRow = Prisma.StudentGuardianGetPayload<{ select: typeof GUARDIAN_SELECT }>;

export interface GuardianView {
  id: number;
  studentId: number;
  name: string;
  relationship: string | null;
  phone: string | null;
  email: string | null;
  /** Consentimento do perfil público (somente leitura; vem do fluxo do Passaporte). */
  consentPublicProfile: boolean;
  /** Tem login (User vinculado). */
  hasAccount: boolean;
  /** E-mail de login e flag de troca obrigatória — só quando há conta. */
  account: { userId: number; email: string; mustChangePassword: boolean } | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GuardianAccountResult {
  guardian: GuardianView;
  /** true = o e-mail já era usuário do sistema e foi apenas vinculado (senha dele intocada). */
  linkedExistingUser: boolean;
  /** true = e-mail de convite enviado (sendInvite + SMTP ativo + usuário novo). */
  inviteSent: boolean;
}

/**
 * Responsáveis do aluno (StudentGuardian) — E01 do plano. Sempre isolado por organizationId do token
 * (aluno/responsável de outro grupo = 404). O consentimento do perfil público NUNCA é escrito aqui.
 */
@Injectable()
export class StudentGuardiansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordReset: PasswordResetService,
    private readonly audit: AuditService,
  ) {}

  async findAll(organizationId: number, studentId: number): Promise<GuardianView[]> {
    await this.requireStudent(organizationId, studentId);
    const rows = await this.prisma.studentGuardian.findMany({
      where: { organizationId, studentId },
      select: GUARDIAN_SELECT,
      orderBy: { id: 'asc' },
    });
    return rows.map(toView);
  }

  async create(organizationId: number, studentId: number, dto: CreateGuardianDto): Promise<GuardianAccountResult> {
    const student = await this.requireStudent(organizationId, studentId);
    if (dto.createAccount && !dto.email) throw new BadRequestException(EMAIL_REQUIRED_MESSAGE);
    if (!dto.createAccount && dto.password !== undefined) {
      throw new BadRequestException('A senha só pode ser informada junto com createAccount.');
    }
    if (!dto.createAccount && dto.sendInvite) {
      throw new BadRequestException('O convite por e-mail só pode ser pedido junto com createAccount.');
    }
    assertInviteRequest(this.passwordReset, dto.sendInvite, dto.password);

    let linkedExistingUser = false;
    let invitedUserId: number | null = null;
    let guardianId: number;
    try {
      guardianId = await this.prisma.$transaction(async (tx) => {
        let userId: number | null = null;
        if (dto.createAccount) {
          const provisioned = await provisionMemberUser(tx, {
            organizationId,
            email: dto.email!,
            name: dto.name,
            phone: dto.phone,
            password: dto.password,
            role: OrgRole.RESPONSAVEL,
            invite: dto.sendInvite,
          });
          linkedExistingUser = !provisioned.created;
          userId = provisioned.userId;
          invitedUserId = dto.sendInvite && provisioned.created ? provisioned.userId : null;
          await this.assertCanBeGuardian(tx, organizationId, student, userId);
        }
        const guardian = await tx.studentGuardian.create({
          data: {
            organizationId,
            studentId,
            userId,
            name: dto.name,
            relationship: dto.relationship,
            phone: dto.phone,
            email: dto.email,
          },
          select: { id: true },
        });
        return guardian.id;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(EMAIL_UNAVAILABLE_MESSAGE);
      throw error;
    }

    await this.audit.record({
      organizationId,
      action: dto.createAccount ? AuditAction.GUARDIAN_ACCOUNT_CREATE : AuditAction.GUARDIAN_CREATE,
      entity: AuditEntity.GUARDIAN,
      entityId: guardianId,
      meta: { studentId, linkedExistingUser },
    });
    return {
      guardian: await this.requireGuardianView(organizationId, studentId, guardianId),
      linkedExistingUser,
      inviteSent: await this.sendInviteTo(organizationId, invitedUserId),
    };
  }

  /** Envia o convite ao User recém-criado (null = sem convite). Falha de envio => false (nunca lança). */
  private async sendInviteTo(organizationId: number, userId: number | null): Promise<boolean> {
    if (userId === null) return false;
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true } });
    if (!user) return false;
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
    return this.passwordReset.sendInvite(user, org?.name ?? 'GingApp');
  }

  async update(organizationId: number, studentId: number, guardianId: number, dto: UpdateGuardianDto): Promise<GuardianView> {
    await this.requireGuardian(organizationId, studentId, guardianId);
    await this.prisma.studentGuardian.update({
      where: { id: guardianId },
      data: { name: dto.name, relationship: dto.relationship, phone: dto.phone, email: dto.email },
    });
    return this.requireGuardianView(organizationId, studentId, guardianId);
  }

  /**
   * Remove o vínculo de responsável (hard delete da linha StudentGuardian; o User e o OrganizationUser dele
   * ficam — ele pode ser responsável de outros alunos). Se este responsável deu o consentimento de um perfil
   * público, o consentimento cai junto: o perfil é DESPUBLICADO e a referência limpa.
   */
  async remove(organizationId: number, studentId: number, guardianId: number): Promise<void> {
    await this.requireGuardian(organizationId, studentId, guardianId);
    await this.prisma.$transaction(async (tx) => {
      await tx.publicProfile.updateMany({
        where: { consentByGuardianId: guardianId },
        data: { consentByGuardianId: null, isPublished: false },
      });
      await tx.studentGuardian.deleteMany({ where: { id: guardianId, organizationId, studentId } });
    });
  }

  /** Cria (ou vincula, se o e-mail já é usuário) o login RESPONSAVEL de um responsável já cadastrado. */
  async createAccount(
    organizationId: number,
    studentId: number,
    guardianId: number,
    dto: CreateStudentAccountDto,
  ): Promise<GuardianAccountResult> {
    const student = await this.requireStudent(organizationId, studentId);
    const guardian = await this.requireGuardian(organizationId, studentId, guardianId);
    if (guardian.userId !== null) throw new ConflictException(GUARDIAN_HAS_ACCOUNT);

    assertInviteRequest(this.passwordReset, dto.sendInvite, dto.password);
    const email = dto.email ?? guardian.email;
    if (!email) throw new BadRequestException(EMAIL_REQUIRED_MESSAGE);

    let linkedExistingUser = false;
    let invitedUserId: number | null = null;
    try {
      await this.prisma.$transaction(async (tx) => {
        const provisioned = await provisionMemberUser(tx, {
          organizationId,
          email,
          name: guardian.name,
          phone: guardian.phone,
          password: dto.password,
          role: OrgRole.RESPONSAVEL,
          invite: dto.sendInvite,
        });
        linkedExistingUser = !provisioned.created;
        invitedUserId = dto.sendInvite && provisioned.created ? provisioned.userId : null;
        await this.assertCanBeGuardian(tx, organizationId, student, provisioned.userId);
        const { count } = await tx.studentGuardian.updateMany({
          where: { id: guardianId, organizationId, studentId, userId: null },
          data: { userId: provisioned.userId },
        });
        if (count !== 1) throw new ConflictException(GUARDIAN_HAS_ACCOUNT);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(EMAIL_UNAVAILABLE_MESSAGE);
      throw error;
    }

    await this.audit.record({
      organizationId,
      action: AuditAction.GUARDIAN_ACCOUNT_CREATE,
      entity: AuditEntity.GUARDIAN,
      entityId: guardianId,
      meta: { studentId, linkedExistingUser },
    });
    return {
      guardian: await this.requireGuardianView(organizationId, studentId, guardianId),
      linkedExistingUser,
      inviteSent: await this.sendInviteTo(organizationId, invitedUserId),
    };
  }

  async resetPassword(
    organizationId: number,
    studentId: number,
    guardianId: number,
    dto: ResetStudentPasswordDto,
  ): Promise<{ temporaryPassword?: string }> {
    const guardian = await this.requireGuardian(organizationId, studentId, guardianId);
    if (guardian.userId === null) throw new ConflictException(GUARDIAN_NO_ACCOUNT);
    // `newPassword` omitida => senha provisória gerada pelo servidor (devolvida uma única vez; nunca logada/auditada).
    const chosen = providedOrGeneratedPassword(dto.newPassword);
    await resetMemberPassword(this.prisma, {
      organizationId,
      userId: guardian.userId,
      newPassword: chosen.password,
      roles: [OrgRole.RESPONSAVEL, OrgRole.ALUNO],
      notFoundMessage: GUARDIAN_NOT_FOUND,
      wrongRoleMessage: 'Esta conta pertence à equipe do grupo; a senha é redefinida em Professores.',
    });
    await this.audit.record({
      organizationId,
      action: AuditAction.MEMBER_PASSWORD_RESET,
      entity: AuditEntity.GUARDIAN,
      entityId: guardianId,
      meta: { studentId, userId: guardian.userId, kind: 'RESPONSAVEL', ...(chosen.generated ? { generated: true } : {}) },
    });
    return chosen.generated ? { temporaryPassword: chosen.password } : {};
  }

  /** O usuário do responsável não pode ser o próprio aluno nem já ser responsável deste mesmo aluno. */
  private async assertCanBeGuardian(
    tx: Prisma.TransactionClient,
    organizationId: number,
    student: { id: number; userId: number | null },
    userId: number,
  ): Promise<void> {
    if (student.userId === userId) throw new ConflictException(GUARDIAN_IS_STUDENT);
    const duplicated = await tx.studentGuardian.count({ where: { organizationId, studentId: student.id, userId } });
    if (duplicated > 0) throw new ConflictException(GUARDIAN_DUPLICATED);
  }

  private async requireStudent(organizationId: number, studentId: number) {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, organizationId },
      select: { id: true, userId: true },
    });
    if (!student) throw new NotFoundException(STUDENT_NOT_FOUND);
    return student;
  }

  private async requireGuardian(organizationId: number, studentId: number, guardianId: number) {
    const guardian = await this.prisma.studentGuardian.findFirst({ where: { id: guardianId, studentId, organizationId } });
    if (!guardian) throw new NotFoundException(GUARDIAN_NOT_FOUND);
    return guardian;
  }

  private async requireGuardianView(organizationId: number, studentId: number, guardianId: number): Promise<GuardianView> {
    const row = await this.prisma.studentGuardian.findFirst({
      where: { id: guardianId, studentId, organizationId },
      select: GUARDIAN_SELECT,
    });
    if (!row) throw new NotFoundException(GUARDIAN_NOT_FOUND);
    return toView(row);
  }
}

function toView(row: GuardianRow): GuardianView {
  const { user, ...rest } = row;
  return {
    ...rest,
    hasAccount: user !== null,
    account: user ? { userId: user.id, email: user.email, mustChangePassword: user.mustChangePassword } : null,
  };
}
