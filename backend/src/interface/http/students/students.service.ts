import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StaffRole, Student } from '@prisma/client';
import { sortRoles } from '../roles/staff-roles';
import { Page, pageArgs } from '../../../shared/pagination/pagination';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import {
  assertUnitUpdate,
  resolveWriteUnit,
  UnitScopeService,
  unitScopeFilter,
} from '../../../shared/access/unit-scope';
import { ListStudentsQueryDto } from './dto/list-students-query.dto';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';
import { formatCpf } from '../../../shared/security/person-document';
import { PersonFichaService } from '../people/person-ficha.service';
import { PersonIdentityService } from '../people/person-identity.service';

/** Alunos do grupo — CRUD completo, sempre isolado por organizationId. */
@Injectable()
export class StudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly unitScope: UnitScopeService,
    private readonly audit: AuditService,
    private readonly people: PersonIdentityService,
    private readonly fichaService: PersonFichaService,
  ) {}

  /**
   * Escopo por unidade (E08, ver shared/access/unit-scope.ts): o PROFESSOR com unidades atribuídas só lista/lê/edita
   * alunos das suas unidades; `user` omitido (chamada interna) = sem restrição. O mesmo `where` vale para a lista
   * e para a contagem (X-Total-Count).
   */
  async findAll(organizationId: number, query: ListStudentsQueryDto = {}, user?: AuthenticatedUser): Promise<Page<Student>> {
    const where = await this.listWhere(organizationId, query, user);

    const [items, total] = await Promise.all([
      this.prisma.student.findMany({ where, orderBy: { id: 'desc' }, ...pageArgs(query) }),
      this.prisma.student.count({ where }),
    ]);
    return { items: await this.withStaffRoles(organizationId, items), total };
  }

  /** Fase 3: staffRoles (cargos ATIVOS no grupo, maior primeiro) em cada aluno - o selo de cargo das listas. */
  async withStaffRoles<T extends { userId: number | null }>(organizationId: number, items: T[]): Promise<(T & { staffRoles: StaffRole[] })[]> {
    const userIds = items.map((i) => i.userId).filter((v): v is number => v !== null);
    const rows = userIds.length
      ? await this.prisma.personRole.findMany({ where: { organizationId, userId: { in: userIds }, revokedAt: null }, select: { userId: true, role: true } })
      : [];
    const byUser = new Map<number, StaffRole[]>();
    for (const r of rows) byUser.set(r.userId, sortRoles([...(byUser.get(r.userId) ?? []), r.role]));
    return items.map((i) => ({ ...i, staffRoles: i.userId !== null ? (byUser.get(i.userId) ?? []) : [] }));
  }

  /**
   * `where` ÚNICO (SSOT) da lista de alunos: usado por GET /students e pela exportação CSV
   * (GET /students/export.csv), para a planilha ter exatamente as linhas que o filtro da tela mostra.
   */
  async listWhere(
    organizationId: number,
    query: Pick<ListStudentsQueryDto, 'status' | 'unitId' | 'q' | 'role'> = {},
    user?: AuthenticatedUser,
  ): Promise<Prisma.StudentWhereInput> {
    const where: Prisma.StudentWhereInput = { organizationId }; // organizationId SEMPRE no where (findMany e count)
    // AND (e não spread de unitId): o filtro ?unitId= da query se COMBINA com o escopo, nunca o amplia.
    where.AND = [unitScopeFilter(await this.unitScope.resolve(user, organizationId))];
    if (query.status) where.status = query.status;
    if (query.unitId !== undefined) where.unitId = query.unitId;
    if (query.role) {
      // Cargo ativo da pessoa no grupo (PersonRole), pelo login da matricula.
      const holders = await this.prisma.personRole.findMany({
        where: { organizationId, role: query.role, revokedAt: null },
        select: { userId: true },
      });
      (where.AND as Prisma.StudentWhereInput[]).push({ userId: { in: holders.map((h) => h.userId) } });
    }
    const q = query.q?.trim();
    if (q) {
      where.OR = (['name', 'email', 'document', 'phone'] as const).map((field) => ({
        [field]: { contains: q, mode: 'insensitive' as const },
      }));
    }
    return where;
  }

  /**
   * Alunos ligados ao usuário autenticado: ele mesmo (se for ALUNO com Student.userId
   * próprio) e/ou os alunos dos quais é responsável (StudentGuardian.userId) — cobre tanto
   * o PWA do próprio capoeirista quanto o de um responsável acompanhando os filhos.
   */
  async findMine(organizationId: number, userId: number) {
    const [ownRecord, guardianLinks] = await Promise.all([
      this.prisma.student.findFirst({ where: { organizationId, userId } }),
      this.prisma.studentGuardian.findMany({
        where: { organizationId, userId },
        include: { student: true },
      }),
    ]);

    const students = ownRecord ? [ownRecord] : [];
    for (const link of guardianLinks) {
      if (!students.some((s) => s.id === link.student.id)) {
        students.push(link.student);
      }
    }
    return students;
  }

  /**
   * Vínculo do usuário autenticado com UM aluno específico (SSOT da regra "próprio ou
   * dependente", mesma de findMine acima): `null` = o aluno não existe nesta organização;
   * `linked=false` = existe mas o usuário não é o próprio (Student.userId) nem responsável
   * (StudentGuardian.userId). Nunca confia em studentId vindo da URL/corpo sem isso. Cada
   * chamador decide o status HTTP (Passaporte: 404/403; rotas de leitura de dado do aluno:
   * 404 nos dois casos, para não vazar a existência de alunos de terceiros).
   */
  async resolveLink(organizationId: number, userId: number, studentId: number) {
    const student = await this.prisma.student.findFirst({ where: { id: studentId, organizationId } });
    if (!student) {
      return null;
    }
    if (student.userId === userId) {
      return { student, guardian: null, linked: true };
    }
    const guardian = await this.prisma.studentGuardian.findFirst({ where: { organizationId, studentId, userId } });
    return { student, guardian, linked: guardian !== null };
  }

  /**
   * Auto-atendimento do próprio perfil (PATCH /students/me/profile) — nunca passa por
   * @CanAccess: a segurança vem de só encontrar/editar o Student cujo userId é o do token, igual
   * ao raciocínio de findMine acima. Só aceita campos de UpdateMyProfileDto (foto/capa/redes
   * sociais) — nunca os campos administrativos, que exigem @CanAccess('students', 'edit') via
   * update() abaixo. Um RESPONSAVEL sem Student próprio (só dependentes) recebe 404 — este
   * endpoint edita o PRÓPRIO perfil, não o de terceiros mesmo que dependentes.
   */
  async updateMyProfile(organizationId: number, userId: number, dto: UpdateMyProfileDto) {
    const student = await this.prisma.student.findFirst({ where: { organizationId, userId } });
    if (!student) {
      throw new NotFoundException('Nenhum aluno vinculado a esta conta.');
    }

    const updated = await this.prisma.student.update({
      where: { id: student.id },
      data: {
        // null limpa a coluna (NULL); undefined deixa como está.
        photo: dto.photo,
        coverPhoto: dto.coverPhoto,
        socialLinks: this.toSocialLinksInput(dto.socialLinks),
      },
    });
    // A foto é da própria pessoa: vale também para a ficha única (se ela já existe).
    if (dto.photo !== undefined && student.personId) {
      await this.prisma.person.update({ where: { id: student.personId }, data: { photo: dto.photo } });
    }
    return updated;
  }

  /**
   * socialLinks (coluna Json? nullable): undefined = não mexe; null OU objeto sem nenhuma rede
   * ({} ou só chaves null) = Prisma.DbNull (NULL de verdade no Postgres — NÃO Prisma.JsonNull,
   * que gravaria o literal JSON `null` e deixaria `IS NULL` falso; um único estado "vazio", sem
   * {} gravado); objeto com redes = substitui por inteiro, descartando chaves null/undefined.
   */
  private toSocialLinksInput(
    socialLinks: UpdateMyProfileDto['socialLinks'],
  ): Prisma.InputJsonValue | typeof Prisma.DbNull | undefined {
    if (socialLinks === undefined) return undefined;
    if (socialLinks === null) return Prisma.DbNull;
    const filled = Object.fromEntries(
      Object.entries(socialLinks).filter(([, url]) => url !== null && url !== undefined),
    );
    return Object.keys(filled).length > 0 ? (filled as Prisma.InputJsonValue) : Prisma.DbNull;
  }

  async findOne(organizationId: number, id: number, user?: AuthenticatedUser) {
    const scope = await this.unitScope.resolve(user, organizationId);
    const student = await this.prisma.student.findFirst({ where: { id, organizationId, ...unitScopeFilter(scope) } });
    if (!student) {
      throw new NotFoundException('Aluno não encontrado.');
    }
    return student;
  }

  async create(organizationId: number, dto: CreateStudentDto, user?: AuthenticatedUser) {
    const unitId = resolveWriteUnit(await this.unitScope.resolve(user, organizationId), dto.unitId);
    if (unitId) {
      await this.assertUnitBelongsToOrganization(organizationId, unitId);
    }
    await this.assertWithinStudentLimit(organizationId);

    // Ficha unica (docs/FICHA_UNICA.md): a pessoa ja existe? (CPF / CPF do responsavel + nascimento / codigo GingApp /
    // nome + nascimento). 400/409 com `code` antes de gravar qualquer coisa.
    const identity = this.people.parseInput(dto);
    const birthDate = identity.birthDate ?? undefined;
    const document = identity.cpf ? formatCpf(identity.cpf) : undefined;
    for (let attempt = 0; ; attempt++) {
      const resolution = await this.people.resolveForEnrollment(organizationId, identity);
      await this.people.auditResolution(organizationId, resolution, 'create');
      this.people.throwIfError(resolution);
      try {
        const { student, person } = await this.prisma.$transaction(async (tx) => {
          const person = await this.people.personIdFor(tx, resolution, {
            name: dto.name,
            birthDate: identity.birthDate,
            photo: dto.photo,
            phone: dto.phone,
            email: dto.email,
          });
          const student = await tx.student.create({
            data: {
              organizationId,
              unitId,
              personId: person.id,
              name: dto.name,
              birthDate,
              document,
              phone: dto.phone,
              email: dto.email,
              photo: dto.photo,
              status: dto.status,
              joinedAt: dto.joinedAt ? new Date(dto.joinedAt) : undefined,
            },
          });
          return { student, person };
        });
        return { ...student, person };
      } catch (error) {
        // Corrida: outro cadastro gravou a mesma pessoa (CPF/codigo unicos) entre a consulta e a gravacao. Refaz a
        // consulta uma vez - agora ela devolve o 409 correto em vez de 500.
        if (attempt === 0 && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue;
        throw error;
      }
    }
  }

  /** Ficha unica da matricula `id` vista pela equipe (so as matriculas DESTE grupo nesta fase). */
  async ficha(organizationId: number, id: number, user?: AuthenticatedUser) {
    await this.findOne(organizationId, id, user); // 404: outro grupo / fora do escopo de unidade
    return this.fichaService.forStaff(organizationId, id);
  }

  async update(organizationId: number, id: number, dto: UpdateStudentDto, user?: AuthenticatedUser) {
    const current = await this.findOne(organizationId, id, user); // 404 se não existir, for de outra organização ou de unidade fora do escopo
    assertUnitUpdate(await this.unitScope.resolve(user, organizationId), dto.unitId); // 403: não move para fora do escopo

    if (dto.unitId) {
      await this.assertUnitBelongsToOrganization(organizationId, dto.unitId);
    }

    // CPF: so e validado/aplicado na ficha quando MUDA (valor legado reenviado igual pelo formulario passa).
    const document = dto.document === undefined ? undefined : await this.people.applyDocumentChange(id, current.document, dto.document);

    const updated = await this.prisma.student.update({
      where: { id },
      data: {
        unitId: dto.unitId,
        name: dto.name,
        // null limpa a coluna (NULL); undefined deixa como esta.
        birthDate: dto.birthDate === null ? null : dto.birthDate ? new Date(dto.birthDate) : undefined,
        document,
        phone: dto.phone,
        email: dto.email,
        photo: dto.photo,
        status: dto.status,
        joinedAt: dto.joinedAt === null ? null : dto.joinedAt ? new Date(dto.joinedAt) : undefined,
      },
    });
    // Inativar pelo PATCH (status) conta como inativacao; demais edicoes nao sao sensiveis o bastante para a trilha.
    if (dto.status === 'INACTIVE') {
      await this.audit.record({
        organizationId,
        action: AuditAction.STUDENT_INACTIVATE,
        entity: AuditEntity.STUDENT,
        entityId: id,
        meta: { via: 'update' },
      });
    }
    await this.people.syncFromStudent(id);
    return updated;
  }

  /**
   * "Remover" um aluno nunca apaga o registro — o histórico não deve ser apagado quando o
   * aluno fica inativo (projeto.txt §20). Marca status = INACTIVE.
   */
  async remove(organizationId: number, id: number, user?: AuthenticatedUser) {
    await this.findOne(organizationId, id, user);
    const updated = await this.prisma.student.update({ where: { id }, data: { status: 'INACTIVE' } });
    await this.audit.record({
      organizationId,
      action: AuditAction.STUDENT_INACTIVATE,
      entity: AuditEntity.STUDENT,
      entityId: id,
      meta: { via: 'delete' },
    });
    return updated;
  }

  /** Nunca confiar em unitId vindo do corpo da requisição sem confirmar que pertence à
   * organização do usuário autenticado (PLANO_PROJETO.md §3.2 item 4). */
  private async assertUnitBelongsToOrganization(organizationId: number, unitId: number): Promise<void> {
    const unit = await this.prisma.unit.findFirst({ where: { id: unitId, organizationId } });
    if (!unit) {
      throw new BadRequestException('Unidade inválida para esta organização.');
    }
  }

  /**
   * Aplica Plan.maxStudents (Fase 2 — PLANO_PROJETO.md §10.13). Sem assinatura em aberto
   * (TRIALING/ACTIVE/PAST_DUE) ou sem limite definido no plano, não bloqueia nada — isso
   * mantém orgs de teste/seed sem assinatura funcionando como antes. Conta só alunos ACTIVE:
   * um aluno INACTIVE (soft-delete) não deve ocupar vaga do limite do plano.
   */
  private async assertWithinStudentLimit(organizationId: number): Promise<void> {
    const subscription = await this.subscriptionsService.findOpenForOrganization(organizationId);
    const maxStudents = subscription?.plan.maxStudents;
    if (!maxStudents) {
      return;
    }

    const activeCount = await this.prisma.student.count({
      // Fase 3: matricula da EQUIPE (isStaff) nao ocupa vaga do plano.
      where: { organizationId, status: 'ACTIVE', isStaff: false },
    });
    if (activeCount >= maxStudents) {
      throw new BadRequestException(
        `Limite de ${maxStudents} alunos do plano "${subscription!.plan.name}" atingido. Faça upgrade do plano para adicionar mais alunos.`,
      );
    }
  }
}
