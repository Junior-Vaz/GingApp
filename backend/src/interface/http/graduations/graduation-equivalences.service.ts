import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { RankingService } from '../ranking/ranking.service';
import { RolesService } from '../roles/roles.service';
import { LEVEL_SELECT, levelView } from './rope';

const badRequest = (code: string, message: string) => new BadRequestException({ statusCode: 400, error: 'Bad Request', code, message });

/**
 * Posicao relativa (Fase 5): a corda na posicao `fromPos` de `fromCount` niveis vira a posicao proporcional num sistema de
 * `toCount` niveis (arredondada, entre 1 e toCount). Ex.: 4a de 8 -> 2a de 4. Pura (testavel).
 */
export function suggestedPosition(fromPos: number, fromCount: number, toCount: number): number {
  if (toCount <= 0 || fromCount <= 0) return 0;
  return Math.min(toCount, Math.max(1, Math.round((fromPos / fromCount) * toCount)));
}

export interface DeclareEquivalenceInput {
  fromLevelId: number;
  toLevelId: number;
  recognizeForStudentId?: number;
}

/**
 * EQUIVALENCIA DE CORDAS (ficha unica, Fase 5 - docs/FICHA_UNICA.md secao 7). O grupo NOVO so enxerga cordas de outro grupo
 * que chegaram por COMPARTILHAMENTO (EnrollmentShare ativo de transferencia aprovada); declara a equivalencia e, se quiser,
 * RECONHECE a graduacao (cria a do grupo no nivel equivalente, nota "Reconhecida de <grupo>"), sem tocar nas antigas.
 * Pontos: a reconhecida pontua como GRADUATION na matricula NOVA; a antiga continua na matricula de origem, que ficou
 * Ex-aluno na transferencia e nao entra nos rankings (so alunos ATIVOS) - logo a pessoa nunca soma as duas.
 */
