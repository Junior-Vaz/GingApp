import { Injectable, Logger } from '@nestjs/common';
import { OrgRole, Prisma, UserType } from '@prisma/client';
import { UnitScopeService } from '../../../shared/access/unit-scope';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DEFAULT_GREETING_MESSAGE, greetingName, isoDate, renderGreeting, saoPauloNow, startOfSaoPauloDay } from './birthday-dates';
import { BIRTHDAY_DIGEST_TYPE, BIRTHDAY_GREETING_TYPE, BirthdaysService, GroupMember, memberInScope } from './birthdays.service';

/** Namespace do advisory lock do resumo diario (par com o id do grupo). */
const DIGEST_LOCK_NS = 7302;

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** "Hoje: 1 aniversariante (Ana)" / "Hoje: 5 aniversariantes (Ana, Bia, Caio e mais 2)". So nomes: nada de idade/data. */
export function digestBody(names: string[]): string {
  const shown = names.slice(0, 3);
  const rest = names.length - shown.length;
  const list = rest > 0 ? `${shown.join(', ')} e mais ${rest}` : shown.length > 1 ? `${shown.slice(0, -1).join(', ')} e ${shown[shown.length - 1]}` : shown[0];
  return `Hoje: ${names.length} ${names.length === 1 ? 'aniversariante' : 'aniversariantes'} (${list}).`;
}

/**
 * Automacao dos aniversarios (chamada pelos jobs de src/jobs/birthdays-cron.service.ts, mas sem depender do relogio:
 * `now` e injetavel). Tudo IDEMPOTENTE:
 *  - resumo diario (BIRTHDAY_DIGEST): no maximo 1 por usuario por dia civil de Sao Paulo (confere a notificacao do dia);
 *  - parabens automaticos: BirthdayGreeting AUTO unico por (grupo, pessoa, ano) criado ANTES de notificar.
 * Notificacoes sempre via NotificationsService (SSOT).
 */
