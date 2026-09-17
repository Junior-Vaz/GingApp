import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { StudentsService } from '../students/students.service';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
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
  ) {}

  findAll(organizationId: number) {
    return this.prisma.event.findMany({
      where: { organizationId },
      orderBy: { id: 'desc' },
      take: 50,
    });
  }

  async findOne(organizationId: number, id: number) {
    const event = await this.prisma.event.findFirst({ where: { id, organizationId } });
    if (!event) {
      throw new NotFoundException('Evento não encontrado.');
    }
    return event;
  }

  async create(organizationId: number, dto: CreateEventDto) {
    if (dto.unitId) {
      await this.assertUnitBelongsToOrganization(organizationId, dto.unitId);
    }
    await this.assertLocationReferencesExist(dto);

    return this.prisma.event.create({
      data: {
        organizationId,
        unitId: dto.unitId,
        title: dto.title,
        type: dto.type,
        description: dto.description,
        date: new Date(dto.date),
        location: dto.location,
        isPublic: dto.isPublic ?? false,
        stateId: dto.stateId,
        cityId: dto.cityId,
      },
    });
  }

  async update(organizationId: number, id: number, dto: UpdateEventDto) {
    await this.findOne(organizationId, id); // 404 se não existir ou não for desta organização

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
      },
    });
  }

  /**
   * Event não tem campo "status" no schema (diferente de Student), então não há como
   * "inativar" — excluir apaga de verdade. Primeiro remove os EventParticipant do evento
   * (senão a FK quebra), depois o Event, numa transação.
   */
  async remove(organizationId: number, id: number) {
    await this.findOne(organizationId, id);

    await this.prisma.$transaction([
      this.prisma.eventParticipant.deleteMany({ where: { eventId: id } }),
      this.prisma.event.delete({ where: { id } }),
    ]);
  }

  /** Lista os participantes de um evento, com o nome do aluno quando studentId estiver
   * preenchido. Valida que o evento pertence à organização antes (404 se não). */
  async listParticipants(organizationId: number, eventId: number) {
    await this.findOne(organizationId, eventId);

    return this.prisma.eventParticipant.findMany({
      where: { organizationId, eventId },
      include: { student: { select: { id: true, name: true } } },
      orderBy: { id: 'desc' },
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
    await this.findOne(organizationId, eventId);

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

    return this.prisma.eventParticipant.create({
      data: {
        organizationId,
        eventId,
        studentId: dto.studentId,
        guestName: dto.guestName,
        status: dto.status,
      },
      include: { student: { select: { id: true, name: true } } },
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
    await this.findOne(organizationId, eventId);

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
      const isMine = participant.studentId != null && myStudents.some((s) => s.id === participant.studentId);
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
    await this.findOne(organizationId, eventId);

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
  private async assertLocationReferencesExist(dto: Pick<CreateEventDto, 'stateId' | 'cityId'>): Promise<void> {
    if (dto.stateId !== undefined) {
      const state = await this.prisma.state.findUnique({ where: { id: dto.stateId } });
      if (!state) throw new BadRequestException('Estado inválido.');
    }
    if (dto.cityId !== undefined) {
      const city = await this.prisma.city.findUnique({ where: { id: dto.cityId } });
      if (!city) throw new BadRequestException('Cidade inválida.');
    }
  }
}