@Injectable()
export class GraduationEquivalencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ranking: RankingService,
    private readonly roles: RolesService,
  ) {}

  /** Matriculas anteriores (de outros grupos) compartilhadas com o grupo, para a pessoa do aluno (ou todas, sem aluno). */
  private async sharedStudentIds(organizationId: number, personId?: number | null): Promise<number[]> {
    const shares = await this.prisma.enrollmentShare.findMany({
      where: { toOrganizationId: organizationId, revokedAt: null, ...(personId !== undefined ? { personId: personId ?? -1 } : {}) },
      select: { fromStudentId: true },
    });
    return shares.map((s) => s.fromStudentId);
  }

  private async student(organizationId: number, studentId: number) {
    const s = await this.prisma.student.findFirst({ where: { id: studentId, organizationId }, select: { id: true, personId: true } });
    if (!s) throw new NotFoundException('Aluno não encontrado.');
    return s;
  }

  /** Sistema do grupo usado como destino: o das graduacoes do aluno no grupo, senao o primeiro sistema ativo com niveis. */
  private async targetSystem(organizationId: number, studentId?: number) {
    const own = studentId
      ? await this.prisma.studentGraduation.findFirst({
          where: { organizationId, studentId },
          orderBy: [{ graduatedAt: 'desc' }, { id: 'desc' }],
          select: { graduationLevel: { select: { graduationSystemId: true } } },
        })
      : null;
    const system = await this.prisma.graduationSystem.findFirst({
      where: { organizationId, ...(own ? { id: own.graduationLevel.graduationSystemId } : { isActive: true, levels: { some: {} } }) },
      orderBy: { id: 'asc' },
      include: { levels: { select: LEVEL_SELECT, orderBy: { order: 'asc' } } },
    });
    return system && system.levels.length > 0 ? system : null;
  }

  async suggestions(organizationId: number, studentId: number) {
    const student = await this.student(organizationId, studentId);
    const fromIds = await this.sharedStudentIds(organizationId, student.personId);
    if (fromIds.length === 0) return [];
    const origin = await this.prisma.studentGraduation.findMany({
      where: { studentId: { in: fromIds } },
      orderBy: [{ graduatedAt: 'desc' }, { id: 'desc' }],
      select: {
        graduatedAt: true,
        graduationLevel: {
          select: {
            ...LEVEL_SELECT,
            organization: { select: { id: true, name: true, logo: true } },
            graduationSystem: { select: { id: true, name: true, levels: { select: { id: true, order: true }, orderBy: { order: 'asc' } } } },
          },
        },
      },
    });
    const seen = new Set<number>();
    const unique = origin.filter((g) => !seen.has(g.graduationLevel.id) && seen.add(g.graduationLevel.id));
    const target = await this.targetSystem(organizationId, studentId);
    const [declared, recognized] = await Promise.all([
      this.prisma.levelEquivalence.findMany({
        where: { toOrganizationId: organizationId, fromLevelId: { in: [...seen] } },
        select: { fromLevelId: true, toLevel: { select: LEVEL_SELECT } },
      }),
      this.prisma.studentGraduation.findMany({
        where: { studentId, recognizedFromLevelId: { in: [...seen] } },
        select: { recognizedFromLevelId: true },
      }),
    ]);
    const declaredOf = new Map(declared.map((d) => [d.fromLevelId, d.toLevel]));
    const recognizedSet = new Set(recognized.map((r) => r.recognizedFromLevelId));
    return unique.map((g) => {
      const level = g.graduationLevel;
      const fromLevels = level.graduationSystem.levels;
      const pos = fromLevels.findIndex((l) => l.id === level.id) + 1;
      const suggestedIdx = target ? suggestedPosition(pos, fromLevels.length, target.levels.length) : 0;
      const suggested = target && suggestedIdx > 0 ? target.levels[suggestedIdx - 1]! : null;
      const declaredLevel = declaredOf.get(level.id);
      return {
        fromLevel: levelView(level),
        fromSystem: { id: level.graduationSystem.id, name: level.graduationSystem.name, levelsCount: fromLevels.length },
        fromOrganization: { id: level.organization.id, name: level.organization.name, logoUrl: level.organization.logo ?? null },
        graduatedAt: g.graduatedAt,
        declared: declaredLevel ? levelView(declaredLevel) : null,
        suggested: suggested ? levelView(suggested) : null,
        toSystem: target ? { id: target.id, name: target.name } : null,
        recognized: recognizedSet.has(level.id),
      };
    });
  }

  async list(organizationId: number) {
    const rows = await this.prisma.levelEquivalence.findMany({
      where: { toOrganizationId: organizationId },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        createdAt: true,
        fromLevel: { select: { ...LEVEL_SELECT, organization: { select: { id: true, name: true } } } },
        toLevel: { select: LEVEL_SELECT },
      },
    });
    return rows.map((r) => {
      const { organization, ...from } = r.fromLevel;
      return { id: r.id, fromLevel: levelView(from), toLevel: levelView(r.toLevel), fromOrganization: organization, createdAt: r.createdAt };
    });
  }

  async declare(organizationId: number, userId: number, input: DeclareEquivalenceInput) {
    // Corda de origem so se chegou por compartilhamento a este grupo (nao enumera cordas de outros grupos).
    const sharedIds = await this.sharedStudentIds(organizationId);
    const visible = sharedIds.length
      ? await this.prisma.studentGraduation.findFirst({ where: { studentId: { in: sharedIds }, graduationLevelId: input.fromLevelId }, select: { id: true } })
      : null;
    const fromLevel = visible
      ? await this.prisma.graduationLevel.findUnique({ where: { id: input.fromLevelId }, include: { organization: { select: { id: true, name: true } } } })
      : null;
    if (!fromLevel || fromLevel.organizationId === organizationId) throw new NotFoundException('Corda de origem não encontrada.');
    const toLevel = await this.prisma.graduationLevel.findFirst({ where: { id: input.toLevelId, organizationId }, select: LEVEL_SELECT });
    if (!toLevel) throw badRequest('INVALID_TO_LEVEL', 'A corda de destino precisa ser de um sistema de graduação deste grupo.');

    const equivalence = await this.prisma.levelEquivalence.upsert({
      where: { toOrganizationId_fromLevelId: { toOrganizationId: organizationId, fromLevelId: fromLevel.id } },
      create: { toOrganizationId: organizationId, fromLevelId: fromLevel.id, toLevelId: toLevel.id, declaredByUserId: userId },
      update: { toLevelId: toLevel.id, declaredByUserId: userId },
    });
    await this.audit.record({
      organizationId,
      action: AuditAction.LEVEL_EQUIVALENCE_SET,
      entity: AuditEntity.LEVEL_EQUIVALENCE,
      entityId: equivalence.id,
      meta: { fromLevelId: fromLevel.id, toLevelId: toLevel.id, fromOrganizationId: fromLevel.organizationId },
    });

    let recognizedGraduation = null;
    if (input.recognizeForStudentId) {
      const student = await this.student(organizationId, input.recognizeForStudentId);
      const fromIds = await this.sharedStudentIds(organizationId, student.personId);
      const origin = fromIds.length
        ? await this.prisma.studentGraduation.findFirst({
            where: { studentId: { in: fromIds }, graduationLevelId: fromLevel.id },
            orderBy: [{ graduatedAt: 'desc' }, { id: 'desc' }],
          })
        : null;
      if (!origin) throw badRequest('NOT_SHARED_GRADUATION', 'Este aluno não tem essa corda no histórico compartilhado.');
      const existing = await this.prisma.studentGraduation.findFirst({
        where: { organizationId, studentId: student.id, recognizedFromLevelId: fromLevel.id },
      });
      // Idempotente: reconhecer de novo nao duplica (so acompanha uma equivalencia corrigida).
      const graduation = existing
        ? await this.prisma.studentGraduation.update({ where: { id: existing.id }, data: { graduationLevelId: toLevel.id } })
        : await this.prisma.studentGraduation.create({
            data: {
              organizationId,
              studentId: student.id,
              graduationLevelId: toLevel.id,
              graduatedAt: origin.graduatedAt,
              notes: `Reconhecida de ${fromLevel.organization.name} (${fromLevel.name})`,
              recognizedFromLevelId: fromLevel.id,
            },
          });
      await this.audit.record({
        organizationId,
        action: AuditAction.GRADUATION_RECOGNIZE,
        entity: AuditEntity.STUDENT_GRADUATION,
        entityId: graduation.id,
        meta: { studentId: student.id, fromLevelId: fromLevel.id, toLevelId: toLevel.id, updated: !!existing },
      });
      this.ranking.queueSync(student.id); // Ginga Rank: a reconhecida pontua como GRADUATION na matricula NOVA
      void this.roles.notifyNewSuggestions(organizationId, student.id); // a corda reconhecida pode liberar um cargo
      recognizedGraduation = { id: graduation.id, graduatedAt: graduation.graduatedAt, graduationLevelId: graduation.graduationLevelId, notes: graduation.notes };
    }

    return {
      equivalence: { id: equivalence.id, fromLevel: levelView(fromLevel), toLevel: levelView(toLevel), fromOrganization: fromLevel.organization },
      recognizedGraduation,
    };
  }
}
