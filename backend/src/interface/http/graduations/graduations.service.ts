import { RolesService } from '../roles/roles.service';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { PermissionsService } from '../../../shared/access/permissions.service';
import { UnitScopeService, unitScopeFilter } from '../../../shared/access/unit-scope';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { StudentsService } from '../students/students.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RankingService } from '../ranking/ranking.service';
import { formatCivilDateBR } from '../../../shared/dates/format-br';
import { CreateGraduationSystemDto } from './dto/create-graduation-system.dto';
import { CreateGraduationLevelDto } from './dto/create-graduation-level.dto';
import { CreateStudentGraduationDto } from './dto/create-student-graduation.dto';
import { UpdateGraduationSystemDto } from './dto/update-graduation-system.dto';
import { UpdateGraduationLevelDto } from './dto/update-graduation-level.dto';
import { UpdateStudentGraduationDto } from './dto/update-student-graduation.dto';
import { CreateSystemFromTemplateDto, ReorderLevelsDto } from './dto/graduation-structure.dto';
import { GRADUATION_TEMPLATES, findGraduationTemplate } from './graduation-templates';
import { MAX_LEVELS_PER_SYSTEM, RopeFields, resolveRope, withRope } from './rope';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';

@Injectable()
export class GraduationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly studentsService: StudentsService,
    private readonly notifications: NotificationsService,
    private readonly unitScope: UnitScopeService,
    private readonly audit: AuditService,
    private readonly ranking: RankingService,
    private readonly roles: RolesService,
  ) {}

  /** Sistemas de graduação configuráveis do grupo, com seus níveis (projeto.txt §26). */
  async findAll(organizationId: number) {
    const systems = await this.prisma.graduationSystem.findMany({
      where: { organizationId },
      include: { levels: { orderBy: { order: 'asc' } } },
      orderBy: { id: 'desc' },
      take: 50,
    });
    return systems.map(withLevelsRope);
  }

  /** Lista os sistemas de graduação da organização, cada um com seus níveis em ordem. */
  async findAllSystems(organizationId: number) {
    const systems = await this.prisma.graduationSystem.findMany({
      where: { organizationId },
      include: { levels: { orderBy: { order: 'asc' } } },
      orderBy: { id: 'asc' },
    });
    return systems.map(withLevelsRope);
  }

  /** Um sistema da organização com seus níveis ({id, name, order, color, style, colors}). 404 se de outro grupo. */
  async findSystem(organizationId: number, systemId: number) {
    const system = await this.prisma.graduationSystem.findFirst({
      where: { id: systemId, organizationId },
      include: { levels: { orderBy: { order: 'asc' } } },
    });
    if (!system) {
      throw new NotFoundException('Sistema de graduação não encontrado.');
    }
    return withLevelsRope(system);
  }

  /** Modelos genéricos de sistema (estáticos) para o painel criar um sistema pronto. */
  listTemplates() {
    return GRADUATION_TEMPLATES;
  }

  /**
   * Cria um sistema (e todos os níveis) a partir de um modelo, numa única transação. Mesma permissão do create de
   * sistema (graduations.create, no controller). Código inexistente = 404.
   */
  async createSystemFromTemplate(organizationId: number, dto: CreateSystemFromTemplateDto) {
    const template = findGraduationTemplate(dto.code);
    if (!template) {
      throw new NotFoundException('Modelo de graduação não encontrado.');
    }
    const name = dto.name?.trim() || template.name;
    const system = await this.prisma.$transaction(async (tx) => {
      const created = await tx.graduationSystem.create({
        data: { organizationId, name, description: template.description },
      });
      await tx.graduationLevel.createMany({
        data: template.levels.map((level, index) => ({
          organizationId,
          graduationSystemId: created.id,
          name: level.name,
          order: index + 1,
          style: level.style,
          colors: level.colors,
          color: level.colors[0],
        })),
      });
      return tx.graduationSystem.findUniqueOrThrow({
        where: { id: created.id },
        include: { levels: { orderBy: { order: 'asc' } } },
      });
    });
    await this.audit.record({
      organizationId,
      action: AuditAction.GRADUATION_SYSTEM_CREATE,
      entity: AuditEntity.GRADUATION_SYSTEM,
      entityId: system.id,
      meta: { name: system.name, templateCode: template.code, levels: template.levels.length },
    });
    return withLevelsRope(system);
  }

  async createSystem(organizationId: number, dto: CreateGraduationSystemDto) {
    const created = await this.prisma.graduationSystem.create({
      data: {
        organizationId,
        name: dto.name,
        description: dto.description,
      },
    });
    await this.audit.record({
      organizationId,
      action: AuditAction.GRADUATION_SYSTEM_CREATE,
      entity: AuditEntity.GRADUATION_SYSTEM,
      entityId: created.id,
      meta: { name: created.name },
    });
    return created;
  }

  async createLevel(organizationId: number, systemId: number, dto: CreateGraduationLevelDto) {
    const system = await this.assertSystemBelongsToOrganization(organizationId, systemId);
    if (!system.isActive) {
      throw new BadRequestException('Sistema de graduação inativo: reative-o para criar níveis.');
    }

    const rope = resolveRope({ style: dto.style, colors: dto.colors, color: dto.color });
    await this.assertRoomForLevels(systemId, 1);

    const created = await this.prisma.graduationLevel
      .create({
        data: {
          organizationId,
          graduationSystemId: systemId,
          name: dto.name,
          order: dto.order,
          color: rope.color,
          style: rope.style,
          colors: rope.colors,
        },
      })
      .catch(rethrowDuplicateOrder);
    await this.audit.record({
      organizationId,
      action: AuditAction.GRADUATION_LEVEL_CREATE,
      entity: AuditEntity.GRADUATION_LEVEL,
      entityId: created.id,
      meta: { name: created.name, systemId, order: created.order, style: created.style },
    });
    return withRope(created);
  }

  /**
   * Duplica um nível: cópia no FIM da ordem do sistema (maior order + 1), nome "<nome> (cópia)", mesma corda.
   * Sistema inativo ou já no limite de níveis = 400.
   */
  async duplicateLevel(organizationId: number, levelId: number) {
    const source = await this.assertLevelExists(organizationId, levelId);
    const system = await this.assertSystemBelongsToOrganization(organizationId, source.graduationSystemId);
    if (!system.isActive) {
      throw new BadRequestException('Sistema de graduação inativo: reative-o para criar níveis.');
    }
    await this.assertRoomForLevels(system.id, 1);
    const last = await this.prisma.graduationLevel.aggregate({
      where: { graduationSystemId: system.id },
      _max: { order: true },
    });
    const created = await this.prisma.graduationLevel
      .create({
        data: {
          organizationId,
          graduationSystemId: system.id,
          name: `${source.name} (cópia)`,
          order: (last._max.order ?? -1) + 1,
          ...ropeData(withRope(source)),
        },
      })
      .catch(rethrowDuplicateOrder);
    await this.audit.record({
      organizationId,
      action: AuditAction.GRADUATION_LEVEL_CREATE,
      entity: AuditEntity.GRADUATION_LEVEL,
      entityId: created.id,
      meta: { name: created.name, systemId: system.id, order: created.order, duplicatedFrom: levelId },
    });
    return withRope(created);
  }

  /**
   * Reordena TODOS os níveis do sistema de forma atômica. `order` = ids dos níveis do MAIS BAIXO para o mais alto e
   * deve conter exatamente os níveis do sistema (sem faltar nem sobrar). Os valores de `order` já usados são
   * redistribuídos na nova sequência (mantém lacunas/ponto zero; os pontos do Ginga Rank dependem do valor). Como
   * (sistema, order) é único, a troca passa por ordens temporárias negativas dentro da mesma transação.
   */
  async reorderLevels(organizationId: number, systemId: number, dto: ReorderLevelsDto) {
    await this.assertSystemBelongsToOrganization(organizationId, systemId);
    const levels = await this.prisma.graduationLevel.findMany({
      where: { graduationSystemId: systemId, organizationId },
      orderBy: { order: 'asc' },
    });
    const known = new Set(levels.map((l) => l.id));
    if (dto.order.length !== levels.length || dto.order.some((id) => !known.has(id))) {
      throw new BadRequestException('A lista deve conter exatamente os níveis deste sistema, sem repetir.');
    }
    const slots = levels.map((l) => l.order); // já crescente
    const previousOrder = new Map(levels.map((l) => [l.id, l.order]));
    const target = new Map(dto.order.map((id, index) => [id, slots[index]]));
    const changed = dto.order.filter((id) => previousOrder.get(id) !== target.get(id));

    if (changed.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        for (const [index, id] of changed.entries()) {
          await tx.graduationLevel.update({ where: { id }, data: { order: -(index + 1) } });
        }
        for (const id of changed) {
          await tx.graduationLevel.update({ where: { id }, data: { order: target.get(id) as number } });
        }
      });
      await this.audit.record({
        organizationId,
        action: AuditAction.GRADUATION_SYSTEM_UPDATE,
        entity: AuditEntity.GRADUATION_SYSTEM,
        entityId: systemId,
        meta: { reorderLevels: true, moved: changed.length },
      });
      // Pontos do Ginga Rank = 100 x ordem da corda: quem tem graduação em nível que mudou de ordem recalcula (fire-and-forget).
      const affected = await this.prisma.studentGraduation.findMany({
        where: { organizationId, graduationLevelId: { in: changed } },
        select: { studentId: true },
        distinct: ['studentId'],
      });
      for (const { studentId } of affected) this.ranking.queueSync(studentId);
    }
    return this.findSystem(organizationId, systemId);
  }

  /** Limite anti-abuso: no máximo MAX_LEVELS_PER_SYSTEM níveis por sistema. */
  private async assertRoomForLevels(systemId: number, adding: number): Promise<void> {
    const count = await this.prisma.graduationLevel.count({ where: { graduationSystemId: systemId } });
    if (count + adding > MAX_LEVELS_PER_SYSTEM) {
      throw new BadRequestException(`Limite de ${MAX_LEVELS_PER_SYSTEM} níveis por sistema de graduação.`);
    }
  }

  async updateSystem(organizationId: number, systemId: number, dto: UpdateGraduationSystemDto) {
    await this.assertSystemBelongsToOrganization(organizationId, systemId);
    const updated = await this.prisma.graduationSystem.update({
      where: { id: systemId },
      data: { name: dto.name, description: dto.description, isActive: dto.isActive },
      include: { levels: { orderBy: { order: 'asc' } } },
    });
    await this.audit.record({
      organizationId,
      action: AuditAction.GRADUATION_SYSTEM_UPDATE,
      entity: AuditEntity.GRADUATION_SYSTEM,
      entityId: systemId,
      meta: { fields: definedFields(dto), isActive: updated.isActive },
    });
    return withLevelsRope(updated);
  }

  /**
   * Remover um sistema: se algum aluno já foi graduado em algum nível dele, o histórico não
   * pode sumir — o sistema só fica inativo (isActive=false, mesmo padrão de StudentsService/
   * ClassesService). Sem nenhuma graduação concedida, apaga de verdade (níveis + sistema).
   */
  async removeSystem(organizationId: number, systemId: number) {
    await this.assertSystemBelongsToOrganization(organizationId, systemId);
    const awarded = await this.prisma.studentGraduation.count({
      where: { organizationId, graduationLevel: { graduationSystemId: systemId } },
    });
    if (awarded > 0) {
      const inactivated = await this.prisma.graduationSystem.update({
        where: { id: systemId },
        data: { isActive: false },
      });
      await this.audit.record({
        organizationId,
        action: AuditAction.GRADUATION_SYSTEM_DELETE,
        entity: AuditEntity.GRADUATION_SYSTEM,
        entityId: systemId,
        meta: { deleted: false, inactivated: true },
      });
      return inactivated;
    }
    await this.prisma.$transaction([
      this.prisma.graduationLevel.deleteMany({ where: { graduationSystemId: systemId, organizationId } }),
      this.prisma.graduationSystem.deleteMany({ where: { id: systemId, organizationId } }),
    ]);
    await this.audit.record({
      organizationId,
      action: AuditAction.GRADUATION_SYSTEM_DELETE,
      entity: AuditEntity.GRADUATION_SYSTEM,
      entityId: systemId,
      meta: { deleted: true },
    });
    return { id: systemId, deleted: true };
  }

  async updateLevel(organizationId: number, levelId: number, dto: UpdateGraduationLevelDto) {
    const current = await this.assertLevelExists(organizationId, levelId);
    const ropeTouched = dto.style !== undefined || dto.colors !== undefined || (dto.color !== undefined && dto.color !== null);
    const rope = ropeTouched
      ? resolveRope({ style: dto.style, colors: dto.colors, color: dto.color }, withRope(current))
      : undefined;
    const updated = await this.prisma.graduationLevel
      .update({
        where: { id: levelId },
        data: { name: dto.name, order: dto.order, ...(rope ? ropeData(rope) : {}) },
      })
      .catch(rethrowDuplicateOrder);
    await this.audit.record({
      organizationId,
      action: AuditAction.GRADUATION_LEVEL_UPDATE,
      entity: AuditEntity.GRADUATION_LEVEL,
      entityId: levelId,
      meta: { fields: definedFields(dto) },
    });
    return withRope(updated);
  }

  /**
   * Nível já concedido a algum aluno não pode ser apagado (o modelo não tem status para
   * inativar um nível): 409 — o histórico dos alunos permanece intacto.
   */
  async removeLevel(organizationId: number, levelId: number) {
    await this.assertLevelExists(organizationId, levelId);
    const awarded = await this.prisma.studentGraduation.count({ where: { graduationLevelId: levelId, organizationId } });
    if (awarded > 0) {
      throw new ConflictException('Este nível já foi concedido a alunos e não pode ser removido.');
    }
    await this.prisma.graduationLevel.deleteMany({ where: { id: levelId, organizationId } });
    await this.audit.record({
      organizationId,
      action: AuditAction.GRADUATION_LEVEL_DELETE,
      entity: AuditEntity.GRADUATION_LEVEL,
      entityId: levelId,
    });
    return { id: levelId, deleted: true };
  }

  /**
   * Histórico de graduações de um aluno da organização (projeto.txt §27), mais recente primeiro.
   * Staff (graduations.view na matriz RolePermission, ou PLATFORM) vê qualquer aluno da
   * organização; os demais (ALUNO/RESPONSAVEL) só o próprio Student ou um dependente — aluno
   * sem vínculo dá o MESMO 404 de aluno inexistente (não vaza existência).
   */
  async findStudentHistory(organizationId: number, studentId: number, requester: AuthenticatedUser) {
    if (await this.permissions.can(requester, 'graduations', 'view')) {
      // Staff: o PROFESSOR com unidades atribuídas (E08) só vê o histórico de alunos das suas unidades (404).
      await this.assertStudentBelongsToOrganization(organizationId, studentId, requester);
    } else {
      const link = await this.studentsService.resolveLink(organizationId, requester.id, studentId);
      if (!link?.linked) {
        throw new NotFoundException('Aluno não encontrado.');
      }
    }

    const rows = await this.prisma.studentGraduation.findMany({
      where: { studentId, organizationId },
      include: { graduationLevel: true },
      orderBy: { graduatedAt: 'desc' },
    });
    return rows.map(withGraduationRope);
  }

  /** Registra uma nova graduação para o aluno. Nunca confia em FKs vindas do corpo sem
   * confirmar que pertencem à organização do usuário autenticado. */
  async createStudentGraduation(
    organizationId: number,
    studentId: number,
    dto: CreateStudentGraduationDto,
    requester?: AuthenticatedUser,
  ) {
    await this.assertStudentBelongsToOrganization(organizationId, studentId, requester);
    await this.assertLevelBelongsToOrganization(organizationId, dto.graduationLevelId);

    const graduation = await this.prisma.studentGraduation.create({
      data: {
        organizationId,
        studentId,
        graduationLevelId: dto.graduationLevelId,
        graduatedAt: new Date(dto.graduatedAt),
        notes: dto.notes,
      },
      include: { graduationLevel: true },
    });

    // Gatilho de notificação (E09): avisa o aluno (login próprio) e os responsáveis com login.
    // Efeito colateral SEGURO — falha ao notificar não desfaz nem derruba o registro da graduação.
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, organizationId },
      select: { name: true },
    });
    await this.notifications.notifyStudents(organizationId, [studentId], {
      title: 'Nova graduação',
      body: `${student?.name ?? 'O aluno'} recebeu a graduação "${graduation.graduationLevel.name}" em ${formatCivilDateBR(graduation.graduatedAt)}.`,
      type: 'GRADUATION',
    });

    await this.audit.record({
      organizationId,
      action: AuditAction.STUDENT_GRADUATION_CREATE,
      entity: AuditEntity.STUDENT_GRADUATION,
      entityId: graduation.id,
      meta: { studentId, graduationLevelId: dto.graduationLevelId },
    });
    this.ranking.queueSync(studentId); // Ginga Rank (fire-and-forget): 100 x ordem da corda
    // Fase 3: corda que libera um cargo => aviso aos Mestres (1x por aluno+cargo; segundo plano, nunca derruba a graduacao).
    void this.roles.notifyNewSuggestions(organizationId, studentId);
    return withGraduationRope(graduation);
  }

  /** Corrige a graduação lançada (nível/data/observações). 404 se não for deste aluno/organização. */
  async updateStudentGraduation(
    organizationId: number,
    studentId: number,
    graduationId: number,
    dto: UpdateStudentGraduationDto,
    requester?: AuthenticatedUser,
  ) {
    await this.assertStudentBelongsToOrganization(organizationId, studentId, requester);
    await this.assertStudentGraduationExists(organizationId, studentId, graduationId);
    if (dto.graduationLevelId !== undefined) {
      await this.assertLevelBelongsToOrganization(organizationId, dto.graduationLevelId);
    }
    const updated = await this.prisma.studentGraduation.update({
      where: { id: graduationId },
      data: {
        graduationLevelId: dto.graduationLevelId,
        graduatedAt: dto.graduatedAt !== undefined ? new Date(dto.graduatedAt) : undefined,
        notes: dto.notes,
      },
      include: { graduationLevel: true },
    });
    await this.audit.record({
      organizationId,
      action: AuditAction.STUDENT_GRADUATION_UPDATE,
      entity: AuditEntity.STUDENT_GRADUATION,
      entityId: graduationId,
      meta: { studentId, fields: definedFields(dto) },
    });
    this.ranking.queueSync(studentId); // Ginga Rank (nivel/data corrigidos mudam os pontos)
    return withGraduationRope(updated);
  }

  /**
   * Desfaz um registro lançado por engano (hard delete — é o próprio registro, não o aluno).
   * Se já existe certificado emitido a partir dela, 409: o certificado precisa ser tratado antes.
   */
  async removeStudentGraduation(
    organizationId: number,
    studentId: number,
    graduationId: number,
    requester?: AuthenticatedUser,
  ) {
    await this.assertStudentBelongsToOrganization(organizationId, studentId, requester);
    await this.assertStudentGraduationExists(organizationId, studentId, graduationId);
    const certificates = await this.prisma.certificate.count({
      where: { studentGraduationId: graduationId, organizationId },
    });
    if (certificates > 0) {
      throw new ConflictException('Há certificado emitido para esta graduação; remova-o antes.');
    }
    await this.prisma.studentGraduation.deleteMany({ where: { id: graduationId, studentId, organizationId } });
    await this.audit.record({
      organizationId,
      action: AuditAction.STUDENT_GRADUATION_DELETE,
      entity: AuditEntity.STUDENT_GRADUATION,
      entityId: graduationId,
      meta: { studentId },
    });
    this.ranking.queueSync(studentId); // Ginga Rank (remove os pontos da graduacao desfeita)
    return { id: graduationId, deleted: true };
  }

  private async assertStudentGraduationExists(organizationId: number, studentId: number, graduationId: number) {
    const found = await this.prisma.studentGraduation.findFirst({
      where: { id: graduationId, studentId, organizationId },
    });
    if (!found) {
      throw new NotFoundException('Graduação não encontrada.');
    }
    return found;
  }

  private async assertLevelExists(organizationId: number, levelId: number) {
    const level = await this.prisma.graduationLevel.findFirst({ where: { id: levelId, organizationId } });
    if (!level) {
      throw new NotFoundException('Nível de graduação não encontrado.');
    }
    return level;
  }

  private async assertSystemBelongsToOrganization(organizationId: number, systemId: number) {
    const system = await this.prisma.graduationSystem.findFirst({ where: { id: systemId, organizationId } });
    if (!system) {
      throw new NotFoundException('Sistema de graduação não encontrado.');
    }
    return system;
  }

  private async assertStudentBelongsToOrganization(
    organizationId: number,
    studentId: number,
    requester?: AuthenticatedUser,
  ): Promise<void> {
    const scope = await this.unitScope.resolve(requester, organizationId);
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, organizationId, ...unitScopeFilter(scope) },
    });
    if (!student) {
      throw new NotFoundException('Aluno não encontrado.');
    }
  }

  private async assertLevelBelongsToOrganization(organizationId: number, levelId: number): Promise<void> {
    const level = await this.prisma.graduationLevel.findFirst({ where: { id: levelId, organizationId } });
    if (!level) {
      throw new BadRequestException('Nível de graduação inválido para esta organização.');
    }
  }
}

