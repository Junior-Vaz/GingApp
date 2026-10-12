import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Notification, OrgRole, Prisma } from '@prisma/client';
import { LimitOffsetQueryDto, Page, pageArgs } from '../../../shared/pagination/pagination';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { PushService } from '../../../shared/push/push.service';

/** Conteúdo de uma notificação in-app (Notification.type é uma tag livre, ex.: 'ANNOUNCEMENT', 'LESSON_CANCELLED'). */
export interface NotificationPayload {
  title: string;
  body: string;
  type: string;
}

/** Teto de destinatários de gatilhos de BROADCAST (evento/roda novo no grupo): evita uma rajada
 * de milhares de linhas por um único POST. Acima disso o excedente (ids maiores) simplesmente não
 * é notificado — o item continua visível na agenda do app. */
export const BROADCAST_RECIPIENT_LIMIT = 2000;

/** Tamanho do lote de createMany (limite de parâmetros do Postgres: 5 colunas x 500 = 2500 binds). */
const CREATE_MANY_CHUNK = 500;

/**
 * Notificações são sempre pessoais (por userId), nunca por organização — um usuário só
 * enxerga (e só pode marcar como lida) a própria notificação. Não há @CanAccess aqui: a
 * segurança vem da query sempre filtrar por userId do token, não de uma checagem de papel.
 *
 * Este service também é o SSOT de PRODUÇÃO de notificações: todo gatilho do sistema (comunicado,
 * aula cancelada/alterada, graduação, evento/roda novo, mensalidade vencida) passa por
 * `notifyUsers`/`notifyAudience`/`notifyStudents`/... — nenhum outro módulo escreve em
 * `notification` diretamente.
 *
 * Web Push (I13): toda notificação gravada por `createMany` também dispara o push em segundo plano
 * (PushService.dispatch — fire-and-forget, nunca lança, desligado sem VAPID). Dentro de uma `$transaction` do
 * chamador o push só pode sair DEPOIS do commit: o chamador passa o `client` da transação e chama
 * `pushAfterCommit(items)` quando ela confirmar.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // PRODUÇÃO
  // ---------------------------------------------------------------------------------------------

  /** createMany em lotes. Devolve quantas linhas foram gravadas. `client` permite participar de uma
   * `$transaction` do chamador (ex.: marcar mensalidades OVERDUE e notificar de forma atômica) — nesse caso o push
   * NÃO é disparado aqui (a transação pode reverter): chame `pushAfterCommit(items)` depois do commit. */
  async createMany(
    items: Prisma.NotificationCreateManyInput[],
    client: Pick<Prisma.TransactionClient, 'notification'> = this.prisma,
  ): Promise<number> {
    let created = 0;
    for (let i = 0; i < items.length; i += CREATE_MANY_CHUNK) {
      const result = await client.notification.createMany({ data: items.slice(i, i + CREATE_MANY_CHUNK) });
      created += result.count;
    }
    if (client === this.prisma) this.pushAfterCommit(items);
    return created;
  }

  /** Dispara o push (segundo plano, nunca lança) de notificações JÁ confirmadas no banco. */
  pushAfterCommit(items: Prisma.NotificationCreateManyInput[]): void {
    this.push.dispatch(items.map((i) => ({ userId: i.userId, title: i.title, body: i.body, type: i.type })));
  }

  /** Uma notificação por usuário distinto (userIds repetidos não duplicam). `maxRecipients` corta o
   * excedente de forma determinística (menores ids primeiro). Lança em caso de erro do banco. */
  async notifyUsers(
    organizationId: number,
    userIds: Iterable<number>,
    payload: NotificationPayload,
    maxRecipients?: number,
  ): Promise<number> {
    let unique = [...new Set(userIds)].sort((a, b) => a - b);
    if (maxRecipients !== undefined) unique = unique.slice(0, maxRecipients);
    if (unique.length === 0) return 0;
    return this.createMany(unique.map((userId) => ({ organizationId, userId, ...payload })));
  }

  /**
   * Público-alvo de um aviso do grupo.
   * - unitId nulo: todo membro ativo da organização (qualquer papel).
   * - unitId preenchido: MESTRE (sempre, vê tudo), usuários com acesso àquela unidade, alunos daquela
   *   unidade e os responsáveis vinculados a eles.
   */
  async audienceUserIds(organizationId: number, unitId: number | null): Promise<Set<number>> {
    const userIds = new Set<number>();

    if (unitId === null) {
      const members = await this.prisma.organizationUser.findMany({
        where: { organizationId, status: 'ACTIVE' },
        select: { userId: true },
      });
      members.forEach((m) => userIds.add(m.userId));
      return userIds;
    }

    const [mestres, unitAccess, students, guardians] = await Promise.all([
      this.prisma.organizationUser.findMany({
        where: { organizationId, status: 'ACTIVE', role: OrgRole.MESTRE },
        select: { userId: true },
      }),
      this.prisma.userUnitAccess.findMany({ where: { organizationId, unitId }, select: { userId: true } }),
      this.prisma.student.findMany({
        where: { organizationId, unitId, userId: { not: null } },
        select: { userId: true },
      }),
      this.prisma.studentGuardian.findMany({
        where: { organizationId, userId: { not: null }, student: { unitId } },
        select: { userId: true },
      }),
    ]);
    mestres.forEach((m) => userIds.add(m.userId));
    unitAccess.forEach((u) => userIds.add(u.userId));
    students.forEach((s) => s.userId && userIds.add(s.userId));
    guardians.forEach((g) => g.userId && userIds.add(g.userId));
    return userIds;
  }

  /** Notifica o público-alvo do aviso (ver audienceUserIds). Lança em caso de erro do banco. */
  async notifyAudience(
    organizationId: number,
    unitId: number | null,
    payload: NotificationPayload,
    maxRecipients?: number,
  ): Promise<number> {
    return this.notifyUsers(organizationId, await this.audienceUserIds(organizationId, unitId), payload, maxRecipients);
  }

  /**
   * studentId -> userIds que "enxergam" aquele aluno: o próprio login do aluno (Student.userId) e os
   * logins dos responsáveis (StudentGuardian.userId). Sempre escopado por organização: aluno de
   * outro grupo não aparece. Aluno sem login nem responsável com login => lista vazia.
   */
  async userIdsByStudent(organizationId: number, studentIds: number[]): Promise<Map<number, number[]>> {
    const result = new Map<number, number[]>();
    const ids = [...new Set(studentIds)];
    if (ids.length === 0) return result;

    const [students, guardians] = await Promise.all([
      this.prisma.student.findMany({
        where: { organizationId, id: { in: ids } },
        select: { id: true, userId: true },
      }),
      this.prisma.studentGuardian.findMany({
        where: { organizationId, studentId: { in: ids }, userId: { not: null } },
        select: { studentId: true, userId: true },
      }),
    ]);
    for (const s of students) {
      result.set(s.id, s.userId ? [s.userId] : []);
    }
    for (const g of guardians) {
      const list = result.get(g.studentId);
      if (list && g.userId && !list.includes(g.userId)) list.push(g.userId);
    }
    return result;
  }

  /** Notifica os alunos (e responsáveis com login) indicados. SEGURO: erro vira log e retorno 0 —
   * a notificação é efeito colateral e nunca deve fazer a ação principal (graduar, cancelar aula) falhar. */
  async notifyStudents(organizationId: number, studentIds: number[], payload: NotificationPayload): Promise<number> {
    return this.safely('notifyStudents', async () => {
      const byStudent = await this.userIdsByStudent(organizationId, studentIds);
      return this.notifyUsers(organizationId, [...byStudent.values()].flat(), payload);
    });
  }

  /** Notifica quem está matriculado (ClassStudent ACTIVE, aluno ACTIVE) na turma + responsáveis. SEGURO (ver notifyStudents). */
  async notifyClassStudents(organizationId: number, classId: number, payload: NotificationPayload): Promise<number> {
    return this.safely('notifyClassStudents', async () => {
      const enrollments = await this.prisma.classStudent.findMany({
        where: { organizationId, classId, status: 'ACTIVE', student: { status: 'ACTIVE' } },
        select: { studentId: true },
      });
      const byStudent = await this.userIdsByStudent(
        organizationId,
        enrollments.map((e) => e.studentId),
      );
      return this.notifyUsers(organizationId, [...byStudent.values()].flat(), payload);
    });
  }

  /** Broadcast SEGURO a todos os membros ativos do grupo (ou da unidade), com teto BROADCAST_RECIPIENT_LIMIT. */
  async notifyGroupMembers(organizationId: number, unitId: number | null, payload: NotificationPayload): Promise<number> {
    return this.safely('notifyGroupMembers', () =>
      this.notifyAudience(organizationId, unitId, payload, BROADCAST_RECIPIENT_LIMIT),
    );
  }

  /** Executa um gatilho secundário: se falhar, registra e devolve 0 (não propaga). */
  async safely(label: string, fn: () => Promise<number>): Promise<number> {
    try {
      return await fn();
    } catch (error) {
      this.logger.error(
        `Falha ao gerar notificações (${label}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // LEITURA (sino do app)
  // ---------------------------------------------------------------------------------------------

  /** Mais recentes primeiro (`id` desempata => paginação determinística). Paginado: limit/offset,
   * total de notificações do usuário em X-Total-Count. */
  async findAllForUser(userId: number, query: LimitOffsetQueryDto = {}): Promise<Page<Notification>> {
    const where = { userId };
    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageArgs(query),
      }),
      this.prisma.notification.count({ where }),
    ]);
    return { items, total };
  }

  /**
   * Retorna `{ count }`, não um número puro — achado empírico (PLANO_PROJETO.md §10.11):
   * um controller do Nest que devolve um primitivo (number/string) faz o Express responder
   * com `Content-Type: text/html`, não `application/json` (Nest só chama `res.json()` para
   * valores tipo objeto/array). Isso quebra qualquer cliente que dependa do content-type para
   * decidir se faz parse como JSON (ex.: superagent/supertest) — envolver num objeto evita a
   * ambiguidade e fica consistente com `markAllAsRead`, que já retorna `{ count }`.
   */
  async countUnreadForUser(userId: number): Promise<{ count: number }> {
    const count = await this.prisma.notification.count({ where: { userId, readAt: null } });
    return { count };
  }

  async markAsRead(userId: number, id: number) {
    const notification = await this.prisma.notification.findFirst({ where: { id, userId } });
    if (!notification) {
      throw new NotFoundException('Notificação não encontrada.');
    }
    if (notification.readAt) {
      return notification;
    }
    return this.prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
  }

  async markAllAsRead(userId: number) {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { count: result.count };
  }
}
