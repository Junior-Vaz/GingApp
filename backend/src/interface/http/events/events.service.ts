import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { OrgRole, Prisma } from '@prisma/client';
import { Page, pageArgs } from '../../../shared/pagination/pagination';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { ListEventsQueryDto } from './dto/list-events-query.dto';
import { StudentsService } from '../students/students.service';
import { NotificationsService } from '../notifications/notifications.service';
import { formatInstantBR } from '../../../shared/dates/format-br';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { MyParticipation, redactParticipant } from '../../../shared/access/participant-privacy';
import {
  assertUnitOwned,
  assertUnitUpdate,
  groupWideOrUnitFilter,
  resolveWriteUnit,
  UnitScopeService,
} from '../../../shared/access/unit-scope';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { AddEventParticipantDto } from './dto/add-event-participant.dto';

const ADMIN_ROLES: OrgRole[] = [OrgRole.MESTRE, OrgRole.PROFESSOR];

/**
 * Eventos do grupo — CRUD completo, sempre isolado por organizationId (PLANO_PROJETO.md
 * §10.5/§10.6). Event não tem campo status (diferente de Student): "excluir" apaga de
 * verdade, em cascata com os EventParticipant do evento.
 */
@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly studentsService: StudentsService,
    private readonly notifications: NotificationsService,
    private readonly unitScope: UnitScopeService,
  ) {}

  /**
   * Listagem do grupo. Cada item mantém TODOS os campos de Event (compatível com painel/admin)
   * e ganha dois agregados (sem N+1: um groupBy + um findMany por página, nunca por item):
   * - `participantsCount`: total de inscrições do evento (qualquer status);
   * - `myParticipation`: `{ id, studentId, status }` da inscrição do PRÓPRIO usuário do token
   *   ou de um dependente (StudentsService.findMine; prioridade ao próprio aluno), senão `null`.
   * Ordem: sem `order`, id desc (mais recém-cadastrados primeiro — é o que o painel lista);
   * `order=asc` = data asc + id asc (próximos primeiro; o app combina com `from`);
   * `order=desc` = data desc + id desc. Sempre com desempate por id: paginação estável.
   */
  async findAll(
    organizationId: number,
    query: ListEventsQueryDto = {},
    requester?: AuthenticatedUser,
  ): Promise<Page<unknown>> {
    const and: Prisma.EventWhereInput[] = [];
    // from/to: data do evento, datas civis (UTC) inclusivas.
    if (query.from) and.push({ date: { gte: new Date(`${query.from.slice(0, 10)}T00:00:00.000Z`) } });
    if (query.to) {
      and.push({ date: { lt: new Date(new Date(`${query.to.slice(0, 10)}T00:00:00.000Z`).getTime() + 86_400_000) } });
    }
    const q = query.q?.trim();
    if (q) {
      and.push({
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { location: { contains: q, mode: 'insensitive' } },
        ],
      });
    }
    // Escopo por unidade (E08, shared/access/unit-scope.ts): o PROFESSOR com unidades atribuídas só vê eventos do grupo
    // inteiro (unitId nulo) e das suas unidades; lista e contagem usam o mesmo where.
    and.push(groupWideOrUnitFilter(await this.unitScope.resolve(requester, organizationId)));
    const where: Prisma.EventWhereInput = {
      organizationId,
      ...(query.type ? { type: query.type } : {}),
      AND: and,
    };

    const orderBy: Prisma.EventOrderByWithRelationInput[] =
      query.order === 'asc'
        ? [{ date: 'asc' }, { id: 'asc' }]
        : query.order === 'desc'
          ? [{ date: 'desc' }, { id: 'desc' }]
          : [{ id: 'desc' }];

    const [items, total] = await Promise.all([
      this.prisma.event.findMany({ where, orderBy, ...pageArgs(query) }),
      this.prisma.event.count({ where }),
    ]);
    return { items: await this.withParticipationSummary(items, requester, organizationId), total };
  }

  /**
   * Anexa `participantsCount` e `myParticipation` a uma página de eventos (um groupBy + um
   * findMany, nunca por item). Reusado por GET /events (`organizationId` = o do token) e por
   * GET /calendar (eventos públicos de VÁRIAS organizações: sem `organizationId`, o vínculo
   * "próprio ou dependente" é resolvido em todas as organizações). Nenhum nome de terceiro.
   */
  async withParticipationSummary<T extends { id: number }>(
    events: T[],
    requester?: AuthenticatedUser,
    organizationId?: number,
  ): Promise<Array<T & { participantsCount: number; myParticipation: MyParticipation | null }>> {
    if (events.length === 0) return [];
    const eventIds = events.map((e) => e.id);
    const orgFilter = organizationId !== undefined ? { organizationId } : {};
    let myStudentIds: number[] = [];
    if (requester) {
      myStudentIds =
        organizationId !== undefined
          ? (await this.studentsService.findMine(organizationId, requester.id)).map((s) => s.id)
          : await this.findMyStudentIdsAcrossOrganizations(requester.id);
    }

    const [counts, mine] = await Promise.all([
      this.prisma.eventParticipant.groupBy({
        by: ['eventId'],
        where: { ...orgFilter, eventId: { in: eventIds } },
        _count: { _all: true },
      }),
      myStudentIds.length > 0
        ? this.prisma.eventParticipant.findMany({
            where: { ...orgFilter, eventId: { in: eventIds }, studentId: { in: myStudentIds } },
            select: { id: true, eventId: true, studentId: true, status: true },
            orderBy: { id: 'asc' },
          })
        : Promise.resolve([]),
    ]);

    const countByEvent = new Map(counts.map((c) => [c.eventId, c._count._all]));
    return events.map((event) => {
      // findMine devolve o próprio aluno primeiro, depois os dependentes — mesma prioridade
      // do pickMyStudent do app.
      const own = myStudentIds
        .map((studentId) => mine.find((p) => p.eventId === event.id && p.studentId === studentId))
        .find((p) => p !== undefined);
      return {
        ...event,
        participantsCount: countByEvent.get(event.id) ?? 0,
        myParticipation: own ? { id: own.id, studentId: own.studentId, status: own.status } : null,
      };
    });
  }

  /** Mesma regra de StudentsService.findMine ("próprio aluno" primeiro, depois dependentes), mas
   * sem restringir a uma organização — o calendário público mistura eventos de vários grupos. */
  private async findMyStudentIdsAcrossOrganizations(userId: number): Promise<number[]> {
    const [own, guardianLinks] = await Promise.all([
      this.prisma.student.findMany({ where: { userId }, select: { id: true }, orderBy: { id: 'asc' } }),
      this.prisma.studentGuardian.findMany({ where: { userId }, select: { studentId: true }, orderBy: { id: 'asc' } }),
    ]);
    return [...new Set([...own.map((s) => s.id), ...guardianLinks.map((g) => g.studentId)])];
  }

  async findOne(organizationId: number, id: number, requester?: AuthenticatedUser) {
    const scope = await this.unitScope.resolve(requester, organizationId);
    const event = await this.prisma.event.findFirst({
      where: { id, organizationId, AND: [groupWideOrUnitFilter(scope)] },
    });
    if (!event) {
      throw new NotFoundException('Evento não encontrado.');
    }
    return event;
  }

  async create(organizationId: number, dto: CreateEventDto, requester?: AuthenticatedUser) {
    // Professor restrito: o evento é de uma das suas unidades (a única, por padrão), nunca "do grupo inteiro".
    const unitId = resolveWriteUnit(await this.unitScope.resolve(requester, organizationId), dto.unitId);
    if (unitId) {
      await this.assertUnitBelongsToOrganization(organizationId, unitId);
    }
    await this.assertLocationReferencesExist(dto);

    const event = await this.prisma.event.create({
      data: {
        organizationId,
        unitId,
        title: dto.title,
        type: dto.type,
        description: dto.description,
        date: new Date(dto.date),
        location: dto.location,
        isPublic: dto.isPublic ?? false,
        stateId: dto.stateId,
        cityId: dto.cityId,
        imageUrl: dto.imageUrl,
      },
    });

    // Gatilho de notificação (E09): evento NOVO e FUTURO avisa os membros ativos do grupo (da unidade,
    // quando o evento é de uma unidade) — mesmo público-alvo do comunicado, com teto de destinatários.
    // Efeito colateral SEGURO: falha ao notificar nunca derruba a criação. Eventos já passados
    // (cadastro de histórico) não notificam.
    if (event.date.getTime() > Date.now()) {
      await this.notifications.notifyGroupMembers(organizationId, event.unitId, {
        title: 'Novo evento',
        body: `${event.title} — ${formatInstantBR(event.date)}${event.location ? ` · ${event.location}` : ''}`,
        type: 'EVENT',
      });
    }
    return event;
  }

  async update(organizationId: number, id: number, dto: UpdateEventDto, requester?: AuthenticatedUser) {
    const current = await this.findOne(organizationId, id, requester); // 404 se não existir, for de outra organização ou de unidade fora do escopo
    const scope = await this.unitScope.resolve(requester, organizationId);
    assertUnitOwned(scope, current.unitId); // evento do grupo inteiro (unitId nulo): legível, mas só o Mestre altera (403)
    assertUnitUpdate(scope, dto.unitId);

    if (dto.unitId) {
      await this.assertUnitBelongsToOrganization(organizationId, dto.unitId);
    }
    await this.assertLocationReferencesExist(dto);

    return this.prisma.event.update({
      where: { id },
      data: {
        unitId: dto.unitId,
        title: dto.title,
        type: dto.type,
        description: dto.description,
        date: dto.date ? new Date(dto.date) : undefined,
        location: dto.location,
        isPublic: dto.isPublic,
        stateId: dto.stateId,
        cityId: dto.cityId,
        imageUrl: dto.imageUrl,
      },
    });
  }

  /**
   * Event não tem campo "status" no schema (diferente de Student), então não há como
   * "inativar" — excluir apaga de verdade. Primeiro remove os EventParticipant do evento
   * (senão a FK quebra), depois o Event, numa transação.
   */
  async remove(organizationId: number, id: number, requester?: AuthenticatedUser) {
    const current = await this.findOne(organizationId, id, requester);
    assertUnitOwned(await this.unitScope.resolve(requester, organizationId), current.unitId);

    await this.prisma.$transaction([
      this.prisma.eventParticipant.deleteMany({ where: { eventId: id } }),
      this.prisma.event.delete({ where: { id } }),
    ]);
  }

  /**
   * Lista os participantes de um evento, com o nome do aluno quando studentId estiver
   * preenchido. Valida que o evento pertence à organização antes (404 se não).
   *
   * MESTRE/PROFESSOR (gestão da lista no painel) recebem a lista completa. Os demais membros
   * (ALUNO/RESPONSAVEL) recebem a lista do MESMO tamanho e formato, mas só a própria inscrição
   * (ou de dependente, ou de convidado com o próprio nome) vem identificada — as de terceiros
   * (inclui menores) saem sem id de aluno/usuário e sem nome (redactParticipant, LGPD).
   */
  async listParticipants(organizationId: number, eventId: number, requester: AuthenticatedUser) {
    await this.findOne(organizationId, eventId, requester);

    const participants = await this.prisma.eventParticipant.findMany({
      where: { organizationId, eventId },
      include: { student: { select: { id: true, name: true } } },
      orderBy: { id: 'desc' },
    });
    if (this.isOrgAdmin(requester)) {
      return participants;
    }

    const [myStudents, me] = await Promise.all([
      this.studentsService.findMine(organizationId, requester.id),
      this.prisma.user.findUnique({ where: { id: requester.id }, select: { name: true } }),
    ]);
    const myStudentIds = new Set(myStudents.map((s) => s.id));
    return participants.map((p) => {
      const isMine =
        (p.studentId != null && myStudentIds.has(p.studentId)) ||
        p.userId === requester.id ||
        (p.studentId == null && p.guestName != null && p.guestName === me?.name);
      return isMine ? p : redactParticipant(p);
    });
  }

  /**
   * Adiciona um participante ao evento — OU um aluno (studentId) OU um convidado sem
   * cadastro (guestName), nunca os dois nem nenhum dos dois.
   *
   * Autorização própria, não `@CanAccess` (achado corrigido em §10.9 do plano: a rota usava
   * `@CanAccess('events','create')`, o que bloqueava um ALUNO comum de clicar "Quero
   * participar" — só MESTRE/PROFESSOR tem essa permissão). MESTRE/PROFESSOR pode inscrever
   * qualquer aluno (gestão de lista, uso do painel); um MEMBER comum só pode se
   * autoinscrever — a si mesmo/seus dependentes (studentId "seu", via
   * StudentsService.findMine) ou como convidado (guestName sempre permitido, ação de baixo
   * risco, mesmo espírito do autoregistro em rodas).
   */
  async addParticipant(
    organizationId: number,
    eventId: number,
    requester: AuthenticatedUser,
    dto: AddEventParticipantDto,
  ) {
    await this.findOne(organizationId, eventId, requester);

    const hasStudent = dto.studentId != null;
    const hasGuest = !!dto.guestName;
    if (hasStudent === hasGuest) {
      throw new BadRequestException('Informe studentId ou guestName.');
    }

    if (hasStudent) {
      const student = await this.prisma.student.findFirst({
        where: { id: dto.studentId, organizationId },
      });
      if (!student) {
        throw new BadRequestException('Aluno inválido para esta organização.');
      }

      if (!this.isOrgAdmin(requester)) {
        const myStudents = await this.studentsService.findMine(organizationId, requester.id);
        if (!myStudents.some((s) => s.id === dto.studentId)) {
          throw new ForbiddenException('Você só pode inscrever a si mesmo ou seus dependentes.');
        }
      }
    }

    const include = { student: { select: { id: true, name: true } } };

    // Idempotente: repetir a inscrição do mesmo aluno não duplica (atualiza o status, se enviado).
    if (hasStudent) {
      const existing = await this.prisma.eventParticipant.findFirst({
        where: { organizationId, eventId, studentId: dto.studentId },
        include,
      });
      if (existing) {
        if (dto.status && dto.status !== existing.status) {
          return this.prisma.eventParticipant.update({
            where: { id: existing.id },
            data: { status: dto.status },
            include,
          });
        }
        return existing;
      }
    }

    return this.prisma.eventParticipant.create({
      data: {
        organizationId,
        eventId,
        studentId: dto.studentId,
        guestName: dto.guestName,
        status: dto.status,
        // Guarda quem inscreveu o convidado, para ele poder cancelar a própria inscrição.
        userId: hasGuest ? requester.id : undefined,
      },
      include,
    });
  }

  /**
   * Remove um participante. Mesma lógica de autorização de `addParticipant` (sem
   * `@CanAccess`): MESTRE/PROFESSOR remove qualquer um; um MEMBER comum só pode cancelar a
   * própria inscrição (studentId "seu"). **Limitação conhecida**: inscrição via `guestName`
   * não guarda quem inscreveu (o DTO nunca recebeu `userId`), então só um admin da
   * organização pode remover participantes de convidado — não há "cancelar minha própria
   * inscrição de convidado" nesta versão.
   */
  async removeParticipant(
    organizationId: number,
    eventId: number,
    participantId: number,
    requester: AuthenticatedUser,
  ) {
    await this.findOne(organizationId, eventId, requester);

    const participant = await this.prisma.eventParticipant.findFirst({
      where: { id: participantId, eventId, organizationId },
    });
    if (!participant) {
      throw new NotFoundException('Participante não encontrado.');
    }

    if (!this.isOrgAdmin(requester)) {
      const myStudents = participant.studentId
        ? await this.studentsService.findMine(organizationId, requester.id)
        : [];
      const isMine =
        (participant.studentId != null && myStudents.some((s) => s.id === participant.studentId)) ||
        (participant.studentId == null && participant.userId === requester.id);
      if (!isMine) {
        throw new ForbiddenException('Você só pode cancelar a própria inscrição.');
      }
    }

    await this.prisma.eventParticipant.delete({ where: { id: participantId } });
  }

  /**
   * Check-in de presença (projeto.txt §41/§45: "Futuramente: Check-in" — implementado agora
   * como parte da Jornada do Capoeirista, PLANO_PROJETO.md §10.15). Marca `ATTENDED`, o status
   * que a Passaporte/Certificados vão contar como "esteve lá de verdade" (diferente de
   * `CONFIRMED`, que é só a intenção/RSVP). Sempre uma ação de quem organiza (MESTRE/PROFESSOR
   * na entrada do evento), nunca self-service — por isso não tem a mesma lógica de
   * "é meu aluno" de add/removeParticipant.
   */
  async checkIn(organizationId: number, eventId: number, participantId: number, requester: AuthenticatedUser) {
    await this.findOne(organizationId, eventId, requester);

    if (!this.isOrgAdmin(requester)) {
      throw new ForbiddenException('Só MESTRE/PROFESSOR pode confirmar presença.');
    }

    const participant = await this.prisma.eventParticipant.findFirst({
      where: { id: participantId, eventId, organizationId },
    });
    if (!participant) {
      throw new NotFoundException('Participante não encontrado.');
    }

    return this.prisma.eventParticipant.update({
      where: { id: participantId },
      data: { status: 'ATTENDED' },
      include: { student: { select: { id: true, name: true } } },
    });
  }

  private isOrgAdmin(user: AuthenticatedUser): boolean {
    return !!user.role && ADMIN_ROLES.includes(user.role);
  }

  /** Nunca confiar em unitId vindo do corpo da requisição sem confirmar que pertence à
   * organização do usuário autenticado (PLANO_PROJETO.md §3.2 item 4). */
  private async assertUnitBelongsToOrganization(organizationId: number, unitId: number): Promise<void> {
    const unit = await this.prisma.unit.findFirst({ where: { id: unitId, organizationId } });
    if (!unit) {
      throw new BadRequestException('Unidade inválida para esta organização.');
    }
  }

  /** State/City são dados públicos (não pertencem a nenhuma organização) — mesmo espírito de
   * RodasService.assertReferencesExist: só confirma que o id existe de verdade. */
  private async assertLocationReferencesExist(dto: {
    stateId?: number | null;
    cityId?: number | null;
  }): Promise<void> {
    // `!= null`: null (limpar o campo no PATCH) não tem o que validar.
    if (dto.stateId != null) {
      const state = await this.prisma.state.findUnique({ where: { id: dto.stateId } });
      if (!state) throw new BadRequestException('Estado inválido.');
    }
    if (dto.cityId != null) {
      const city = await this.prisma.city.findUnique({ where: { id: dto.cityId } });
      if (!city) throw new BadRequestException('Cidade inválida.');
    }
  }
}
