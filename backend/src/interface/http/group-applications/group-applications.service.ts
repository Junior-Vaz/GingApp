import { ConflictException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EmailVerification, GroupApplicationStatus, Prisma, UserType } from '@prisma/client';
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
  adminApplicationsUrl,
  AdminApplicationItem,
  isHoneypotFilled,
  isWellFormedStatusToken,
  MAX_APPLICATIONS_PER_EMAIL,
  MAX_VERIFY_SENDS,
  OPEN_STATUSES,
  painelApplyUrl,
  painelConfirmUrl,
  painelLoginUrl,
  parseNotifyEmails,
  perEmailWindowStart,
  PublicApplicationStatus,
  resendBlock,
  resendCooldownStart,
  TEAM_NOTIFY_SETTING_KEY,
  teamNotifyWindowStart,
  toAdminItem,
  toPublicStatus,
  VERIFY_RESEND_COOLDOWN_MINUTES,
  VERIFY_TOKEN_TTL_HOURS,
  verifyExpiresAt,
} from './group-application-rules';

/** 404 UNICO do acompanhamento: token mal formado, inexistente, falso (e-mail ja cadastrado/honeypot) ou purgado. */
export const APPLICATION_NOT_FOUND = 'Pedido não encontrado.';
/** 404 UNICO da confirmacao: token mal formado, inexistente, vencido ou ja usado. */
export const CONFIRM_LINK_INVALID = 'Link inválido ou vencido. Confira o acompanhamento do pedido ou faça um novo pedido.';

/** Resposta do POST publico: depende SO da configuracao do servidor (e-mail ligado?), nunca de o e-mail ja existir. */
export interface SubmitResponse {
  statusToken: string;
  status: 'UNVERIFIED' | 'PENDING';
  emailVerification: 'PENDING' | 'SKIPPED';
}

const tooMany = (code: string, message: string) =>
  new HttpException({ statusCode: 429, error: 'Too Many Requests', code, message }, HttpStatus.TOO_MANY_REQUESTS);
const ADMIN_NOT_FOUND = 'Pedido de adesão não encontrado.';
/** Maior Int do Postgres: acima disso o Prisma lancaria erro (500) em vez de nao achar nada. */
const MAX_DB_ID = 2_147_483_647;

const conflict = (code: string, message: string) => new ConflictException({ statusCode: 409, error: 'Conflict', code, message });
const notPending = () => conflict('NOT_PENDING', 'Este pedido já foi decidido (ou expirou) e não está mais pendente.');
const emailTaken = () =>
  conflict('EMAIL_TAKEN', 'O e-mail deste pedido já tem uma conta no GingApp. Oriente o solicitante a entrar com essa conta ou usar "Esqueci minha senha".');
const slugTaken = (slug: string) => conflict('SLUG_TAKEN', `O slug "${slug}" já está em uso por outro grupo. Informe outro slug ou deixe em branco.`);
/** Verificacoes que permitem aprovar (contrato de e-mail 1). */
const APPROVABLE_VERIFICATION: EmailVerification[] = [EmailVerification.VERIFIED, EmailVerification.SKIPPED];
const emailNotVerified = () =>
  conflict('EMAIL_NOT_VERIFIED', 'O solicitante ainda não confirmou o e-mail deste pedido. Ele só pode ser aprovado depois da confirmação.');

/** Colunas lidas para a visao do admin (NUNCA passwordHash, statusTokenHash nem verifyTokenHash). */
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
  emailVerification: true,
  emailVerifiedAt: true,
  instagram: true,
} satisfies Prisma.GroupApplicationSelect;

type AdminRow = Prisma.GroupApplicationGetPayload<{ select: typeof ADMIN_SELECT }>;

