import { BadRequestException, ConflictException, HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { PermissionsService } from '../../../shared/access/permissions.service';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { resetMemberPassword } from '../../../shared/security/reset-member-password';
import { ResetStudentPasswordDto } from '../../../shared/security/reset-member-password.dto';
import { providedOrGeneratedPassword } from '../../../shared/security/temporary-password';
import { CreateStudentAccountDto } from './dto/create-student-account.dto';
import { PasswordResetService } from '../../../shared/security/password-reset.service';
import { PersonIdentityService } from '../people/person-identity.service';
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
  /** 2FA ativo na conta (so' a flag): o painel oferece "Redefinir 2FA". */
  twoFactorEnabled: boolean;
}

export interface StudentAccountResult {
  studentId: number;
  /** true = o e-mail já era usuário do sistema e foi apenas vinculado (senha dele intocada). */
  linkedExistingUser: boolean;
  account: MemberAccountView;
  /** true = e-mail de convite enviado (sendInvite + SMTP ativo + usuário novo). false = sem convite ou falha no envio. */
  inviteSent: boolean;
  /**
   * Senha provisória GERADA pelo servidor (corpo sem `password`, sem `sendInvite`, e-mail novo). Só aparece aqui, uma
   * única vez, na resposta HTTP (Cache-Control: no-store); nunca em log, auditoria, notificação ou e-mail.
   */
  temporaryPassword?: string;
}

/** Resultado do acesso criado junto do cadastro do aluno (POST /students com createAccess). */
export type RegistrationAccessStatus = 'CREATED' | 'LINKED' | 'SKIPPED_NO_EMAIL' | 'SKIPPED_NO_PERMISSION' | 'FAILED';

export interface RegistrationAccess {
  status: RegistrationAccessStatus;
  /** E-mail de login (CREATED/LINKED). */
  email?: string;
  /** SÓ quando CREATED: a senha provisória gerada (mostrada uma única vez). LINKED nunca devolve senha. */
  temporaryPassword?: string;
  mustChangePassword?: boolean;
  /** Texto curto em português quando SKIPPED (qualquer motivo) ou FAILED. */
  reason?: string;
}

export const NO_EMAIL_FOR_ACCESS_REASON = 'Sem e-mail: cadastre um e-mail para criar o acesso depois.';
export const NO_PERMISSION_FOR_ACCESS_REASON = 'Você não tem permissão para criar o acesso: peça a quem administra o grupo.';
export const ACCESS_FAILED_GENERIC_REASON = 'O aluno foi cadastrado, mas não foi possível criar o acesso agora. Tente criar o acesso na ficha do aluno.';

/**
 * Acesso (login) do aluno — E01 do plano. Sempre isolado por organizationId do token: aluno de outro
 * grupo = 404. O User é compartilhado entre grupos, então a regra é "nunca duplicar User": um e-mail já
 * existente só ganha o vínculo (OrganizationUser ALUNO) neste grupo e o Student.userId.
 */