@Injectable()
export class BirthdayAutomationService {
  private readonly logger = new Logger(BirthdayAutomationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly birthdays: BirthdaysService,
    private readonly notifications: NotificationsService,
    private readonly unitScope: UnitScopeService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Resumo diario aos gestores: MESTRE e quem tem `announcements:create` (matriz RolePermission), dentro do escopo de
   * unidade de cada um. So manda se houver aniversariantes para ele. Grupos com `birthdayDailyDigest = false` ficam de fora.
   */
  async sendDailyDigests(now: Date = new Date(), onlyOrganizationId?: number): Promise<{ organizations: number; notified: number }> {
    const today = saoPauloNow(now);
    const dayStart = startOfSaoPauloDay(now);
    const orgs = await this.prisma.organization.findMany({
      where: { type: 'GROUP', status: 'ACTIVE', birthdayDailyDigest: true, ...(onlyOrganizationId !== undefined ? { id: onlyOrganizationId } : {}) },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    const creators = await this.prisma.rolePermission.findMany({
      where: { resource: 'announcements', canCreate: true },
      select: { role: true },
    });
    const roles = [...new Set(creators.map((c) => c.role))];
    let notified = 0;
    let organizations = 0;
    for (const org of orgs) {
      try {
        const members = await this.birthdays.membersOnDate(org.id, today);
        if (members.length === 0) continue;
        const recipients = await this.prisma.organizationUser.findMany({
          where: { organizationId: org.id, status: 'ACTIVE', role: { in: roles }, user: { status: 'ACTIVE', userType: UserType.MEMBER } },
          select: { userId: true, role: true },
        });
        if (recipients.length === 0) continue;
        // Varias replicas rodam o mesmo cron: o "ja enviei hoje?" e o envio ficam na MESMA transacao, sob um advisory lock
        // por grupo (a 2a replica espera, ve as notificacoes ja confirmadas da 1a e nao reenvia). Sem tabela de controle.
        const items = await this.prisma.$transaction(
          async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${DIGEST_LOCK_NS}::int, ${org.id}::int)`;
            const already = new Set(
              (
                await tx.notification.findMany({
                  where: {
                    organizationId: org.id,
                    type: BIRTHDAY_DIGEST_TYPE,
                    userId: { in: recipients.map((r) => r.userId) },
                    createdAt: { gte: dayStart },
                  },
                  select: { userId: true },
                })
              ).map((n) => n.userId),
            );
            const pending: Prisma.NotificationCreateManyInput[] = [];
            for (const recipient of recipients) {
              if (already.has(recipient.userId)) continue;
              const asUser = { id: recipient.userId, email: '', userType: UserType.MEMBER, isSuperAdmin: false, role: recipient.role as OrgRole } as AuthenticatedUser;
              const scope = await this.unitScope.resolve(asUser, org.id);
              const visible = members.filter((m) => memberInScope(m, scope));
              if (visible.length === 0) continue;
              pending.push({
                organizationId: org.id,
                userId: recipient.userId,
                title: 'Aniversariantes de hoje 🎂',
                body: digestBody(visible.map((m) => greetingName(m.name, m.nickname))),
                type: BIRTHDAY_DIGEST_TYPE,
                data: { count: visible.length, date: isoDate(today) },
              });
            }
            await this.notifications.createMany(pending, tx);
            return pending;
          },
          { timeout: 60_000, maxWait: 10_000 },
        );
        this.notifications.pushAfterCommit(items);
        if (items.length > 0) organizations += 1;
        notified += items.length;
      } catch (error) {
        this.logger.error(`Resumo de aniversariantes falhou (grupo ${org.id}): ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { organizations, notified };
  }

  /**
   * Parabens automaticos (varredura horaria): para cada grupo com `birthdayAutoGreeting`, quando a hora de Sao Paulo ja
   * chegou a `birthdayGreetingHour` (>=, para recuperar uma varredura perdida no mesmo dia), cada aniversariante de HOJE
   * com login ativo no grupo recebe a mensagem do grupo (padrao do contrato) UMA vez por ano.
   */
  async sendAutoGreetings(now: Date = new Date(), onlyOrganizationId?: number): Promise<{ organizations: number; greeted: number }> {
    const today = saoPauloNow(now);
    const orgs = await this.prisma.organization.findMany({
      where: {
        type: 'GROUP',
        status: 'ACTIVE',
        birthdayAutoGreeting: true,
        birthdayGreetingHour: { lte: today.hour },
        ...(onlyOrganizationId !== undefined ? { id: onlyOrganizationId } : {}),
      },
      select: { id: true, name: true, birthdayGreetingMessage: true },
      orderBy: { id: 'asc' },
    });
    let greeted = 0;
    let organizations = 0;
    for (const org of orgs) {
      try {
        const members = (await this.birthdays.membersOnDate(org.id, today)).filter((m): m is GroupMember & { userId: number } => m.userId !== null);
        if (members.length === 0) continue;
        const activeUsers = new Set(
          (
            await this.prisma.organizationUser.findMany({
              where: { organizationId: org.id, status: 'ACTIVE', userId: { in: members.map((m) => m.userId) } },
              select: { userId: true },
            })
          ).map((u) => u.userId),
        );
        const template = org.birthdayGreetingMessage?.trim() || DEFAULT_GREETING_MESSAGE;
        const alreadyGreeted = new Set(
          (
            await this.prisma.birthdayGreeting.findMany({
              where: { organizationId: org.id, year: today.year, source: 'AUTO', personId: { in: members.map((m) => m.personId) } },
              select: { personId: true },
            })
          ).map((g) => g.personId),
        );
        let greetedInOrg = 0;
        for (const member of members) {
          if (!activeUsers.has(member.userId) || alreadyGreeted.has(member.personId)) continue;
          try {
            await this.prisma.birthdayGreeting.create({
              data: { organizationId: org.id, personId: member.personId, year: today.year, source: 'AUTO' },
            });
          } catch (error) {
            if (isUniqueViolation(error)) continue; // ja parabenizada neste ano (idempotente)
            throw error;
          }
          const sent = await this.notifications.safely('birthdayAutoGreeting', () =>
            this.notifications.notifyUsers(org.id, [member.userId], {
              title: 'Feliz aniversário! 🎉',
              body: renderGreeting(template, { nome: greetingName(member.name, member.nickname), grupo: org.name }),
              type: BIRTHDAY_GREETING_TYPE,
            }),
          );
          if (sent === 0) {
            // Nao gravou a notificacao: libera a pessoa para a proxima varredura.
            await this.prisma.birthdayGreeting.deleteMany({
              where: { organizationId: org.id, personId: member.personId, year: today.year, source: 'AUTO' },
            });
            continue;
          }
          greetedInOrg += 1;
        }
        if (greetedInOrg > 0) {
          organizations += 1;
          greeted += greetedInOrg;
          await this.audit.record({
            organizationId: org.id,
            userId: null,
            action: AuditAction.BIRTHDAY_GREET,
            entity: AuditEntity.BIRTHDAY,
            entityId: org.id,
            meta: { source: 'AUTO', count: greetedInOrg },
            ip: null,
          });
        }
      } catch (error) {
        this.logger.error(`Parabéns automáticos falharam (grupo ${org.id}): ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { organizations, greeted };
  }
}