/**
 * Adesao de grupos (docs/CONTRATO_ADESAO_GRUPOS.md secoes 1-4).
 *
 * Pedido publico: valida (DTO), faz o hash bcrypt da senha SEMPRE (mesmo custo em todos os ramos) e responde SEMPRE
 * `{ statusToken, status, emailVerification }` (valores dependem so de o e-mail transacional estar ligado: UNVERIFIED/
 * PENDING ou PENDING/SKIPPED; docs/CONTRATO_ADESAO_GRUPOS_EMAIL.md); so grava quando o e-mail nao tem conta, nao tem pedido
 * em aberto (UNVERIFIED/PENDING), nao passou de 3
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

  /**
   * Com o e-mail transacional LIGADO o pedido nasce UNVERIFIED e o link de confirmacao (token PROPRIO, diferente do de
   * acompanhamento; so o sha256 no banco) sai por e-mail EM SEGUNDO PLANO, depois da resposta. Desligado: nasce PENDING com
   * emailVerification SKIPPED (nunca bloquear a adesao por falta de SMTP). O formato e os valores da resposta dependem SO
   * dessa configuracao, nunca de o e-mail ja existir (nesse caso: mesma resposta, nada gravado, nenhum e-mail).
   */
  async submit(dto: CreateGroupApplicationDto): Promise<SubmitResponse> {
    const { token, tokenHash } = generatePasswordToken();
    const verify = this.mail.isEnabled();
    const accepted: SubmitResponse = {
      statusToken: token,
      status: verify ? GroupApplicationStatus.UNVERIFIED : GroupApplicationStatus.PENDING,
      emailVerification: verify ? EmailVerification.PENDING : EmailVerification.SKIPPED,
    };
    // Hash em TODOS os ramos (inclusive honeypot e e-mail ja cadastrado): o tempo de resposta nao denuncia o ramo.
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    // Token do link gerado em TODOS os ramos (mesmo custo); so e gravado/enviado quando o pedido e de fato criado.
    const link = generatePasswordToken();
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
          instagram: dto.instagram ?? null,
          termsVersion: LEGAL_VERSION,
          termsAcceptedAt: now,
          adultDeclaredAt: now,
          statusTokenHash: tokenHash,
          status: accepted.status,
          emailVerification: accepted.emailVerification,
          ...(verify
            ? { verifyTokenHash: link.tokenHash, verifyExpiresAt: verifyExpiresAt(now), verifySentAt: now, verifySentCount: 1 }
            : {}),
        },
        select: { id: true },
      });
    } catch (error) {
      // Corrida de dois pedidos com o mesmo e-mail: o indice unico parcial (1 pedido aberto por e-mail) barra o segundo,
      // que recebe a MESMA resposta. Nada do erro (que poderia citar valores) vai para o log.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return accepted;
      this.logger.error(`Falha ao gravar pedido de adesão (${error instanceof Prisma.PrismaClientKnownRequestError ? error.code : 'erro'}).`);
      throw error;
    }
    if (verify) this.sendVerifyInBackground(email, link.token);
    else this.notifyTeamInBackground();
    return accepted;
  }

  /** true = nao gravar (e-mail com conta, pedido em aberto ou teto de 3 pedidos em 30 dias). */
  private async mustDropSilently(email: string, now: Date): Promise<boolean> {
    const [existingUser] = await findUserIdsByEmail(this.prisma, email, 1);
    if (existingUser !== undefined) return true;
    const [open, recent] = await Promise.all([
      this.prisma.groupApplication.count({ where: { email, status: { in: OPEN_STATUSES } } }),
      this.prisma.groupApplication.count({ where: { email, createdAt: { gte: perEmailWindowStart(now) } } }),
    ]);
    return open > 0 || recent >= MAX_APPLICATIONS_PER_EMAIL;
  }

  async publicStatus(token: string): Promise<PublicApplicationStatus> {
    if (!isWellFormedStatusToken(token)) throw new NotFoundException(APPLICATION_NOT_FOUND);
    const app = await this.prisma.groupApplication.findUnique({
      where: { statusTokenHash: hashPasswordToken(token) },
      select: {
        status: true,
        groupName: true,
        createdAt: true,
        decidedAt: true,
        rejectionReason: true,
        emailVerification: true,
        verifySentAt: true,
        verifySentCount: true,
      },
    });
    if (!app) throw new NotFoundException(APPLICATION_NOT_FOUND);
    return toPublicStatus(app, process.env, { mailEnabled: this.mail.isEnabled() });
  }

  /**
   * Confirma o e-mail pelo token do LINK (POST: scanners de e-mail que abrem links nao consomem o token). UPDATE
   * condicional e atomico (token certo + UNVERIFIED + nao vencido): UNVERIFIED -> PENDING, VERIFIED, hash do link apagado
   * (reusar o mesmo link = 404). Mal formado/inexistente/vencido/ja usado = o MESMO 404. Dispara o aviso a equipe.
   */
  async confirmEmail(token: string): Promise<{ status: 'PENDING' }> {
    if (!isWellFormedStatusToken(token)) throw new NotFoundException(CONFIRM_LINK_INVALID);
    const now = new Date();
    const { count } = await this.prisma.groupApplication.updateMany({
      where: { verifyTokenHash: hashPasswordToken(token), status: GroupApplicationStatus.UNVERIFIED, verifyExpiresAt: { gt: now } },
      data: {
        status: GroupApplicationStatus.PENDING,
        emailVerification: EmailVerification.VERIFIED,
        emailVerifiedAt: now,
        verifyTokenHash: null,
        verifyExpiresAt: null,
      },
    });
    if (count !== 1) throw new NotFoundException(CONFIRM_LINK_INVALID);
    this.notifyTeamInBackground();
    return { status: GroupApplicationStatus.PENDING };
  }

  /**
   * Reenvia o link (token de ACOMPANHAMENTO no path). So UNVERIFIED; no maximo 3 envios por pedido (contando o primeiro)
   * e 1 a cada 5 minutos (senao 429 em portugues). Gera um token NOVO e invalida o anterior. Token desconhecido/mal
   * formado, pedido em outro estado ou e-mail desligado = a MESMA resposta neutra (204), sem revelar nada.
   */
  async resendVerification(statusToken: string): Promise<void> {
    if (!isWellFormedStatusToken(statusToken) || !this.mail.isEnabled()) return;
    const app = await this.prisma.groupApplication.findUnique({
      where: { statusTokenHash: hashPasswordToken(statusToken) },
      select: { id: true, status: true, email: true, verifySentAt: true, verifySentCount: true },
    });
    if (!app || app.status !== GroupApplicationStatus.UNVERIFIED) return;
    const now = new Date();
    this.assertCanResend(app, now);

    const link = generatePasswordToken();
    // Condicional e atomico: dois reenvios simultaneos = so um passa (o outro cai no cooldown abaixo).
    const { count } = await this.prisma.groupApplication.updateMany({
      where: {
        id: app.id,
        status: GroupApplicationStatus.UNVERIFIED,
        verifySentCount: { lt: MAX_VERIFY_SENDS },
        OR: [{ verifySentAt: null }, { verifySentAt: { lte: resendCooldownStart(now) } }],
      },
      data: {
        verifyTokenHash: link.tokenHash,
        verifyExpiresAt: verifyExpiresAt(now),
        verifySentAt: now,
        verifySentCount: { increment: 1 },
      },
    });
    if (count !== 1) {
      const current = await this.prisma.groupApplication.findUnique({
        where: { id: app.id },
        select: { status: true, verifySentAt: true, verifySentCount: true },
      });
      if (!current || current.status !== GroupApplicationStatus.UNVERIFIED) return;
      this.assertCanResend(current, now);
      throw tooMany('RESEND_COOLDOWN', `Aguarde ${VERIFY_RESEND_COOLDOWN_MINUTES} minutos para pedir um novo e-mail de confirmação.`);
    }
    this.sendVerifyInBackground(app.email, link.token);
  }

  private assertCanResend(app: { verifySentAt: Date | null; verifySentCount: number }, now: Date): void {
    const block = resendBlock(app, now);
    if (block === 'LIMIT') {
      throw tooMany(
        'RESEND_LIMIT',
        `Este pedido já recebeu o máximo de ${MAX_VERIFY_SENDS} e-mails de confirmação. Confira a caixa de spam ou faça um novo pedido depois que este vencer.`,
      );
    }
    if (block === 'COOLDOWN') {
      throw tooMany('RESEND_COOLDOWN', `Aguarde ${VERIFY_RESEND_COOLDOWN_MINUTES} minutos para pedir um novo e-mail de confirmação.`);
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // E-mails em segundo plano (a resposta HTTP nunca espera o SMTP; falha de envio nunca muda a resposta)
  // -------------------------------------------------------------------------------------------------------------

  /** Pendencias de envio (so para os testes e o encerramento esperarem; nada depende disto em producao). */
  private readonly inFlight = new Set<Promise<unknown>>();

  /** Espera os envios em segundo plano ja disparados (testes). */
  async settleBackground(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.allSettled([...this.inFlight]);
  }

  private background(label: string, task: () => Promise<unknown>): void {
    const run = new Promise<void>((resolve) => setImmediate(resolve))
      .then(task)
      .catch(() => this.logger.warn(`Falha em tarefa de segundo plano da adesão (${label}).`));
    this.inFlight.add(run);
    void run.finally(() => this.inFlight.delete(run));
  }

  private sendVerifyInBackground(to: string, verifyToken: string): void {
    this.background('verify', () =>
      this.mail.sendGroupApplicationVerify({ to, link: painelConfirmUrl(verifyToken), expiresInHours: VERIFY_TOKEN_TTL_HOURS }),
    );
  }

  private notifyTeamInBackground(): void {
    this.background('team-notice', () => this.notifyTeam());
  }

  /**
   * Aviso a equipe (docs/CONTRATO_ADESAO_GRUPOS_EMAIL.md 2): texto fixo, sem dado do solicitante. Agrupado: no maximo 1 a
   * cada 10 min, "reservado" de forma ATOMICA numa linha de PlatformSetting (2 confirmacoes simultaneas = 1 aviso).
   * Destinatarios: GROUP_APPLICATIONS_NOTIFY_EMAILS ou, vazia, os super admins PLATFORM ativos. Best effort.
   */
  async notifyTeam(now: Date = new Date()): Promise<{ sent: number; skipped: 'mail-off' | 'window' | 'no-recipients' | null }> {
    if (!this.mail.isEnabled()) return { sent: 0, skipped: 'mail-off' };
    const recipients = await this.teamRecipients();
    if (recipients.length === 0) return { sent: 0, skipped: 'no-recipients' };
    if (!(await this.claimTeamNotifyWindow(now))) return { sent: 0, skipped: 'window' };
    const link = adminApplicationsUrl();
    let sent = 0;
    for (const to of recipients) {
      if (await this.mail.sendGroupApplicationTeamNotice({ to, link })) sent += 1;
    }
    return { sent, skipped: null };
  }

  private async teamRecipients(): Promise<string[]> {
    const fromEnv = parseNotifyEmails();
    if (fromEnv.length > 0) return fromEnv;
    const admins = await this.prisma.user.findMany({
      where: { userType: UserType.PLATFORM, isSuperAdmin: true, status: 'ACTIVE' },
      select: { email: true },
      orderBy: { id: 'asc' },
    });
    return [...new Set(admins.map((a) => a.email.toLowerCase()))];
  }

  /**
   * true = esta chamada "ganhou" a janela (gravou now como ultimo aviso). INSERT ... ON CONFLICT DO UPDATE ... WHERE o
   * ultimo aviso e mais antigo que 10 min (ou o valor nao e uma data ISO): atomico no Postgres, sem tabela nova.
   */
  private async claimTeamNotifyWindow(now: Date): Promise<boolean> {
    const value = JSON.stringify(now.toISOString());
    const cutoff = teamNotifyWindowStart(now).toISOString();
    const rows = await this.prisma.$queryRaw<Array<{ id: number }>>(Prisma.sql`
      INSERT INTO "PlatformSetting" ("key", "value", "isSecret", "updatedAt", "createdAt")
      VALUES (${TEAM_NOTIFY_SETTING_KEY}, ${value}::jsonb, false, now(), now())
      ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = now()
      WHERE CASE
        WHEN ("PlatformSetting"."value" #>> '{}') ~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?Z$'
          THEN ("PlatformSetting"."value" #>> '{}')::timestamptz < ${cutoff}::timestamptz
        ELSE true
      END
      RETURNING "id"`);
    return rows.length === 1;
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
        emailVerification: true,
      },
    });
    if (!app) throw new NotFoundException(ADMIN_NOT_FOUND);
    // Aprovar exige o e-mail confirmado (VERIFIED) ou a confirmacao dispensada por e-mail desligado (SKIPPED).
    if (app.status === GroupApplicationStatus.UNVERIFIED) throw emailNotVerified();
    if (app.status !== GroupApplicationStatus.PENDING || !app.passwordHash) throw notPending();
    if (!APPROVABLE_VERIFICATION.includes(app.emailVerification)) throw emailNotVerified();

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
              where: { id, status: GroupApplicationStatus.PENDING, emailVerification: { in: APPROVABLE_VERIFICATION } },
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