/** Campos de corda prontos para gravar no Prisma (color = colors[0]). */
function ropeData(rope: RopeFields): { color: string; style: RopeFields['style']; colors: string[] } {
  return { color: rope.color, style: rope.style, colors: rope.colors };
}

/** Sistema com todos os níveis no contrato {id, name, order, color, style, colors, ...}. */
function withLevelsRope<S extends { levels: Array<{ color: string | null; style?: RopeFields['style'] | null; colors?: string[] | null }> }>(
  system: S,
) {
  return { ...system, levels: system.levels.map((level) => withRope(level)) };
}

/** Graduação do aluno com o nível (graduationLevel) no contrato de corda. */
function withGraduationRope<G extends { graduationLevel: { color: string | null; style?: RopeFields['style'] | null; colors?: string[] | null } }>(
  graduation: G,
) {
  return { ...graduation, graduationLevel: withRope(graduation.graduationLevel) };
}

/** Nomes dos campos enviados no DTO (para o `meta` da auditoria: nunca os valores). */
function definedFields(dto: object): string[] {
  return Object.entries(dto)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key);
}

/** @@unique([graduationSystemId, order]): ordem repetida no mesmo sistema vira 409, não 500. */
function rethrowDuplicateOrder(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new ConflictException('Já existe um nível com esta ordem neste sistema.');
  }
  throw error;
}
