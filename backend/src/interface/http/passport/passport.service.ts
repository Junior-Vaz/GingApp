import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { StudentsService } from '../students/students.service';

/**
 * Passaporte do Capoeirista (projeto.txt §50/§51, Jornada do Capoeirista parte 2 —
 * PLANO_PROJETO.md §10.16): identidade + estatísticas agregadas (aulas, rodas, eventos,
 * graduações, certificados) de um aluno, com opção de publicar uma versão pública
 * compartilhável (reaproveita o model `PublicProfile`, já existia desde a fundação, nunca
 * tinha nenhum módulo).
 *
 * "Rodas" conta via `RodaParticipant.userId` — `RodasService.join` sempre grava por `userId`,
 * nunca por `studentId` (auto-registro é por usuário logado, não por aluno específico); por
 * isso a contagem usa `student.userId` quando existir, além de `studentId` por completude.
 */
@Injectable()
export class PassportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly studentsService: StudentsService,
  ) {}

  async getForStudent(organizationId: number, studentId: number) {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, organizationId },
      include: { unit: true },
    });
    if (!student) {
      throw new NotFoundException('Aluno não encontrado.');
    }

    const [organization, aulas, rodas, eventos, graduacoes, certificados, currentGraduation, publicProfile] =
      await Promise.all([
        this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } }),
        this.prisma.attendance.count({ where: { organizationId, studentId, present: true } }),
        this.prisma.rodaParticipant.count({
          where: student.userId
            ? { OR: [{ studentId }, { userId: student.userId }] }
            : { studentId },
        }),
        this.prisma.eventParticipant.count({ where: { organizationId, studentId, status: 'ATTENDED' } }),
        this.prisma.studentGraduation.count({ where: { organizationId, studentId } }),
        this.prisma.certificate.count({ where: { organizationId, studentId } }),
        this.prisma.studentGraduation.findFirst({
          where: { organizationId, studentId },
          orderBy: { graduatedAt: 'desc' },
          include: { graduationLevel: true },
        }),
        this.prisma.publicProfile.findUnique({ where: { studentId } }),
      ]);

    return {
      student: { id: student.id, name: student.name },
      organization: { name: organization.name },
      unit: student.unit ? { name: student.unit.name } : null,
      currentGraduation: currentGraduation ? { name: currentGraduation.graduationLevel.name } : null,
      stats: { aulas, rodas, eventos, graduacoes, certificados },
      publicProfile: publicProfile
        ? { isPublished: publicProfile.isPublished, publicCode: publicProfile.publicCode }
        : null,
    };
  }

  /** Passaporte do usuário autenticado — primeiro aluno vinculado (mesma simplificação de
   * JornadaView.vue: TODO seletor de dependente quando houver mais de um). */
  async getMine(organizationId: number, userId: number) {
    const students = await this.studentsService.findMine(organizationId, userId);
    const student = students[0];
    if (!student) {
      return null;
    }

    const passport = await this.getForStudent(organizationId, student.id);
    const guardian =
      student.userId === userId
        ? null
        : await this.prisma.studentGuardian.findFirst({
            where: { organizationId, studentId: student.id, userId },
          });
    const isMinor = this.isMinor(student.birthDate);

    // `viewer` diz à UI o que ESTE usuário pode fazer, espelhando as regras de publish() para
    // não oferecer botão que só devolve 403. Fica só em /passport/me (autenticado): o endpoint
    // público (getPublicByCode) usa getForStudent direto e nunca expõe menoridade/vínculo.
    return {
      ...passport,
      viewer: {
        isGuardian: guardian !== null,
        isMinor,
        /** Responsável: consentimento já dado? (null quando não é responsável). */
        hasConsent: guardian ? guardian.consentPublicProfile : null,
        /** Pode publicar agora: responsável precisa do consentimento; o próprio aluno só se maior. */
        canPublish: guardian ? guardian.consentPublicProfile : !isMinor,
        /** Só um responsável cadastrado pode autorizar o perfil público. */
        canConsent: guardian !== null,
      },
    };
  }

  async getPublicByCode(publicCode: string) {
    const profile = await this.prisma.publicProfile.findUnique({ where: { publicCode } });
    if (!profile || !profile.isPublished || !profile.studentId) {
      throw new NotFoundException('Passaporte não encontrado ou não publicado.');
    }
    const student = await this.prisma.student.findUniqueOrThrow({ where: { id: profile.studentId } });
    return this.getForStudent(student.organizationId, profile.studentId);
  }

  async publish(organizationId: number, userId: number, studentId: number) {
    const { student, guardian } = await this.resolveRelationship(organizationId, userId, studentId);

    if (!guardian && this.isMinor(student.birthDate)) {
      throw new ForbiddenException(
        'Aluno menor de idade: a publicação do Passaporte só pode ser feita por um responsável cadastrado, nunca pelo próprio aluno (PLANO_PROJETO.md §3.4).',
      );
    }
    if (guardian && !guardian.consentPublicProfile) {
      throw new BadRequestException(
        'É preciso que o responsável autorize o perfil público deste aluno antes (PATCH /passport/guardian-consent).',
      );
    }

    const profile = await this.prisma.publicProfile.upsert({
      where: { studentId },
      update: { isPublished: true, displayName: student.name, consentByGuardianId: guardian?.id },
      create: {
        organizationId,
        studentId,
        displayName: student.name,
        isPublished: true,
        consentByGuardianId: guardian?.id,
      },
    });
    return { isPublished: profile.isPublished, publicCode: profile.publicCode };
  }

  async unpublish(organizationId: number, userId: number, studentId: number) {
    await this.resolveRelationship(organizationId, userId, studentId);

    const profile = await this.prisma.publicProfile.findUnique({ where: { studentId } });
    if (!profile) {
      throw new NotFoundException('Este aluno ainda não tem um Passaporte publicado.');
    }
    const updated = await this.prisma.publicProfile.update({ where: { studentId }, data: { isPublished: false } });
    return { isPublished: updated.isPublished, publicCode: updated.publicCode };
  }

  /** Só um responsável pode autorizar (nunca o próprio MESTRE/PROFESSOR nem o aluno) — reflete
   * `StudentGuardian.consentPublicProfile`, campo que já existia no schema, nunca exposto por
   * nenhuma rota até agora. */
  async setGuardianConsent(organizationId: number, userId: number, studentId: number, consent: boolean) {
    const guardian = await this.prisma.studentGuardian.findFirst({
      where: { organizationId, studentId, userId },
    });
    if (!guardian) {
      throw new ForbiddenException('Você não é responsável cadastrado deste aluno.');
    }
    const updated = await this.prisma.studentGuardian.update({
      where: { id: guardian.id },
      data: { consentPublicProfile: consent },
    });
    return { consentPublicProfile: updated.consentPublicProfile };
  }

  /** Resolve se o usuário autenticado é o próprio aluno (Student.userId) ou um responsável
   * dele (StudentGuardian.userId) — nunca confia em studentId sem confirmar o vínculo,
   * mesmo padrão de StudentsService.findMine. */
  private async resolveRelationship(organizationId: number, userId: number, studentId: number) {
    const link = await this.studentsService.resolveLink(organizationId, userId, studentId);
    if (!link) {
      throw new NotFoundException('Aluno não encontrado.');
    }
    if (!link.linked) {
      throw new ForbiddenException('Você não tem vínculo com este aluno.');
    }
    return { student: link.student, guardian: link.guardian };
  }

  /** Sem `birthDate` cadastrada, não há como confirmar menoridade — não bloqueia (mas o aluno
   * deveria ter data de nascimento cadastrada; ver StudentsService/UpdateStudentDto). */
  private isMinor(birthDate: Date | null): boolean {
    if (!birthDate) return false;
    const ageInYears = (Date.now() - birthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    return ageInYears < 18;
  }
}
