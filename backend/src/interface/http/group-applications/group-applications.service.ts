import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { GroupApplicationStatus, Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { LEGAL_VERSION } from '../../../shared/legal/legal-documents';
import { MailService } from '../../../shared/mail/mail.service';
import { DEFAULT_PAGE_SIZE, Page } from '../../../shared/pagination/pagination';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { findUserIdsByEmail } from '../../../shared/security/email-lookup';
import { generatePasswordToken, hashPasswordToken } from '../../../shared/security/password-reset-token';
import { BCRYPT_ROUNDS, normalizeEmail } from '../../../shared/security/password-policy';
import { OrganizationsService } from '../organizations/organizations.service';
import {
  ApproveGroupApplicationDto,
  CreateGroupApplicationDto,
  ListGroupApplicationsQueryDto,
  RejectGroupApplicationDto,
} from './dto/group-application.dto';
import {
  AdminApplicationItem,
  isHoneypotFilled,
  isWellFormedStatusToken,
  MAX_APPLICATIONS_PER_EMAIL,
  painelApplyUrl,
  painelLoginUrl,
  perEmailWindowStart,
  PublicApplicationStatus,
  toAdminItem,
  toPublicStatus,
} from './group-application-rules';

/** 404 UNICO do acompanhamento: token mal formado, inexistente, falso (e-mail ja cadastrado/honeypot) ou purgado. */
export const APPLICATION_NOT_FOUND = 'Pedido não encontrado.';
const ADMIN_NOT_FOUND = 'Pedido de adesão não encontrado.';
/** Maior Int do Postgres: acima disso o Prisma lancaria erro (500) em vez de nao achar nada. */
const MAX_DB_ID = 2_147_483_647;

const conflict = (code: string, message: string) => new ConflictException({ statusCode: 409, error: 'Conflict', code, message });
const notPending = () => conflict('NOT_PENDING', 'Este pedido já foi decidido (ou expirou) e não está mais pendente.');
const emailTaken = () =>
  conflict('EMAIL_TAKEN', 'O e-mail deste pedido já tem uma conta no GingApp. Oriente o solicitante a entrar com essa conta ou usar "Esqueci minha senha".');
const slugTaken = (slug: string) => conflict('SLUG_TAKEN', `O slug "${slug}" já está em uso por outro grupo. Informe outro slug ou deixe em branco.`);

/** Colunas lidas para a visao do admin (NUNCA passwordHash nem statusTokenHash). */
const ADMIN_SELECT = {
  id: true,
  status: true,
  applicantName: true,
  email: true,
  phone: true,
  claimedRole: true,
  groupName: true,
  city: true,
  state: true,
  estimatedStudents: true,
  message: true,
  createdAt: true,
  decidedAt: true,
  decidedByUserId: true,
  rejectionReason: true,
  internalNote: true,
  organization: { select: { id: true, name: true, slug: true } },
} satisfies Prisma.GroupApplicationSelect;

type AdminRow = Prisma.GroupApplicationGetPayload<{ select: typeof ADMIN_SELECT }>;

/**
 * Adesao de grupos (docs/CONTRATO_ADESAO_GRUPOS.md secoes 1-4).
 *
 * Pedido publico: valida (DTO), faz o hash bcrypt da senha SEMPRE (mesmo custo em todos os ramos) e responde SEMPRE
 * `{ statusToken, status: 'PENDING' }`; so grava quando o e-mail nao tem conta, nao tem pedido pendente, nao passou de 3
 * pedidos em 30 dias e o honeypot esta vazio. Nos demais casos o token devolvido nao corresponde a nada (o acompanhamento
 * diz "Pedido nao encontrado"): nenhuma enumeracao de contas. A senha so existe em memoria; no banco, so o hash.
 *
 * Decisao (so super admin): aprovar usa o MESMO nucleo de criacao de grupo (OrganizationsService.createGroupWithPasswordHash)
 * numa unica transacao que tambem "reserva" o pedido PENDING; rejeitar grava o motivo (vai para o solicitante). Em ambos o
 * passwordHash e apagado. E-mail de aviso best effort (falha nunca desfaz a decisao).
 */
@Injectable()
export class GroupApplicationsService {
  private readonly logger = new Logger(GroupApplicationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly organizations: OrganizationsService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  // -------------------------------------------------------------------------------------------------------------
  // Publico
  // -------------------------------------------------------------------------------------------------------------

  async submit(dto: CreateGroupApplicationDto): Promise<{ statusToken: string; status: 'PENDING' }> {
    const { token, tokenHash } = generatePasswordToken();
    const accepted = { statusToken: token, status: 'PENDING' as const };
    // Hash em TODOS os ramos (inclusive honeypot e e-mail ja cadastrado): o tempo de resposta nao denuncia o ramo.
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    if (isHoneypotFilled(dto.website)) return accepted;

    const email = normalizeEmail(dto.email);
    const now = new Date();
    if (await this.mustDropSilently(email, now)) return accepted;

    try {
      await this.prisma.groupApplication.create({
        data: {
          applicantName: dto.applicantName,
          email,
          phone: dto.phone ?? null,
          passwordHash,
          claimedRole: dto.claimedRole,
          groupName: dto.groupName,
          city: dto.city,
          state: dto.state,
          estimatedStudents: dto.estimatedStudents ?? null,
          message: dto.message ?? null,
          termsVersion: LEGAL_VERSION,
          termsAcceptedAt: now,
          adultDeclaredAt: now,
          statusTokenHash: tokenHash,
        },
        select: { id: true },
      });
    } catch (error) {
      // Corrida de dois pedidos com o mesmo e-mail: o indice unico parcial (1 PENDING por e-mail) barra o segundo, que
      // recebe a MESMA resposta. Nada do erro (que poderia citar valores) vai para o log.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return accepted;
      this.logger.error(`Falha ao gravar pedido de adesão (${error instanceof Prisma.PrismaClientKnownRequestError ? error.code : 'erro'}).`);
      throw error;
    }
    return accepted;
  }

  /** true = nao gravar (e-mail com conta, pedido pendente ou teto de 3 pedidos em 30 dias). */
  private async mustDropSilently(email: string, now: Date): Promise<boolean> {
    const [existingUser] = await findUserIdsByEmail(this.prisma, email, 1);
    if (existingUser !== undefined) return true;
    const [pending, recent] = await Promise.all([
      this.prisma.groupApplication.count({ where: { email, status: GroupApplicationStatus.PENDING } }),
      this.prisma.groupApplication.count({ where: { email, createdAt: { gte: perEmailWindowStart(now) } } }),
    ]);
    return pending > 0 || recent >= MAX_APPLICATIONS_PER_EMAIL;
  }

  async publicStatus(token: string): Promise<PublicApplicationStatus> {
    if (!isWellFormedStatusToken(token)) throw new NotFoundException(APPLICATION_NOT_FOUND);
    const app = await this.prisma.groupApplication.findUnique({
      where: { statusTokenHash: hashPasswordToken(token) },
      select: { status: true, groupName: true, createdAt: true, decidedAt: true, rejectionReason: true },
    });
    if (!app) throw new NotFoundException(APPLICATION_NOT_FOUND);
    return toPublicStatus(app);
  }

  // -------------------------------------------------------------------------------------------------------------
  // Plataforma (admin)
  // -------------------------------------------------------------------------------------------------------------

  /** Ordem: PENDING primeiro (mais antigos primeiro), depois os demais por createdAt desc. Busca em grupo/solicitante/e-mail/cidade. */
  async list(query: ListGroupApplicationsQueryDto): Promise<Page<AdminApplicationItem>> {
    const conditions: Prisma.Sql[] = [];
    if (query.status) conditions.push(Prisma.sql`"status" = ${query.status}::"GroupApplicationStatus"`);
    const q = query.q?.trim();
    if (q) {
      // ILIKE com os curingas do texto digitado ESCAPADOS (um "%" ou "_" na busca nao vira coringa).
      const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      conditions.push(
        Prisma.sql`("groupName" ILIKE ${like} OR "applicantName" ILIKE ${like} OR "email" ILIKE ${like} OR "city" ILIKE ${like})`,
      );
    }
    const where = conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;
    const take = query.limit ?? DEFAULT_PAGE_SIZE;
    const skip = query.offset ?? 0;
    const [idRows, countRows] = await Promise.all([
      this.prisma.$queryRaw<Array<{ id: number }>>(
        Prisma.sql`SELECT "id" FROM "GroupApplication" ${where}
          ORDER BY ("status" = 'PENDING') DESC,
                   CASE WHEN "status" = 'PENDING' THEN "createdAt" END ASC,
                   "createdAt" DESC, "id" DESC
          LIMIT ${take} OFFSET ${skip}`,
      ),
      this.prisma.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`SELECT count(*)::bigint AS n FROM "GroupApplication" ${where}`),
    ]);
    const ids = idRows.map((r) => r.id);
    const rows = ids.length > 0 ? await this.prisma.groupApplication.findMany({ where: { id: { in: ids } }, select: ADMIN_SELECT }) : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ordered = ids.map((id) => byId.get(id)).filter((r): r is AdminRow => r !== undefined);
    return { items: await this.withDeciders(ordered), total: Number(countRows[0]?.n ?? 0) };
  }

  async pendingCount(): Promise<{ count: number }> {
    return { count: await this.prisma.groupApplication.count({ where: { status: GroupApplicationStatus.PENDING } }) };
  }

  async findOne(id: number): Promise<AdminApplicationItem> {
    const row = id > MAX_DB_ID ? null : await this.prisma.groupApplication.findUnique({ where: { id }, select: ADMIN_SELECT });
    if (!row) throw new NotFoundException(ADMIN_NOT_FOUND);
    return (await this.withDeciders([row]))[0];
  }

  /**
   * Aprova: cria Organization + User(MESTRE, senha = hash do pedido) + Matriz + 4 cargos pelo nucleo unico, numa
   * transacao que primeiro troca o pedido de PENDING para APPROVED com UPDATE condicional (2 aprovacoes simultaneas: a
   * segunda espera o lock da linha, ve que nao e mais PENDING e desfaz tudo com 409 NOT_PENDING). Qualquer erro no meio
   * desfaz tudo (nenhum grupo orfao, pedido continua PENDING).
   */
  async approve(id: number, dto: ApproveGroupApplicationDto, userId: number) {
    if (id > MAX_DB_ID) throw new NotFoundException(ADMIN_NOT_FOUND);
    const app = await this.prisma.groupApplication.findUnique({
      where: { id },
      select: {
        status: true,
        passwordHash: true,
        applicantName: true,
        email: true,
        phone: true,
        groupName: true,
        city: true,
        state: true,
        termsVersion: true,
        termsAcceptedAt: true,
      },
    });
    if (!app) throw new NotFoundException(ADMIN_NOT_FOUND);
    if (app.status !== GroupApplicationStatus.PENDING || !app.passwordHash) throw notPending();

    const now = new Date();
    let organization: { id: number; name: string; slug: string };
    try {
      const created = await this.organizations.createGroupWithPasswordHash(
        {
          name: app.groupName,
          slug: dto.slug,
          city: app.city,
          state: app.state,
          mestre: {
            name: app.applicantName,
            email: app.email,
            phone: app.phone ?? undefined,
            // O aceite foi feito pelo proprio titular no pedido (versao gravada nele; se for antiga, o painel pede de novo).
            acceptedTerms: { version: app.termsVersion, at: app.termsAcceptedAt },
          },
        },
        app.passwordHash,
        {
          beforeCreate: async (tx) => {
            const { count } = await tx.groupApplication.updateMany({
              where: { id, status: GroupApplicationStatus.PENDING },
              data: {
                status: GroupApplicationStatus.APPROVED,
                decidedAt: now,
                decidedByUserId: userId,
                passwordHash: null,
                ...(dto.internalNote !== undefined ? { internalNote: dto.internalNote } : {}),
              },
            });
            if (count !== 1) throw notPending();
          },
          afterCreate: async (tx, group) => {
            await tx.groupApplication.update({ where: { id }, data: { organizationId: group.id }, select: { id: true } });
          },
          errors: { emailTaken, slugTaken },
        },
      );
      organization = { id: created.id, name: created.name, slug: created.slug };
    } catch (error) {
      // O 409 de e-mail e checado ANTES da transacao: se outra aprovacao do MESMO pedido acabou de criar a conta, o certo
      // e NOT_PENDING (o pedido ja foi decidido), nao EMAIL_TAKEN.
      if (error instanceof ConflictException && (error.getResponse() as { code?: string }).code === 'EMAIL_TAKEN') {
        const current = await this.prisma.groupApplication.findUnique({ where: { id }, select: { status: true } });
        if (current && current.status !== GroupApplicationStatus.PENDING) throw notPending();
      }
      throw error;
    }

    await this.audit.record({
      organizationId: organization.id,
      action: AuditAction.GROUP_APPLICATION_APPROVE,
      entity: AuditEntity.GROUP_APPLICATION,
      entityId: id,
      meta: { status: GroupApplicationStatus.APPROVED, organizationId: organization.id },
    });
    if (this.mail.isEnabled()) {
      // Best effort: MailService nunca lanca; falha so vira log tecnico. A decisao ja esta gravada.
      await this.mail.sendGroupApplicationApproved({ to: app.email, link: painelLoginUrl() });
    }
    return { application: await this.findOne(id), organization };
  }

  /** Rejeita (so PENDING): grava o motivo (vai para o solicitante), apaga o hash da senha e avisa por e-mail (best effort). */
  async reject(id: number, dto: RejectGroupApplicationDto, userId: number): Promise<AdminApplicationItem> {
    if (id > MAX_DB_ID) throw new NotFoundException(ADMIN_NOT_FOUND);
    const { count } = await this.prisma.groupApplication.updateMany({
      where: { id, status: GroupApplicationStatus.PENDING },
      data: {
        status: GroupApplicationStatus.REJECTED,
        decidedAt: new Date(),
        decidedByUserId: userId,
        rejectionReason: dto.reason,
        passwordHash: null,
        ...(dto.internalNote !== undefined ? { internalNote: dto.internalNote } : {}),
      },
    });
    if (count !== 1) {
      const exists = await this.prisma.groupApplication.findUnique({ where: { id }, select: { id: true } });
      if (!exists) throw new NotFoundException(ADMIN_NOT_FOUND);
      throw notPending();
    }
    await this.audit.record({
      organizationId: null,
      action: AuditAction.GROUP_APPLICATION_REJECT,
      entity: AuditEntity.GROUP_APPLICATION,
      entityId: id,
      meta: { status: GroupApplicationStatus.REJECTED },
    });
    const item = await this.findOne(id);
    if (this.mail.isEnabled()) {
      await this.mail.sendGroupApplicationRejected({ to: item.email, reason: dto.reason, link: painelApplyUrl() });
    }
    return item;
  }

  /** Junta `decidedBy: { id, name }` (decidedByUserId sem FK: usuario apagado = null). */
  private async withDeciders(rows: AdminRow[]): Promise<AdminApplicationItem[]> {
    const ids = [...new Set(rows.map((r) => r.decidedByUserId).filter((v): v is number => v !== null))];
    const users = ids.length > 0 ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    return rows.map((r) => toAdminItem(r, r.decidedByUserId !== null ? (byId.get(r.decidedByUserId) ?? null) : null));
  }
}