@Injectable()
export class StudentAccessService {
  private readonly logger = new Logger(StudentAccessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordReset: PasswordResetService,
    private readonly audit: AuditService,
    private readonly people: PersonIdentityService,
    private readonly permissions: PermissionsService,
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

  /**
   * Cria (ou vincula) o login do aluno. `password` omitida e sem `sendInvite` => o servidor GERA a senha provisória fácil
   * (generateTemporaryPassword) e a devolve em `temporaryPassword` — só quando o User é NOVO (e-mail já existente é só
   * vinculado e a senha dele nunca é tocada nem devolvida). `via` marca a origem na auditoria (ex.: 'quick-register').
   */
  async createAccount(
    organizationId: number,
    studentId: number,
    dto: CreateStudentAccountDto,
    options: { via?: string } = {},
  ): Promise<StudentAccountResult> {
    const student = await this.requireStudent(organizationId, studentId);
    if (student.userId !== null) throw new ConflictException(ALREADY_HAS_ACCOUNT);
    assertInviteRequest(this.passwordReset, dto.sendInvite, dto.password);

    const email = dto.email ?? student.email;
    if (!email) throw new BadRequestException(EMAIL_REQUIRED_MESSAGE);

    const chosen = dto.sendInvite
      ? { password: undefined, generated: false }
      : providedOrGeneratedPassword(dto.password);

    let result: { userId: number; created: boolean };
    try {
      result = await this.prisma.$transaction(async (tx) => {
        const provisioned = await provisionMemberUser(tx, {
          organizationId,
          email,
          name: student.name,
          phone: student.phone,
          password: chosen.password,
          role: OrgRole.ALUNO,
          invite: dto.sendInvite,
        });
        // Student é único por (organizationId, userId): este usuário não pode já ser outro aluno DESTE grupo. Ser aluno
        // em OUTRO grupo é permitido (um Student por organização, mesmo login).
        if ((await tx.student.count({ where: { organizationId, userId: provisioned.userId } })) > 0) {
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

    // Ficha única: "mesmo login = mesma pessoa" (liga o User à ficha; mescla se o User já tinha outra). Nunca lança.
    await this.people.attachUser(studentId, result.userId);
    const account = await this.loadAccount(organizationId, result.userId);
    // Convite só para User NOVO (quem já era usuário mantém a própria senha e não precisa de link).
    const inviteSent =
      !!dto.sendInvite && result.created
        ? await this.passwordReset.sendInvite(
            { id: result.userId, email: account.email, name: account.name },
            await this.groupName(organizationId),
          )
        : false;
    // A senha gerada só vale (e só é devolvida) quando o User foi criado agora; ao vincular, foi descartada.
    const temporaryPassword = chosen.generated && result.created ? chosen.password : undefined;
    await this.audit.record({
      organizationId,
      // Usuario ja existente apenas vinculado ao aluno = LINK; usuario novo = CREATE.
      action: result.created ? AuditAction.STUDENT_ACCOUNT_CREATE : AuditAction.STUDENT_ACCOUNT_LINK,
      entity: AuditEntity.STUDENT,
      entityId: studentId,
      // `generated` e' so a bandeira (nunca a senha).
      meta: {
        userId: result.userId,
        linkedExistingUser: !result.created,
        inviteSent,
        ...(temporaryPassword ? { generated: true } : {}),
        ...(options.via ? { via: options.via } : {}),
      },
    });
    return {
      studentId,
      linkedExistingUser: !result.created,
      account,
      inviteSent,
      ...(temporaryPassword ? { temporaryPassword } : {}),
    };
  }

  /**
   * Cadastro rápido (POST /students com createAccess): cria o acesso do aluno recém-criado com senha gerada. NUNCA lança:
   * o cadastro do aluno já está feito e uma falha aqui vira `status: 'FAILED'` (com motivo em português, sem segredo).
   * Só cria se o ator tem a MESMA permissão que POST /students/:id/account exige (students.edit); sem e-mail não cria.
   */
  async createForNewStudent(
    organizationId: number,
    student: { id: number; email: string | null },
    user: AuthenticatedUser,
  ): Promise<RegistrationAccess> {
    if (!(await this.permissions.can(user, 'students', 'edit'))) {
      return { status: 'SKIPPED_NO_PERMISSION', reason: NO_PERMISSION_FOR_ACCESS_REASON };
    }
    if (!student.email) return { status: 'SKIPPED_NO_EMAIL', reason: NO_EMAIL_FOR_ACCESS_REASON };
    try {
      const result = await this.createAccount(organizationId, student.id, {}, { via: 'quick-register' });
      if (result.linkedExistingUser) {
        return { status: 'LINKED', email: result.account.email, mustChangePassword: result.account.mustChangePassword };
      }
      return {
        status: 'CREATED',
        email: result.account.email,
        temporaryPassword: result.temporaryPassword,
        mustChangePassword: result.account.mustChangePassword,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        // Mensagens das regras de negócio (e-mail indisponível, usuário já é outro aluno...): em português e sem segredo.
        const message = error.message;
        return { status: 'FAILED', reason: message || ACCESS_FAILED_GENERIC_REASON };
      }
      // Nunca loga `error.message` (erros do Prisma podem trazer os argumentos da consulta): só o tipo do erro.
      this.logger.error(`Falha ao criar o acesso do aluno #${student.id} no cadastro rápido (${error instanceof Error ? error.name : 'erro'}).`);
      return { status: 'FAILED', reason: ACCESS_FAILED_GENERIC_REASON };
    }
  }

  /**
   * Mestre/Professor redefine a senha do aluno e revoga as sessões dele. `newPassword` omitida => o servidor gera a
   * provisória fácil e a devolve (`temporaryPassword`, única vez, sem log/auditoria); informada => devolve `{}`.
   */
  async resetPassword(
    organizationId: number,
    studentId: number,
    dto: ResetStudentPasswordDto,
  ): Promise<{ temporaryPassword?: string }> {
    const student = await this.requireStudent(organizationId, studentId);
    if (student.userId === null) throw new ConflictException(NO_ACCOUNT);
    const chosen = providedOrGeneratedPassword(dto.newPassword);
    await resetMemberPassword(this.prisma, {
      organizationId,
      userId: student.userId,
      newPassword: chosen.password,
      roles: [OrgRole.ALUNO, OrgRole.RESPONSAVEL],
      notFoundMessage: STUDENT_NOT_FOUND,
      wrongRoleMessage: 'Esta conta pertence à equipe do grupo; a senha é redefinida em Professores.',
    });
    await this.audit.record({
      organizationId,
      action: AuditAction.MEMBER_PASSWORD_RESET,
      entity: AuditEntity.STUDENT,
      entityId: studentId,
      meta: { userId: student.userId, kind: 'ALUNO', ...(chosen.generated ? { generated: true } : {}) },
    });
    return chosen.generated ? { temporaryPassword: chosen.password } : {};
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
        twoFactorEnabled: true,
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
      twoFactorEnabled: user.twoFactorEnabled,
    };
  }
}
