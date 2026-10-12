// Grupo DEMO do GingApp (idempotente, SEM tocar em nenhum outro grupo).
//
// Cria (ou completa) uma conta de grupo de demonstração com dados realistas: 3 unidades,
// 1 mestre + 3 professores, 30 alunos (crianças e adolescentes com responsável, adultos, alguns
// inativos), 4 contas de aluno/responsável que podem logar, sistema de graduação com 8 cordas e o
// histórico de graduações, 6 turmas, aulas/frequência, financeiro, eventos, rodas, comunicados,
// notificações, certificados e passaportes públicos.
//
// COMO RODA
//   - Produção (Easypanel): o CMD do stage "server" do Dockerfile roda `ts-node prisma/demo.ts` depois
//     do bootstrap SÓ quando DEMO_GROUP=true. Exige DEMO_PASSWORD (mesma política de senha do super
//     admin, bootstrap.ts#passwordProblems). Falha aqui NÃO impede a API de subir (o demo é opcional).
//   - Local: `npm run seed:demo` (sem DEMO_PASSWORD e fora de produção usa a senha padrão de dev).
//
// GARANTIAS
//   - Idempotente: cada entidade tem uma chave natural (e-mail, slug, nome, aluno+corda, turma+data,
//     aluno+mês...). Rodar de novo só cria o que falta; nada é duplicado e nada existente é alterado
//     (exceções, todas dentro do grupo demo: a senha das contas demo acompanha DEMO_PASSWORD e o fim do
//     período da assinatura é renovado se estiver perto de vencer).
//   - Isolamento: toda escrita é escopada ao organizationId do grupo demo. Antes de escrever, recusa o
//     slug se ele já pertencer a outro grupo e recusa e-mails demo que já tenham vínculo com outro grupo.
//     Únicas tabelas compartilhadas tocadas: Plan (upsert do PROFISSIONAL só se não existir), RolePermission
//     (só linhas ausentes, como o bootstrap), State/City/Community (só se não existirem).
//   - Datas SEMPRE relativas ao momento da execução ("hoje" = dia civil de São Paulo). Aulas, cobranças
//     e eventos seguem uma janela deslizante: rodar de novo meses depois acrescenta as aulas/mensalidades/
//     eventos novos e mantém o histórico (o demo não "envelhece").
//   - Transacional por bloco (uma transação por etapa, serializadas por advisory lock do Postgres).
//   - Desligar DEMO_GROUP NÃO apaga nada.
//   - A senha nunca é logada; mensagens de erro do Prisma passam por redact().

import {
  FinancialStatus,
  OrganizationType,
  OrgRole,
  ParticipantStatus,
  Prisma,
  PrismaClient,
  RecordStatus,
  StudentStatus,
  SubscriptionStatus,
  UserType,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { BCRYPT_ROUNDS } from '../src/shared/security/password-policy';
import { findUserIdsByEmail } from '../src/shared/security/email-lookup';
import { passwordProblems } from './bootstrap';
import { buildPermissionMatrix } from './permission-matrix';
import {
  ACCOUNTS,
  AccountKey,
  CITIES,
  CLASSES,
  ClassKey,
  COMMUNITY,
  DEMO_IMAGE_URL,
  DEMO_LOCATION_COORDINATES,
  GRADUATION_SYSTEM,
  LEVELS,
  MONTH_NAMES,
  STATES,
  STUDENTS,
  StudentSpec,
  UNITS,
  UnitKey,
} from './demo-data';

// ---------------------------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------------------------

export const DEMO_DEFAULT_SLUG = 'demo';
export const DEMO_DEFAULT_ORG_NAME = 'Grupo Axé Demo';
export const DEMO_DEFAULT_EMAIL_DOMAIN = 'demo.gingapp.com.br';
/** Senha padrão SÓ para desenvolvimento local (fora de NODE_ENV=production). Em produção a senha é obrigatória. */
export const DEMO_DEV_PASSWORD = 'Demo@Capoeira2026!';
/** Chave do pg_advisory_xact_lock que serializa execuções concorrentes (bootstrap usa 4_270_001). */
const DEMO_LOCK_KEY = 4_270_002;
const PLAN_CODE = 'PROFISSIONAL';
const DAY = 86_400_000;
/** Janela de aulas: últimos ~2 meses e próximas 2 semanas. */
const LESSON_DAYS_BACK = 60;
const LESSON_DAYS_AHEAD = 14;
/** Dia de vencimento das mensalidades. */
const FEE_DUE_DAY = 15;
/** Perfil institucional do grupo demo (texto livre, fictício; sem site nem redes sociais de propósito). */
const ORG_PROFILE = {
  description: 'Grupo de capoeira de demonstração do GingApp: ginga, musicalidade e cultura afro-brasileira para todas as idades.',
  history:
    'O Grupo Axé Demo é um grupo fictício, criado para apresentar o GingApp. Nasceu em Goiânia, com aulas para crianças, adolescentes e adultos, e hoje mantém a Matriz e duas filiais (Anápolis e Brasília), com batizado e troca de cordas duas vezes por ano.',
  foundedYear: 2008,
  city: 'Goiânia',
  state: 'GO',
};

export class DemoConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DemoConfigError';
  }
}

export interface DemoLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

const consoleLogger: DemoLogger = {
  info: (m) => console.log(`[demo] ${m}`),
  warn: (m) => console.warn(`[demo] AVISO: ${m}`),
  error: (m) => console.error(`[demo] ERRO: ${m}`),
};

export interface DemoOptions {
  password: string;
  slug?: string;
  orgName?: string;
  emailDomain?: string;
  /** Instante de referência (testes). Padrão: agora. */
  now?: Date;
}

export interface DemoResult {
  organizationId: number;
  slug: string;
  emailDomain: string;
  /** E-mails das contas de login criadas/mantidas. */
  accounts: string[];
  /** Registros CRIADOS nesta execução, por entidade (tudo zero = nada a fazer). */
  created: Record<string, number>;
  /** Total por entidade no grupo demo depois da execução. */
  counts: Record<string, number>;
}

type Env = Record<string, string | undefined>;
type Tx = Prisma.TransactionClient;

/** E-mail de login de uma conta demo. */
export function demoEmail(local: string, emailDomain: string = DEMO_DEFAULT_EMAIL_DOMAIN): string {
  return `${local}@${emailDomain}`;
}

/**
 * Valida a senha do demo com a política do super admin (SSOT: bootstrap.ts#passwordProblems), contra
 * TODOS os e-mails demo (a regra "não conter o próprio e-mail" olha a parte local de cada um).
 * Lança DemoConfigError (mensagem sem a senha) antes de qualquer escrita.
 */
export function validateDemoPassword(password: string, emailDomain: string = DEMO_DEFAULT_EMAIL_DOMAIN): void {
  if (!password || password.trim() === '') {
    throw new DemoConfigError('DEMO_PASSWORD é obrigatória quando o grupo demo está ligado (DEMO_GROUP=true).');
  }
  const problems = new Set<string>();
  for (const account of ACCOUNTS) {
    for (const problem of passwordProblems(password, demoEmail(account.local, emailDomain))) problems.add(problem);
  }
  if (problems.size > 0) {
    throw new DemoConfigError(`DEMO_PASSWORD recusada: ${[...problems].join('; ')}.`);
  }
}

/**
 * Senha do demo a partir do ambiente. Ausente: em produção é erro; fora dela usa a senha de dev.
 * Em qualquer caso valida com a política do super admin.
 */
export function resolveDemoPassword(env: Env, emailDomain: string = DEMO_DEFAULT_EMAIL_DOMAIN): string {
  const raw = env.DEMO_PASSWORD ?? '';
  let password = raw;
  if (raw.trim() === '') {
    if (env.NODE_ENV === 'production') {
      throw new DemoConfigError(
        'DEMO_PASSWORD é obrigatória em produção quando DEMO_GROUP=true: defina uma senha forte (12+ caracteres, 3 de 4 classes, sem termos como "senha"/"admin"/"gingapp").',
      );
    }
    password = DEMO_DEV_PASSWORD;
  }
  validateDemoPassword(password, emailDomain);
  return password;
}

// ---------------------------------------------------------------------------------------------
// Utilidades puras (datas relativas, pseudo-aleatório determinístico)
// ---------------------------------------------------------------------------------------------

/** "Hoje" como data civil de São Paulo, representada como meia-noite UTC do dia (igual ao produto). */
export function civilToday(now: Date): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return new Date(`${ymd}T00:00:00.000Z`);
}

const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * DAY);
const isoDay = (d: Date): string => d.toISOString().slice(0, 10);
const monthLabel = (d: Date): string => `${MONTH_NAMES[d.getUTCMonth()]}/${d.getUTCFullYear()}`;
const monthStart = (today: Date, offset: number): Date =>
  new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + offset, 1));
const dayOf = (ms: Date, day: number): Date => new Date(Date.UTC(ms.getUTCFullYear(), ms.getUTCMonth(), day));

/** Primeiro sábado em ou depois de `d`. */
function saturdayOnOrAfter(d: Date): Date {
  return addDays(d, (6 - d.getUTCDay() + 7) % 7);
}

/** Último sábado do mês (monthIdx 0..11). */
function lastSaturday(year: number, monthIdx: number): Date {
  const d = new Date(Date.UTC(year, monthIdx + 1, 0));
  while (d.getUTCDay() !== 6) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

/** Número em [0,1) determinístico a partir das partes (FNV-1a + mistura final). */
function hash01(...parts: Array<string | number>): number {
  const s = parts.join('|');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Batizados em calendário fixo (último sábado de junho e de novembro): `past` do mais recente ao mais antigo; `next` o próximo (>= hoje). */
export function batizadoCalendar(today: Date): { past: Date[]; next: Date } {
  const all: Date[] = [];
  const year = today.getUTCFullYear();
  for (let y = year + 1; y >= year - 7; y--) {
    all.push(lastSaturday(y, 10), lastSaturday(y, 5));
  }
  all.sort((a, b) => b.getTime() - a.getTime());
  const past = all.filter((d) => d < today);
  const next = all.filter((d) => d >= today).pop() as Date;
  return { past, next };
}

// ---------------------------------------------------------------------------------------------
// Planejamento do elenco (puro, sem banco)
// ---------------------------------------------------------------------------------------------

interface RosterEntry {
  spec: StudentSpec;
  birthDate: Date;
  joinedAt: Date;
  /** Quando saiu/foi suspenso (status != ACTIVE). */
  leftAt: Date | null;
  /** order da corda -> data da graduação. */
  graduations: Array<{ order: number; date: Date; note: string }>;
  id?: number;
}

export function planRoster(today: Date): RosterEntry[] {
  const { past } = batizadoCalendar(today);
  return STUDENTS.map((spec) => {
    const birthDate = new Date(
      Math.floor((today.getTime() - Math.round((spec.age + hash01(spec.key, 'bd') * 0.8) * 365.25 * DAY)) / DAY) * DAY,
    );

    const graduations: RosterEntry['graduations'] = [];
    const base = spec.lastBatizado ?? 0;
    const extraDate = spec.extraordinaryDaysAgo !== undefined ? addDays(today, -spec.extraordinaryDaysAgo) : null;
    const useExtra = !!extraDate && past[0] < extraDate; // só se vier DEPOIS do último batizado
    for (let order = spec.level; order >= 1; order--) {
      if (useExtra && order === spec.level) {
        graduations.push({ order, date: extraDate as Date, note: 'Troca de corda extraordinária (avaliação do mestre)' });
      } else {
        const idx = useExtra ? base + (spec.level - 1 - order) : base + (spec.level - order);
        const date = past[idx];
        graduations.push({
          order,
          date,
          note: order === 1 ? `Primeira corda — Batizado de ${monthLabel(date)}` : `Batizado e Troca de Cordas — ${monthLabel(date)}`,
        });
      }
    }
    graduations.reverse(); // do primeiro nível para o mais recente

    const joinedAt =
      spec.level >= 1 ? addDays(graduations[0].date, -40) : addDays(today, -(spec.joinedDaysAgo ?? 10));
    const leftAt = spec.leftDaysAgo !== undefined ? addDays(today, -spec.leftDaysAgo) : null;
    return { spec, birthDate, joinedAt, leftAt, graduations };
  });
}

// ---------------------------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------------------------

interface Ctx {
  prisma: PrismaClient;
  log: DemoLogger;
  slug: string;
  orgName: string;
  emailDomain: string;
  password: string;
  now: Date;
  today: Date;
  secrets: string[];
  created: Record<string, number>;
  orgId: number;
  unitIds: Partial<Record<UnitKey, number>>;
  userIds: Partial<Record<AccountKey, number>>;
  levelIds: Map<number, number>;
  roster: RosterEntry[];
  classIds: Partial<Record<ClassKey, number>>;
  guardianIds: Map<string, number>; // `${studentKey}` -> StudentGuardian.id
  stateIds: Map<string, number>;
  cityIds: Map<string, number>;
  communityId: number | null;
}

const uid = (ctx: Ctx, key: AccountKey): number => ctx.userIds[key] as number;
const unitId = (ctx: Ctx, key: UnitKey): number => ctx.unitIds[key] as number;
const classId = (ctx: Ctx, key: ClassKey): number => ctx.classIds[key] as number;

function bump(ctx: Ctx, entity: string, n: number): void {
  if (n > 0) ctx.created[entity] = (ctx.created[entity] ?? 0) + n;
}

function redact(message: string, secrets: string[]): string {
  return secrets.filter((s) => s.length > 0).reduce((msg, s) => msg.split(s).join('[REDACTED]'), message);
}

async function block<T>(ctx: Ctx, name: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    const result = await ctx.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${DEMO_LOCK_KEY})`;
        return fn(tx);
      },
      { timeout: 120_000, maxWait: 30_000 },
    );
    ctx.log.info(`${name} (${Date.now() - started} ms)`);
    return result;
  } catch (error) {
    if (error instanceof DemoConfigError) throw error;
    // O Prisma pode ecoar os argumentos da query (inclusive passwordHash): só a 1a linha útil, sem segredos.
    const err = error as Error & { code?: string };
    const firstLine =
      redact(String(err?.message ?? err), ctx.secrets)
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.length > 0) ?? 'erro desconhecido';
    const clean = new Error(`Etapa "${name}" falhou${err?.code ? ` (${err.code})` : ''}: ${firstLine}`);
    (clean as Error & { code?: string }).code = err?.code;
    throw clean;
  }
}

export async function runDemo(
  prisma: PrismaClient,
  options: DemoOptions,
  log: DemoLogger = consoleLogger,
): Promise<DemoResult> {
  const slug = options.slug ?? DEMO_DEFAULT_SLUG;
  const orgName = options.orgName ?? DEMO_DEFAULT_ORG_NAME;
  const emailDomain = options.emailDomain ?? DEMO_DEFAULT_EMAIL_DOMAIN;
  if (!/^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$/.test(slug)) {
    throw new DemoConfigError(`Slug do grupo demo inválido: "${slug}".`);
  }
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(emailDomain)) {
    throw new DemoConfigError(`Domínio de e-mail do demo inválido: "${emailDomain}".`);
  }
  validateDemoPassword(options.password, emailDomain); // lança ANTES de qualquer escrita

  const now = options.now ?? new Date();
  const today = civilToday(now);
  const ctx: Ctx = {
    prisma,
    log,
    slug,
    orgName,
    emailDomain,
    password: options.password,
    now,
    today,
    secrets: [options.password],
    created: {},
    orgId: 0,
    unitIds: {},
    userIds: {},
    levelIds: new Map(),
    roster: planRoster(today),
    classIds: {},
    guardianIds: new Map(),
    stateIds: new Map(),
    cityIds: new Map(),
    communityId: null,
  };

  log.info(`Grupo demo "${slug}" — referência: hoje = ${isoDay(today)} (America/Sao_Paulo).`);

  await stepOrganization(ctx);
  await stepAccounts(ctx);
  await stepUnitsAndReferences(ctx);
  await stepGraduationSystem(ctx);
  await stepStudents(ctx);
  await stepClasses(ctx);
  await stepGraduations(ctx);
  await stepLessonsAndAttendance(ctx);
  await stepFinance(ctx);
  await stepEvents(ctx);
  await stepRodas(ctx);
  await stepAnnouncements(ctx);
  await stepCertificatesAndPassports(ctx);

  const counts = await countEntities(prisma, ctx.orgId);
  const accounts = ACCOUNTS.map((a) => demoEmail(a.local, emailDomain));
  const createdTotal = Object.values(ctx.created).reduce((a, b) => a + b, 0);
  log.info(
    createdTotal === 0
      ? 'Concluído: o grupo demo já estava completo (nada a criar).'
      : `Concluído: ${createdTotal} registro(s) criado(s) (${Object.entries(ctx.created)
          .map(([k, v]) => `${k}=${v}`)
          .join(', ')}).`,
  );
  log.info(
    `Contas (senha = DEMO_PASSWORD): ${accounts.join(', ')}. Login: POST /api/auth/login (organizationSlug "${slug}" só é exigido se o e-mail estiver em mais de um grupo).`,
  );
  return { organizationId: ctx.orgId, slug, emailDomain, accounts, created: ctx.created, counts };
}

export async function countEntities(prisma: PrismaClient, organizationId: number): Promise<Record<string, number>> {
  const where = { organizationId };
  const [
    units, members, students, guardians, classes, enrollments, lessons, attendances, systems, levels, graduations,
    finance, events, eventParticipants, announcements, notifications, rodas, certificates, publicProfiles, subscriptions,
  ] = await Promise.all([
    prisma.unit.count({ where }),
    prisma.organizationUser.count({ where }),
    prisma.student.count({ where }),
    prisma.studentGuardian.count({ where }),
    prisma.class.count({ where }),
    prisma.classStudent.count({ where }),
    prisma.lesson.count({ where }),
    prisma.attendance.count({ where }),
    prisma.graduationSystem.count({ where }),
    prisma.graduationLevel.count({ where }),
    prisma.studentGraduation.count({ where }),
    prisma.financialRecord.count({ where }),
    prisma.event.count({ where }),
    prisma.eventParticipant.count({ where }),
    prisma.announcement.count({ where }),
    prisma.notification.count({ where }),
    prisma.roda.count({ where }),
    prisma.certificate.count({ where }),
    prisma.publicProfile.count({ where }),
    prisma.subscription.count({ where }),
  ]);
  const rodaParticipants = await prisma.rodaParticipant.count({ where: { roda: { organizationId } } });
  return {
    units, members, students, guardians, classes, enrollments, lessons, attendances, graduationSystems: systems,
    graduationLevels: levels, graduations, finance, events, eventParticipants, announcements, notifications,
    rodas, rodaParticipants, certificates, publicProfiles, subscriptions,
  };
}

// ---------------------------------------------------------------------------------------------
// 1. Plano, matriz de permissões, organização, MESTRE e assinatura
// ---------------------------------------------------------------------------------------------

async function ensureAccountUser(
  ctx: Ctx,
  tx: Tx,
  account: (typeof ACCOUNTS)[number],
  orgId: number | null,
): Promise<number> {
  const email = demoEmail(account.local, ctx.emailDomain);
  const [existingId] = await findUserIdsByEmail(tx, email, 1);
  if (existingId === undefined) {
    const passwordHash = await bcrypt.hash(ctx.password, BCRYPT_ROUNDS);
    ctx.secrets.push(passwordHash);
    const user = await tx.user.create({
      data: {
        email,
        passwordHash,
        name: account.name,
        phone: account.phone,
        userType: UserType.MEMBER,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    bump(ctx, 'users', 1);
    return user.id;
  }

  const user = await tx.user.findUniqueOrThrow({ where: { id: existingId } });
  if (user.userType !== UserType.MEMBER) {
    throw new DemoConfigError(`O e-mail ${email} já existe como conta da plataforma; o demo não toca nela.`);
  }
  if (orgId !== null) {
    const foreign = await tx.organizationUser.count({ where: { userId: user.id, organizationId: { not: orgId } } });
    if (foreign > 0) {
      throw new DemoConfigError(`O e-mail ${email} já pertence a outro grupo; o demo não toca nele.`);
    }
  }
  // A senha das contas demo acompanha DEMO_PASSWORD (trocar a variável e reiniciar basta).
  const matches = await bcrypt.compare(ctx.password, user.passwordHash);
  if (!matches || user.status !== 'ACTIVE') {
    const passwordHash = matches ? user.passwordHash : await bcrypt.hash(ctx.password, BCRYPT_ROUNDS);
    ctx.secrets.push(passwordHash);
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash, status: 'ACTIVE', ...(matches ? {} : { tokenValidAfter: new Date(Date.now() + 1) }) },
    });
    ctx.log.info(`Conta ${email}: senha/status alinhados com DEMO_PASSWORD.`);
  }
  return user.id;
}

async function ensureMembership(ctx: Ctx, tx: Tx, orgId: number, userId: number, role: OrgRole): Promise<void> {
  const membership = await tx.organizationUser.findUnique({
    where: { organizationId_userId: { organizationId: orgId, userId } },
  });
  if (!membership) {
    await tx.organizationUser.create({ data: { organizationId: orgId, userId, role, status: 'ACTIVE' } });
    bump(ctx, 'members', 1);
  } else if (membership.role !== role || membership.status !== 'ACTIVE') {
    await tx.organizationUser.update({ where: { id: membership.id }, data: { role, status: 'ACTIVE' } });
  }
}

async function stepOrganization(ctx: Ctx): Promise<void> {
  const mestre = ACCOUNTS.find((a) => a.key === 'mestre')!;
  await block(ctx, 'plano, permissões, organização e mestre', async (tx) => {
    // Plano do catálogo (mesmos valores do seed); se já existir, nunca é alterado.
    const planBefore = await tx.plan.findUnique({ where: { code: PLAN_CODE } });
    const plan = await tx.plan.upsert({
      where: { code: PLAN_CODE },
      update: {},
      create: {
        name: 'Profissional',
        code: PLAN_CODE,
        priceCents: 9990,
        billingPeriod: 'MONTHLY',
        maxStudents: 100,
        maxUnits: 3,
        features: {},
        isActive: true,
      },
    });
    if (!planBefore) bump(ctx, 'plans', 1);
    const activeStudents = STUDENTS.filter((s) => (s.status ?? StudentStatus.ACTIVE) === StudentStatus.ACTIVE).length;
    if (plan.maxStudents !== null && plan.maxStudents < activeStudents) {
      ctx.log.warn(`O plano ${PLAN_CODE} limita ${plan.maxStudents} alunos (< ${activeStudents} do demo).`);
    }
    if (plan.maxUnits !== null && plan.maxUnits < UNITS.length) {
      ctx.log.warn(`O plano ${PLAN_CODE} limita ${plan.maxUnits} unidades (< ${UNITS.length} do demo).`);
    }

    // Matriz base de permissões: só as linhas ausentes (igual ao bootstrap).
    const existing = await tx.rolePermission.findMany({ select: { role: true, resource: true } });
    const have = new Set(existing.map((r) => `${r.role}/${r.resource}`));
    const missing = buildPermissionMatrix().filter((r) => !have.has(`${r.role}/${r.resource}`));
    if (missing.length > 0) {
      await tx.rolePermission.createMany({ data: missing, skipDuplicates: true });
      ctx.log.warn(`${missing.length} linha(s) de RolePermission ausentes foram criadas (o bootstrap deveria ter rodado antes).`);
    }

    // Organização: recusa o slug se ele já for de OUTRO grupo (marca do demo = o MESTRE demo é membro).
    const mestreEmail = demoEmail(mestre.local, ctx.emailDomain);
    let org = await tx.organization.findUnique({ where: { slug: ctx.slug } });
    if (org) {
      const [mestreId] = await findUserIdsByEmail(tx, mestreEmail, 1);
      const owned =
        mestreId !== undefined &&
        (await tx.organizationUser.count({ where: { organizationId: org.id, userId: mestreId, role: OrgRole.MESTRE } })) > 0;
      if (!owned) {
        throw new DemoConfigError(
          `O slug "${ctx.slug}" já pertence a outro grupo (sem o mestre ${mestreEmail}); o demo não toca em grupos existentes.`,
        );
      }
      if (org.status !== RecordStatus.ACTIVE) {
        ctx.log.warn(`O grupo demo "${ctx.slug}" está INACTIVE; reative-o no admin para as contas logarem (o demo não altera isso).`);
      }
      if (org.description === null) {
        // Grupo demo criado antes do perfil institucional existir: completa só o que está vazio.
        org = await tx.organization.update({ where: { id: org.id }, data: ORG_PROFILE });
      }
    } else {
      org = await tx.organization.create({
        data: {
          name: ctx.orgName,
          slug: ctx.slug,
          type: OrganizationType.GROUP,
          status: RecordStatus.ACTIVE,
          email: demoEmail('contato', ctx.emailDomain),
          phone: '(62) 99999-0100',
          ...ORG_PROFILE,
        },
      });
      bump(ctx, 'organizations', 1);
    }
    ctx.orgId = org.id;

    const mestreId = await ensureAccountUser(ctx, tx, mestre, org.id);
    ctx.userIds.mestre = mestreId;
    await ensureMembership(ctx, tx, org.id, mestreId, mestre.role);

    // Assinatura ACTIVE por 1 ano; se já existir uma aberta, só é renovada quando estiver perto de vencer.
    const open = await tx.subscription.findFirst({
      where: { organizationId: org.id, status: { in: [SubscriptionStatus.TRIALING, SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE] } },
      orderBy: { id: 'desc' },
    });
    const periodEnd = addDays(ctx.now, 365);
    if (!open) {
      const subscription = await tx.subscription.create({
        data: {
          organizationId: org.id,
          planId: plan.id,
          status: SubscriptionStatus.ACTIVE,
          startedAt: ctx.now,
          currentPeriodEnd: periodEnd,
        },
      });
      await tx.subscriptionEvent.create({
        data: { subscriptionId: subscription.id, type: 'CREATED', payload: { planCode: plan.code, status: 'ACTIVE', demo: true } },
      });
      bump(ctx, 'subscriptions', 1);
    } else if (open.status !== SubscriptionStatus.ACTIVE || !open.currentPeriodEnd || open.currentPeriodEnd < addDays(ctx.now, 300)) {
      await tx.subscription.update({ where: { id: open.id }, data: { status: SubscriptionStatus.ACTIVE, currentPeriodEnd: periodEnd } });
      await tx.subscriptionEvent.create({
        data: { subscriptionId: open.id, type: 'DEMO_RENEWED', payload: { demo: true } },
      });
    }
  });
}

// ---------------------------------------------------------------------------------------------
// 2. Contas de professores e alunos/responsável
// ---------------------------------------------------------------------------------------------

async function stepAccounts(ctx: Ctx): Promise<void> {
  await block(ctx, 'contas (professores e alunos/responsável)', async (tx) => {
    for (const account of ACCOUNTS) {
      if (account.key === 'mestre') continue;
      const userId = await ensureAccountUser(ctx, tx, account, ctx.orgId);
      ctx.userIds[account.key] = userId;
      await ensureMembership(ctx, tx, ctx.orgId, userId, account.role);
    }
  });
}

// ---------------------------------------------------------------------------------------------
// 3. Unidades, acesso dos professores e referências públicas (estado/cidade/comunidade)
// ---------------------------------------------------------------------------------------------

async function stepUnitsAndReferences(ctx: Ctx): Promise<void> {
  await block(ctx, 'unidades e referências', async (tx) => {
    for (const spec of UNITS) {
      let unit = await tx.unit.findFirst({ where: { organizationId: ctx.orgId, name: spec.name } });
      if (!unit) {
        unit = await tx.unit.create({
          data: {
            organizationId: ctx.orgId,
            name: spec.name,
            address: spec.address,
            city: spec.city,
            state: spec.state,
            isMain: spec.isMain,
            status: RecordStatus.ACTIVE,
            latitude: spec.coordinates.latitude,
            longitude: spec.coordinates.longitude,
          },
        });
        bump(ctx, 'units', 1);
      } else if (unit.latitude === null && unit.longitude === null) {
        // Mapa da comunidade: unidade criada antes das coordenadas existirem. Só preenche onde está nulo
        // (nunca sobrescreve um ponto ajustado pelo painel).
        unit = await tx.unit.update({
          where: { id: unit.id },
          data: { latitude: spec.coordinates.latitude, longitude: spec.coordinates.longitude },
        });
        bump(ctx, 'mapPoints', 1);
      }
      ctx.unitIds[spec.key] = unit.id;
    }

    for (const account of ACCOUNTS) {
      for (const unitKey of account.units ?? []) {
        const userId = uid(ctx, account.key);
        const unit = unitId(ctx, unitKey);
        const access = await tx.userUnitAccess.findUnique({ where: { userId_unitId: { userId, unitId: unit } } });
        if (!access) {
          await tx.userUnitAccess.create({ data: { organizationId: ctx.orgId, userId, unitId: unit } });
          bump(ctx, 'unitAccess', 1);
        }
      }
    }

    // Tabelas públicas compartilhadas: só cria o que ainda não existe (nunca altera).
    for (const state of STATES) {
      const row = await tx.state.upsert({ where: { uf: state.uf }, update: {}, create: { uf: state.uf, name: state.name } });
      ctx.stateIds.set(state.uf, row.id);
    }
    for (const city of CITIES) {
      const stateId = ctx.stateIds.get(city.uf) as number;
      let row = await tx.city.findFirst({ where: { stateId, name: city.name } });
      if (!row) row = await tx.city.create({ data: { stateId, name: city.name } });
      ctx.cityIds.set(city.name, row.id);
    }
    const communityStateId = ctx.stateIds.get(COMMUNITY.uf) as number;
    let community = await tx.community.findFirst({ where: { stateId: communityStateId, name: COMMUNITY.name } });
    if (!community) {
      community = await tx.community.create({
        data: { stateId: communityStateId, name: COMMUNITY.name, description: COMMUNITY.description },
      });
    }
    ctx.communityId = community.id;
  });
}

// ---------------------------------------------------------------------------------------------
// 4. Sistema de graduação
// ---------------------------------------------------------------------------------------------

async function stepGraduationSystem(ctx: Ctx): Promise<void> {
  await block(ctx, 'sistema de graduação (cordas)', async (tx) => {
    let system = await tx.graduationSystem.findFirst({
      where: { organizationId: ctx.orgId, name: GRADUATION_SYSTEM.name },
    });
    if (!system) {
      system = await tx.graduationSystem.create({
        data: { organizationId: ctx.orgId, name: GRADUATION_SYSTEM.name, description: GRADUATION_SYSTEM.description, isActive: true },
      });
      bump(ctx, 'graduationSystems', 1);
    }
    for (const level of LEVELS) {
      let row = await tx.graduationLevel.findUnique({
        where: { graduationSystemId_order: { graduationSystemId: system.id, order: level.order } },
      });
      if (!row) {
        row = await tx.graduationLevel.create({
          data: {
            organizationId: ctx.orgId,
            graduationSystemId: system.id,
            name: level.name,
            order: level.order,
            color: level.color,
          },
        });
        bump(ctx, 'graduationLevels', 1);
      }
      ctx.levelIds.set(level.order, row.id);
    }
  });
}

// ---------------------------------------------------------------------------------------------
// 5. Alunos e responsáveis
// ---------------------------------------------------------------------------------------------

const PHONE_AREA: Record<UnitKey, string> = { matriz: '62', anapolis: '62', brasilia: '61' };

/** "Fernanda Ribeiro" -> "fernanda.ribeiro" (sem acento), parte local de um e-mail fictício. */
function emailLocalPart(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
}

async function stepStudents(ctx: Ctx): Promise<void> {
  await block(ctx, 'alunos e responsáveis', async (tx) => {
    let phoneSeq = 20;
    for (const entry of ctx.roster) {
      const { spec } = entry;
      const loginUserId = spec.login ? uid(ctx, spec.login) : undefined;
      const adultOrTeen = spec.age >= 13;
      phoneSeq += 1;

      let student = loginUserId
        ? await tx.student.findFirst({ where: { organizationId: ctx.orgId, userId: loginUserId } })
        : await tx.student.findFirst({ where: { organizationId: ctx.orgId, name: spec.name } });
      if (!student) {
        student = await tx.student.create({
          data: {
            organizationId: ctx.orgId,
            unitId: unitId(ctx, spec.unit),
            userId: loginUserId,
            name: spec.name,
            birthDate: entry.birthDate,
            phone: adultOrTeen ? `(${PHONE_AREA[spec.unit]}) 99999-02${String(phoneSeq).padStart(2, '0')}` : null,
            email: spec.login
              ? demoEmail(spec.login, ctx.emailDomain)
              : adultOrTeen
                ? demoEmail(spec.key, ctx.emailDomain)
                : null,
            status: spec.status ?? StudentStatus.ACTIVE,
            joinedAt: entry.joinedAt,
          },
        });
        bump(ctx, 'students', 1);
      }
      entry.id = student.id;

      if (spec.guardian) {
        const g = spec.guardian;
        let guardian = await tx.studentGuardian.findFirst({
          where: { organizationId: ctx.orgId, studentId: student.id, name: g.name },
        });
        if (!guardian) {
          guardian = await tx.studentGuardian.create({
            data: {
              organizationId: ctx.orgId,
              studentId: student.id,
              userId: g.login ? uid(ctx, g.login) : null,
              name: g.name,
              relationship: g.relationship,
              phone: g.phone,
              email: g.login ? demoEmail(g.login, ctx.emailDomain) : demoEmail(emailLocalPart(g.name), ctx.emailDomain),
              consentPublicProfile: g.consent ?? false,
            },
          });
          bump(ctx, 'guardians', 1);
        }
        ctx.guardianIds.set(spec.key, guardian.id);
      }
    }
  });
}

// ---------------------------------------------------------------------------------------------
// 6. Turmas e matrículas
// ---------------------------------------------------------------------------------------------

async function stepClasses(ctx: Ctx): Promise<void> {
  await block(ctx, 'turmas e matrículas', async (tx) => {
    for (const spec of CLASSES) {
      let klass = await tx.class.findFirst({ where: { organizationId: ctx.orgId, name: spec.name } });
      if (!klass) {
        klass = await tx.class.create({
          data: {
            organizationId: ctx.orgId,
            unitId: unitId(ctx, spec.unit),
            name: spec.name,
            description: spec.description,
            weekday: spec.weekday,
            startTime: spec.startTime,
            endTime: spec.endTime,
            teacherUserId: uid(ctx, spec.teacher),
            status: RecordStatus.ACTIVE,
          },
        });
        bump(ctx, 'classes', 1);
      } else if (klass.teacherUserId === null) {
        // Turma do demo criada antes de existir "professor da turma": define o responsável (só se vazio).
        klass = await tx.class.update({ where: { id: klass.id }, data: { teacherUserId: uid(ctx, spec.teacher) } });
      }
      ctx.classIds[spec.key] = klass.id;
    }

    const rows: Prisma.ClassStudentCreateManyInput[] = [];
    for (const entry of ctx.roster) {
      const active = (entry.spec.status ?? StudentStatus.ACTIVE) === StudentStatus.ACTIVE;
      for (const classKey of entry.spec.classes) {
        rows.push({
          organizationId: ctx.orgId,
          classId: classId(ctx, classKey),
          studentId: entry.id as number,
          status: active ? RecordStatus.ACTIVE : RecordStatus.INACTIVE,
          enrolledAt: entry.joinedAt,
        });
      }
    }
    const { count } = await tx.classStudent.createMany({ data: rows, skipDuplicates: true });
    bump(ctx, 'enrollments', count);
  });
}

// ---------------------------------------------------------------------------------------------
// 7. Histórico de graduações
// ---------------------------------------------------------------------------------------------

async function stepGraduations(ctx: Ctx): Promise<void> {
  await block(ctx, 'histórico de graduações', async (tx) => {
    const studentIds = ctx.roster.map((e) => e.id as number);
    const existing = await tx.studentGraduation.findMany({
      where: { organizationId: ctx.orgId, studentId: { in: studentIds } },
      select: { studentId: true, graduationLevelId: true },
    });
    const have = new Set(existing.map((g) => `${g.studentId}:${g.graduationLevelId}`));
    const rows: Prisma.StudentGraduationCreateManyInput[] = [];
    for (const entry of ctx.roster) {
      for (const g of entry.graduations) {
        const levelId = ctx.levelIds.get(g.order) as number;
        if (have.has(`${entry.id}:${levelId}`)) continue;
        rows.push({
          organizationId: ctx.orgId,
          studentId: entry.id as number,
          graduationLevelId: levelId,
          graduatedAt: g.date,
          notes: g.note,
          createdAt: g.date,
        });
      }
    }
    if (rows.length > 0) {
      const { count } = await tx.studentGraduation.createMany({ data: rows });
      bump(ctx, 'graduations', count);
    }
  });
}

// ---------------------------------------------------------------------------------------------
// 8. Aulas (janela deslizante) e frequência
// ---------------------------------------------------------------------------------------------

const ABSENCE_REASONS = [
  'Atestado médico',
  'Compromisso de trabalho',
  'Viagem em família',
  'Gripe / indisposição',
  'Prova na escola',
  'Imprevisto pessoal',
];

async function stepLessonsAndAttendance(ctx: Ctx): Promise<void> {
  await block(ctx, 'aulas e frequência', async (tx) => {
    const from = addDays(ctx.today, -LESSON_DAYS_BACK);
    const to = addDays(ctx.today, LESSON_DAYS_AHEAD);

    const existing = await tx.lesson.findMany({
      where: { organizationId: ctx.orgId, date: { gte: from, lte: to } },
      select: { classId: true, date: true },
    });
    const have = new Set(existing.map((l) => `${l.classId}|${isoDay(l.date)}`));

    const rows: Prisma.LessonCreateManyInput[] = [];
    for (const spec of CLASSES) {
      const cid = classId(ctx, spec.key);
      for (let d = from; d <= to; d = addDays(d, 1)) {
        if (d.getUTCDay() !== spec.weekday || have.has(`${cid}|${isoDay(d)}`)) continue;
        const past = d < ctx.today;
        const cancelled = past && hash01('cancel', spec.key, isoDay(d)) < 0.07;
        const weekIdx = Math.floor(d.getTime() / (7 * DAY));
        const substitute = hash01('sub', spec.key, isoDay(d)) < 0.12;
        const teacher: AccountKey = substitute ? (spec.teacher === 'mestre' ? 'professor1' : 'mestre') : spec.teacher;
        rows.push({
          organizationId: ctx.orgId,
          classId: cid,
          unitId: unitId(ctx, spec.unit),
          teacherUserId: uid(ctx, teacher),
          date: d,
          startTime: spec.startTime,
          endTime: spec.endTime,
          notes: cancelled ? 'Aula cancelada — feriado / indisponibilidade do espaço' : spec.topics[weekIdx % spec.topics.length],
          status: cancelled ? RecordStatus.INACTIVE : RecordStatus.ACTIVE,
          createdAt: addDays(d, -7) < ctx.now ? addDays(d, -7) : ctx.now,
        });
      }
    }
    if (rows.length > 0) {
      const { count } = await tx.lesson.createMany({ data: rows });
      bump(ctx, 'lessons', count);
    }

    // Chamada: só nas aulas PASSADAS e ATIVAS que ainda não têm nenhuma presença registrada (a de hoje fica pendente).
    const lessons = await tx.lesson.findMany({
      where: { organizationId: ctx.orgId, date: { gte: from, lt: ctx.today }, status: RecordStatus.ACTIVE },
      select: { id: true, classId: true, date: true },
    });
    const withAttendance = new Set(
      (
        await tx.attendance.groupBy({
          by: ['lessonId'],
          where: { organizationId: ctx.orgId, lessonId: { in: lessons.map((l) => l.id) } },
        })
      ).map((r) => r.lessonId),
    );
    const classKeyById = new Map<number, ClassKey>(CLASSES.map((c) => [classId(ctx, c.key), c.key]));
    const attendance: Prisma.AttendanceCreateManyInput[] = [];
    for (const lesson of lessons) {
      if (withAttendance.has(lesson.id)) continue;
      const classKey = classKeyById.get(lesson.classId);
      if (!classKey) continue; // aula criada manualmente em outra turma do grupo: não mexe
      const day = isoDay(lesson.date);
      for (const entry of ctx.roster) {
        if (!entry.spec.classes.includes(classKey)) continue;
        if (entry.joinedAt > lesson.date) continue;
        if (entry.leftAt && lesson.date > entry.leftAt) continue;
        const present = hash01('att', day, classKey, entry.spec.key) < entry.spec.rate;
        attendance.push({
          organizationId: ctx.orgId,
          lessonId: lesson.id,
          studentId: entry.id as number,
          present,
          justification:
            !present && hash01('just', day, entry.spec.key) < 0.45
              ? ABSENCE_REASONS[Math.floor(hash01('why', day, entry.spec.key) * ABSENCE_REASONS.length)]
              : null,
          // fim da tarde/noite do dia da aula (sempre anterior a "agora": só aulas de dias passados)
          createdAt: new Date(lesson.date.getTime() + 22 * 3_600_000),
        });
      }
    }
    if (attendance.length > 0) {
      const { count } = await tx.attendance.createMany({ data: attendance, skipDuplicates: true });
      bump(ctx, 'attendances', count);
    }
  });
}

// ---------------------------------------------------------------------------------------------
// 9. Financeiro (janela deslizante por mês)
// ---------------------------------------------------------------------------------------------

async function stepFinance(ctx: Ctx): Promise<void> {
  await block(ctx, 'financeiro', async (tx) => {
    const { today } = ctx;
    // Chaves naturais: mensalidade/taxa/despesa fixa = aluno+tipo+descrição(com mês)+vencimento; itens
    // avulsos (uniforme, despesas variáveis), cujo vencimento é "N dias atrás", = aluno+tipo+descrição
    // (sem a data, para um rerun em outro dia não duplicar).
    const existing = await tx.financialRecord.findMany({
      where: { organizationId: ctx.orgId },
      select: { studentId: true, type: true, description: true, dueDate: true },
    });
    const have = new Set(existing.map((r) => `${r.studentId ?? 0}|${r.type ?? ''}|${r.description}|${isoDay(r.dueDate)}`));
    const haveUndated = new Set(existing.map((r) => `${r.studentId ?? 0}|${r.type ?? ''}|${r.description}`));
    const rows: Prisma.FinancialRecordCreateManyInput[] = [];
    const add = (row: Omit<Prisma.FinancialRecordCreateManyInput, 'organizationId'>, undated = false) => {
      const base = `${row.studentId ?? 0}|${row.type ?? ''}|${row.description}`;
      const key = undated ? base : `${base}|${isoDay(row.dueDate as Date)}`;
      if (undated ? haveUndated.has(base) : have.has(key)) return;
      have.add(`${base}|${isoDay(row.dueDate as Date)}`);
      haveUndated.add(base);
      rows.push({ organizationId: ctx.orgId, ...row });
    };
    const paidAtOf = (due: Date, spreadKey: string, minAt: Date): Date => {
      const base = new Date(due.getTime() + (Math.floor(hash01('pd', spreadKey) * 12) - 6) * DAY + 15 * 3_600_000);
      const cap = new Date(addDays(today, -1).getTime() + 15 * 3_600_000);
      const bounded = base > cap ? cap : base;
      return bounded < minAt ? new Date(minAt.getTime() + 15 * 3_600_000) : bounded;
    };

    // Mensalidades dos últimos 3 meses + mês corrente.
    for (const offset of [-3, -2, -1, 0]) {
      const ms = monthStart(today, offset);
      const due = dayOf(ms, FEE_DUE_DAY);
      const description = `Mensalidade ${MONTH_NAMES[ms.getUTCMonth()]}/${ms.getUTCFullYear()}`;
      for (const entry of ctx.roster) {
        const { spec } = entry;
        if (entry.joinedAt > due) continue;
        const base = {
          studentId: entry.id as number,
          unitId: unitId(ctx, spec.unit),
          description,
          amountCents: spec.fee,
          type: 'MENSALIDADE',
          dueDate: due,
          createdAt: ms < entry.joinedAt ? entry.joinedAt : ms,
        };
        if (entry.leftAt && due > entry.leftAt) {
          if (due.getTime() - entry.leftAt.getTime() < 45 * DAY) add({ ...base, status: FinancialStatus.CANCELLED });
          continue;
        }
        const r = hash01('fee', description, spec.key);
        if (offset === -1 && spec.overdue) {
          add({ ...base, status: FinancialStatus.OVERDUE });
        } else if (offset === 0) {
          const paid = due >= today ? r < 0.35 : r < 0.85;
          if (paid) {
            const early = addDays(today, -(1 + Math.floor(hash01('early', description, spec.key) * 4)));
            const at = early < ms ? ms : early;
            add({ ...base, status: FinancialStatus.PAID, paidAt: new Date((at < entry.joinedAt ? entry.joinedAt : at).getTime() + 15 * 3_600_000) });
          } else {
            add({ ...base, status: FinancialStatus.PENDING });
          }
        } else {
          add({ ...base, status: FinancialStatus.PAID, paidAt: paidAtOf(due, `${description}|${spec.key}`, entry.joinedAt) });
        }
      }
    }

    // Taxa do próximo batizado (quando estiver a até 90 dias).
    const { next } = batizadoCalendar(today);
    if (next.getTime() - today.getTime() <= 90 * DAY) {
      const taxaDue = addDays(next, -7);
      const description = `Taxa de batizado — ${monthLabel(next)}`;
      for (const entry of ctx.roster) {
        if ((entry.spec.status ?? StudentStatus.ACTIVE) !== StudentStatus.ACTIVE) continue;
        if (entry.joinedAt > addDays(today, -30) || hash01('taxa', entry.spec.key) > 0.6) continue;
        const paid = hash01('taxa-paid', entry.spec.key) < 0.5;
        add({
          studentId: entry.id as number,
          unitId: unitId(ctx, entry.spec.unit),
          description,
          amountCents: entry.spec.age < 13 ? 6000 : 9000,
          type: 'TAXA',
          dueDate: taxaDue,
          status: paid ? FinancialStatus.PAID : FinancialStatus.PENDING,
          paidAt: paid ? new Date(addDays(today, -(1 + Math.floor(hash01('taxa-at', entry.spec.key) * 5))).getTime() + 15 * 3_600_000) : null,
        });
      }
    }

    // Uniformes.
    const uniform = ['davi', 'helena', 'lucas', 'carolina', 'amanda'];
    uniform.forEach((key, i) => {
      const entry = ctx.roster.find((e) => e.spec.key === key);
      if (!entry) return;
      const pending = key === 'carolina';
      const due = pending ? addDays(today, 6) : addDays(today, -(10 + i * 6));
      add({
        studentId: entry.id as number,
        unitId: unitId(ctx, entry.spec.unit),
        description: 'Uniforme (calça de abadá e camiseta)',
        amountCents: 12000,
        type: 'UNIFORME',
        dueDate: due,
        status: pending ? FinancialStatus.PENDING : FinancialStatus.PAID,
        paidAt: pending ? null : new Date(due.getTime() + 15 * 3_600_000),
      }, true);
    });

    // Despesas do grupo (sempre já vencidas e pagas: não inflam o "a receber").
    const fixed: Array<{ label: string; unit: UnitKey; day: number; cents: number }> = [
      { label: 'Aluguel do espaço — Matriz', unit: 'matriz', day: 5, cents: 180000 },
      { label: 'Aluguel do espaço — Anápolis', unit: 'anapolis', day: 5, cents: 90000 },
      { label: 'Aluguel do espaço — Brasília', unit: 'brasilia', day: 5, cents: 80000 },
      { label: 'Energia e água — Matriz', unit: 'matriz', day: 20, cents: 32000 },
    ];
    for (const offset of [-3, -2, -1, 0]) {
      const ms = monthStart(today, offset);
      for (const item of fixed) {
        const due = dayOf(ms, item.day);
        if (due > today) continue;
        add({
          unitId: unitId(ctx, item.unit),
          description: `${item.label} (${MONTH_NAMES[ms.getUTCMonth()]}/${ms.getUTCFullYear()})`,
          amountCents: item.cents,
          type: 'DESPESA',
          dueDate: due,
          status: FinancialStatus.PAID,
          paidAt: new Date(due.getTime() + 13 * 3_600_000),
        });
      }
    }
    const variable: Array<{ label: string; unit: UnitKey; daysAgo: number; cents: number }> = [
      { label: 'Compra de cordas e instrumentos (lote)', unit: 'matriz', daysAgo: 52, cents: 54000 },
      { label: 'Manutenção de berimbaus e atabaques', unit: 'matriz', daysAgo: 21, cents: 28000 },
      { label: 'Camisetas do grupo (lote de 40)', unit: 'anapolis', daysAgo: 33, cents: 120000 },
    ];
    for (const item of variable) {
      const due = addDays(today, -item.daysAgo);
      add({
        unitId: unitId(ctx, item.unit),
        description: item.label,
        amountCents: item.cents,
        type: 'DESPESA',
        dueDate: due,
        status: FinancialStatus.PAID,
        paidAt: new Date(due.getTime() + 13 * 3_600_000),
      }, true);
    }

    if (rows.length > 0) {
      const { count } = await tx.financialRecord.createMany({ data: rows });
      bump(ctx, 'finance', count);
    }
  });
}

// ---------------------------------------------------------------------------------------------
// 10. Eventos e participantes
// ---------------------------------------------------------------------------------------------

type PartPlan = { studentKey?: string; guestName?: string; status: ParticipantStatus };

interface EventPlan {
  title: string;
  type: string;
  description: string;
  date: Date;
  location: string;
  unit: UnitKey;
  city: string;
  isPublic: boolean;
  image: boolean;
  participants: PartPlan[];
}

/** Escolhe n alunos elegíveis (ordem determinística pela chave). */
function pickStudents(ctx: Ctx, date: Date, n: number, seed: string, filter?: (e: RosterEntry) => boolean): RosterEntry[] {
  return ctx.roster
    .filter((e) => e.joinedAt <= date && !(e.leftAt && e.leftAt < date) && (!filter || filter(e)))
    .sort((a, b) => hash01(seed, a.spec.key) - hash01(seed, b.spec.key))
    .slice(0, n);
}

function buildEventPlans(ctx: Ctx): EventPlan[] {
  const { today } = ctx;
  const { past, next } = batizadoCalendar(today);
  const plans: EventPlan[] = [];
  const spread = (entries: RosterEntry[], seed: string, statuses: Array<[ParticipantStatus, number]>): PartPlan[] =>
    entries.map((e) => {
      const r = hash01(seed, e.spec.key);
      let acc = 0;
      let status = statuses[statuses.length - 1][0];
      for (const [s, p] of statuses) {
        acc += p;
        if (r < acc) {
          status = s;
          break;
        }
      }
      return { studentKey: e.spec.key, status };
    });

  // Último batizado (se foi nos últimos ~200 dias): participam os graduados nele + outros alunos.
  const lastBatizado = past[0];
  if (today.getTime() - lastBatizado.getTime() <= 200 * DAY) {
    const graduated = ctx.roster.filter((e) => e.graduations.some((g) => isoDay(g.date) === isoDay(lastBatizado)));
    const others = pickStudents(ctx, lastBatizado, 6, 'bat-others', (e) => !graduated.includes(e));
    plans.push({
      title: `Batizado e Troca de Cordas — ${monthLabel(lastBatizado)}`,
      type: 'BATIZADO',
      description: 'Cerimônia de batizado e troca de cordas do grupo, com roda de encerramento aberta ao público.',
      date: lastBatizado,
      location: 'Ginásio Poliesportivo do Setor Central, Goiânia',
      unit: 'matriz',
      city: 'Goiânia',
      isPublic: true,
      image: true,
      participants: [
        ...graduated.map((e) => ({ studentKey: e.spec.key, status: ParticipantStatus.ATTENDED })),
        ...spread(others, 'bat-others-st', [[ParticipantStatus.ATTENDED, 0.8], [ParticipantStatus.CANCELLED, 0.2]]),
        { guestName: 'Contramestre Sandra (Grupo Aruanda)', status: ParticipantStatus.ATTENDED },
        { guestName: 'Mestre Zé do Berimbau (convidado)', status: ParticipantStatus.ATTENDED },
      ],
    });
  }

  // Passados.
  const workshopPast = saturdayOnOrAfter(addDays(today, -28));
  const workshopPastAttendees = pickStudents(ctx, workshopPast, 14, 'ws-past');
  plans.push({
    title: `Workshop de Maculelê e Puxada de Rede — ${monthLabel(workshopPast)}`,
    type: 'WORKSHOP',
    description: 'Oficina prática de maculelê com bastões e puxada de rede, aberta aos alunos de todas as unidades.',
    date: workshopPast,
    location: 'Espaço Cultural Axé — Matriz, Goiânia',
    unit: 'matriz',
    city: 'Goiânia',
    isPublic: true,
    image: false,
    participants: spread(workshopPastAttendees, 'ws-past-st', [[ParticipantStatus.ATTENDED, 0.85], [ParticipantStatus.DECLINED, 0.15]]),
  });
  const festivalPast = saturdayOnOrAfter(addDays(today, -50));
  plans.push({
    title: `Festival de Capoeira de Anápolis — ${monthLabel(festivalPast)}`,
    type: 'FESTIVAL',
    description: 'Festival com apresentações das turmas, roda de rua e confraternização.',
    date: festivalPast,
    location: 'Praça Bom Jesus, Anápolis',
    unit: 'anapolis',
    city: 'Anápolis',
    isPublic: true,
    image: false,
    participants: spread(pickStudents(ctx, festivalPast, 11, 'fest-past'), 'fest-past-st', [[ParticipantStatus.ATTENDED, 1]]),
  });

  // Futuros.
  plans.push({
    title: `Oficina de Berimbau com Mestre Convidado — ${monthLabel(addDays(today, 6))}`,
    type: 'AULA_ESPECIAL',
    description: 'Aula especial de berimbau e toques tradicionais com mestre convidado. Vagas limitadas.',
    date: addDays(today, 6),
    location: 'Matriz — Goiânia',
    unit: 'matriz',
    city: 'Goiânia',
    isPublic: false,
    image: false,
    participants: spread(pickStudents(ctx, addDays(today, 6), 9, 'berimbau', (e) => e.spec.unit === 'matriz'), 'berimbau-st', [[ParticipantStatus.CONFIRMED, 0.7], [ParticipantStatus.INVITED, 0.3]]),
  });
  const workshopFuture = saturdayOnOrAfter(addDays(today, 16));
  plans.push({
    title: `Workshop de Capoeira Angola — ${monthLabel(workshopFuture)}`,
    type: 'WORKSHOP',
    description: 'Fundamentos da capoeira angola: ginga baixa, jogo de dentro e tradição dos mestres.',
    date: workshopFuture,
    location: 'Casa de Cultura da Asa Sul, Brasília',
    unit: 'brasilia',
    city: 'Brasília',
    isPublic: true,
    image: false,
    participants: spread(pickStudents(ctx, workshopFuture, 10, 'angola'), 'angola-st', [[ParticipantStatus.CONFIRMED, 0.6], [ParticipantStatus.INVITED, 0.3], [ParticipantStatus.DECLINED, 0.1]]),
  });
  const viagem = saturdayOnOrAfter(addDays(today, 38));
  plans.push({
    title: `Viagem ao Encontro Regional de Capoeira — ${monthLabel(viagem)}`,
    type: 'VIAGEM',
    description: 'Excursão do grupo ao Encontro Regional em Caldas Novas. Saída da Matriz às 6h; valor do transporte por pessoa.',
    date: viagem,
    location: 'Caldas Novas, GO',
    unit: 'matriz',
    city: 'Goiânia',
    isPublic: true,
    image: false,
    participants: spread(pickStudents(ctx, viagem, 12, 'viagem'), 'viagem-st', [[ParticipantStatus.CONFIRMED, 0.5], [ParticipantStatus.INVITED, 0.5]]),
  });
  plans.push({
    title: `Batizado e Troca de Cordas — ${monthLabel(next)}`,
    type: 'BATIZADO',
    description: 'Próximo batizado e troca de cordas do grupo. Inscrições abertas na secretaria; taxa de batizado com vencimento uma semana antes.',
    date: next,
    location: 'Ginásio Poliesportivo do Setor Central, Goiânia',
    unit: 'matriz',
    city: 'Goiânia',
    isPublic: true,
    image: true,
    participants: [
      ...spread(pickStudents(ctx, next, 22, 'bat-next', (e) => (e.spec.status ?? StudentStatus.ACTIVE) === StudentStatus.ACTIVE), 'bat-next-st', [[ParticipantStatus.CONFIRMED, 0.6], [ParticipantStatus.INVITED, 0.3], [ParticipantStatus.DECLINED, 0.1]]),
      { guestName: 'Mestre Cobra Verde (convidado)', status: ParticipantStatus.CONFIRMED },
      { guestName: 'Contramestre Sandra (Grupo Aruanda)', status: ParticipantStatus.CONFIRMED },
    ],
  });
  const campeonato = saturdayOnOrAfter(addDays(today, 63));
  plans.push({
    title: `Campeonato Interno do Grupo Axé — ${monthLabel(campeonato)}`,
    type: 'CAMPEONATO',
    description: 'Campeonato interno entre as unidades, com categorias por faixa etária e graduação.',
    date: campeonato,
    location: 'Ginásio Poliesportivo do Setor Central, Goiânia',
    unit: 'matriz',
    city: 'Goiânia',
    isPublic: false,
    image: false,
    participants: spread(pickStudents(ctx, campeonato, 8, 'camp'), 'camp-st', [[ParticipantStatus.INVITED, 0.75], [ParticipantStatus.CONFIRMED, 0.25]]),
  });
  return plans;
}

async function stepEvents(ctx: Ctx): Promise<void> {
  await block(ctx, 'eventos e participantes', async (tx) => {
    const plans = buildEventPlans(ctx);
    const existing = await tx.event.findMany({
      where: { organizationId: ctx.orgId, title: { in: plans.map((p) => p.title) } },
      select: { id: true, title: true, latitude: true },
    });
    const idByTitle = new Map(existing.map((e) => [e.title, e.id]));
    const withoutPoint = new Set(existing.filter((e) => e.latitude === null).map((e) => e.id));
    const unitCoordinates = (key: UnitKey) => UNITS.find((u) => u.key === key)?.coordinates;
    const studentIdByKey = new Map(ctx.roster.map((e) => [e.spec.key, e.id as number]));

    for (const plan of plans) {
      let eventId = idByTitle.get(plan.title);
      // Mapa da comunidade: ponto do local (ou, na falta, o da unidade do evento).
      const point = DEMO_LOCATION_COORDINATES[plan.location] ?? unitCoordinates(plan.unit);
      if (eventId === undefined) {
        const created = await tx.event.create({
          data: {
            organizationId: ctx.orgId,
            unitId: unitId(ctx, plan.unit),
            stateId: ctx.stateIds.get(plan.unit === 'brasilia' ? 'DF' : 'GO'),
            cityId: ctx.cityIds.get(plan.city),
            title: plan.title,
            type: plan.type,
            description: plan.description,
            date: plan.date,
            location: plan.location,
            latitude: point?.latitude,
            longitude: point?.longitude,
            isPublic: plan.isPublic,
            imageUrl: plan.image ? DEMO_IMAGE_URL : null,
          },
        });
        eventId = created.id;
        bump(ctx, 'events', 1);
      } else if (point && withoutPoint.has(eventId)) {
        // Evento criado antes das coordenadas existirem: só preenche onde está nulo (idempotente).
        await tx.event.update({ where: { id: eventId }, data: { latitude: point.latitude, longitude: point.longitude } });
        bump(ctx, 'mapPoints', 1);
      }

      const current = await tx.eventParticipant.findMany({
        where: { organizationId: ctx.orgId, eventId },
        select: { studentId: true, guestName: true },
      });
      const haveStudents = new Set(current.map((c) => c.studentId).filter((v): v is number => v !== null));
      const haveGuests = new Set(current.map((c) => c.guestName).filter((v): v is string => v !== null));
      const rows: Prisma.EventParticipantCreateManyInput[] = [];
      for (const part of plan.participants) {
        if (part.studentKey) {
          const sid = studentIdByKey.get(part.studentKey) as number;
          if (haveStudents.has(sid)) continue;
          haveStudents.add(sid);
          rows.push({ organizationId: ctx.orgId, eventId, studentId: sid, status: part.status });
        } else if (part.guestName) {
          if (haveGuests.has(part.guestName)) continue;
          haveGuests.add(part.guestName);
          rows.push({ organizationId: ctx.orgId, eventId, guestName: part.guestName, status: part.status });
        }
      }
      // Só monta a lista de um evento que está VAZIO (recém-criado): nunca mexe numa lista já existente.
      if (rows.length > 0 && current.length === 0) {
        const { count } = await tx.eventParticipant.createMany({ data: rows });
        bump(ctx, 'eventParticipants', count);
      }
    }
  });
}

// ---------------------------------------------------------------------------------------------
// 11. Rodas
// ---------------------------------------------------------------------------------------------

async function stepRodas(ctx: Ctx): Promise<void> {
  await block(ctx, 'rodas', async (tx) => {
    const { today } = ctx;
    const plans: Array<{
      title: string; description: string; date: Date; location: string; city: string; uf: string; image: boolean;
      attended: boolean; students: number; users: AccountKey[];
    }> = [
      {
        title: `Roda de Rua do Axé — Praça Cívica (${monthLabel(addDays(today, -9))})`,
        description: 'Roda aberta ao público na Praça Cívica, com bateria completa e convidados de outros grupos.',
        date: addDays(today, -9), location: 'Praça Cívica, Goiânia', city: 'Goiânia', uf: 'GO', image: true,
        attended: true, students: 12, users: ['mestre', 'professor1', 'aluno1', 'aluno2'],
      },
      {
        title: `Roda Aberta no Parque Vaca Brava (${monthLabel(addDays(today, 4))})`,
        description: 'Roda de capoeira ao ar livre, entrada gratuita. Traga água e o seu abadá.',
        date: addDays(today, 4), location: 'Parque Vaca Brava, Goiânia', city: 'Goiânia', uf: 'GO', image: true,
        attended: false, students: 9, users: ['mestre', 'professor1', 'aluno1'],
      },
      {
        title: `Roda de Sexta na Praça — Anápolis (${monthLabel(addDays(today, 19))})`,
        description: 'Roda semanal da filial de Anápolis, aberta a visitantes.',
        date: addDays(today, 19), location: 'Praça Bom Jesus, Anápolis', city: 'Anápolis', uf: 'GO', image: false,
        attended: false, students: 6, users: ['professor2', 'aluno3'],
      },
      {
        title: `Roda do Parque da Cidade — Brasília (${monthLabel(addDays(today, 11))})`,
        description: 'Roda de domingo no Parque da Cidade com a filial de Brasília.',
        date: addDays(today, 11), location: 'Parque da Cidade Sarah Kubitschek, Brasília', city: 'Brasília', uf: 'DF', image: false,
        attended: false, students: 5, users: ['professor3'],
      },
    ];
    for (const plan of plans) {
      let roda = await tx.roda.findFirst({ where: { organizationId: ctx.orgId, title: plan.title } });
      const point = DEMO_LOCATION_COORDINATES[plan.location];
      if (roda && point && roda.latitude === null) {
        // Roda criada antes das coordenadas existirem: só preenche onde está nulo (idempotente).
        roda = await tx.roda.update({ where: { id: roda.id }, data: { latitude: point.latitude, longitude: point.longitude } });
        bump(ctx, 'mapPoints', 1);
      }
      if (!roda) {
        roda = await tx.roda.create({
          data: {
            organizationId: ctx.orgId,
            communityId: plan.uf === 'GO' ? ctx.communityId : null,
            stateId: ctx.stateIds.get(plan.uf),
            cityId: ctx.cityIds.get(plan.city),
            title: plan.title,
            description: plan.description,
            date: plan.date,
            location: plan.location,
            latitude: point?.latitude,
            longitude: point?.longitude,
            imageUrl: plan.image ? DEMO_IMAGE_URL : null,
          },
        });
        bump(ctx, 'rodas', 1);
      }
      const current = await tx.rodaParticipant.count({ where: { rodaId: roda.id } });
      if (current > 0) continue; // lista já montada (ou mexida pelo painel): não completa
      const status = plan.attended ? ParticipantStatus.ATTENDED : ParticipantStatus.CONFIRMED;
      const rows: Prisma.RodaParticipantCreateManyInput[] = [];
      for (const account of plan.users) {
        const userId = uid(ctx, account);
        const studentEntry = ctx.roster.find((e) => e.spec.login === account);
        rows.push({ rodaId: roda.id, userId, studentId: studentEntry?.id ?? null, status });
      }
      const eligible = pickStudents(ctx, plan.date, plan.students, `roda-${plan.title}`, (e) => !e.spec.login && e.spec.age >= 10);
      for (const e of eligible) rows.push({ rodaId: roda.id, studentId: e.id as number, status });
      const { count } = await tx.rodaParticipant.createMany({ data: rows });
      bump(ctx, 'rodaParticipants', count);
    }
  });
}

// ---------------------------------------------------------------------------------------------
// 12. Comunicados e notificações
// ---------------------------------------------------------------------------------------------

async function stepAnnouncements(ctx: Ctx): Promise<void> {
  await block(ctx, 'comunicados e notificações', async (tx) => {
    const { now, today } = ctx;
    const { next } = batizadoCalendar(today);
    const items: Array<{ title: string; body: string; unit: UnitKey | null; daysAgo: number }> = [
      {
        title: 'Bem-vindos ao Grupo Axé Demo!',
        body: 'Esta é uma conta de demonstração do GingApp. Explore alunos, turmas, frequência, financeiro, eventos e o app do capoeirista. Todos os dados são fictícios.',
        unit: null,
        daysAgo: 45,
      },
      {
        title: 'Uniforme oficial do grupo',
        body: 'Lembramos que o uniforme (calça de abadá e camiseta do grupo) é obrigatório nos treinos e eventos. Quem precisar pode retirar na secretaria da Matriz.',
        unit: null,
        daysAgo: 30,
      },
      {
        title: 'Turma Infantil: novo horário de chegada',
        body: 'A turma infantil de terça-feira começa às 17h. Pedimos que as crianças cheguem 10 minutos antes para o aquecimento.',
        unit: 'matriz',
        daysAgo: 9,
      },
      {
        title: `Batizado e Troca de Cordas: inscrições abertas (${monthLabel(next)})`,
        body: `O próximo batizado será em ${isoDay(next).split('-').reverse().join('/')}. Confirme a presença pelo app e acerte a taxa de batizado até uma semana antes.`,
        unit: null,
        daysAgo: 3,
      },
      {
        title: 'Roda aberta em Anápolis',
        body: 'A filial de Anápolis realiza roda aberta na praça. Venham prestigiar e trazer amigos!',
        unit: 'anapolis',
        daysAgo: 2,
      },
      {
        title: 'Aviso: calendário de fim de ano',
        body: 'Em breve divulgaremos as datas de recesso e do último treino do ano. Fiquem atentos aos comunicados.',
        unit: null,
        daysAgo: -10, // agendado (futuro): só a equipe enxerga
      },
    ];

    const existing = await tx.announcement.findMany({
      where: { organizationId: ctx.orgId, title: { in: items.map((i) => i.title) } },
      select: { id: true, title: true },
    });
    const have = new Set(existing.map((e) => e.title));
    const mestreId = uid(ctx, 'mestre');
    const published: Array<{ title: string; body: string; unit: UnitKey | null; publishedAt: Date }> = [];
    for (const item of items) {
      const publishedAt = new Date(now.getTime() - item.daysAgo * DAY);
      if (!have.has(item.title)) {
        await tx.announcement.create({
          data: {
            organizationId: ctx.orgId,
            unitId: item.unit ? unitId(ctx, item.unit) : null,
            title: item.title,
            body: item.body,
            publishedAt,
            createdByUserId: mestreId,
            createdAt: publishedAt < now ? publishedAt : now,
          },
        });
        bump(ctx, 'announcements', 1);
      }
      if (publishedAt <= now) published.push({ ...item, publishedAt });
    }

    // Notificações: mesmo público-alvo de AnnouncementsService.notifyAudience (demo: só as contas demo).
    const audience = (unit: UnitKey | null): AccountKey[] => {
      if (unit === null) return ACCOUNTS.map((a) => a.key);
      const keys = new Set<AccountKey>(['mestre']);
      for (const a of ACCOUNTS) if (a.units?.includes(unit)) keys.add(a.key);
      for (const e of ctx.roster) {
        if (e.spec.unit !== unit) continue;
        if (e.spec.login) keys.add(e.spec.login);
        if (e.spec.guardian?.login) keys.add(e.spec.guardian.login);
      }
      return [...keys];
    };
    const userIdList = ACCOUNTS.map((a) => uid(ctx, a.key));
    const haveNotif = new Set(
      (
        await tx.notification.findMany({
          where: { organizationId: ctx.orgId, userId: { in: userIdList } },
          select: { userId: true, title: true },
        })
      ).map((n) => `${n.userId}|${n.title}`),
    );
    const notifRows: Prisma.NotificationCreateManyInput[] = [];
    const addNotif = (userId: number, title: string, body: string, type: string, at: Date, read: boolean) => {
      const key = `${userId}|${title}`;
      if (haveNotif.has(key)) return;
      haveNotif.add(key);
      notifRows.push({
        organizationId: ctx.orgId,
        userId,
        title,
        body,
        type,
        createdAt: at,
        readAt: read ? new Date(Math.min(at.getTime() + DAY, now.getTime())) : null,
      });
    };
    for (const item of published) {
      const read = now.getTime() - item.publishedAt.getTime() > 7 * DAY;
      for (const key of audience(item.unit)) addNotif(uid(ctx, key), item.title, item.body, 'ANNOUNCEMENT', item.publishedAt, read);
    }
    // Lembretes de mensalidade para quem paga (aluno1 e a responsável aluno4): vencimento do mês corrente.
    const due = dayOf(monthStart(today, 0), FEE_DUE_DAY);
    const dueLabel = `${String(due.getUTCDate()).padStart(2, '0')}/${String(due.getUTCMonth() + 1).padStart(2, '0')}`;
    const reminderAt = new Date(Math.min(now.getTime(), addDays(due, -5).getTime()));
    for (const key of ['aluno1', 'aluno4'] as AccountKey[]) {
      addNotif(
        uid(ctx, key),
        `Mensalidade de ${MONTH_NAMES[due.getUTCMonth()]} disponível`,
        `A mensalidade de ${MONTH_NAMES[due.getUTCMonth()]}/${due.getUTCFullYear()} vence em ${dueLabel}. Confira em Financeiro.`,
        'PAYMENT',
        reminderAt,
        false,
      );
    }
    if (notifRows.length > 0) {
      const { count } = await tx.notification.createMany({ data: notifRows });
      bump(ctx, 'notifications', count);
    }
  });
}

// ---------------------------------------------------------------------------------------------
// 13. Certificados e Passaportes públicos
// ---------------------------------------------------------------------------------------------

async function stepCertificatesAndPassports(ctx: Ctx): Promise<void> {
  await block(ctx, 'certificados e passaportes', async (tx) => {
    const { today } = ctx;
    const studentIds = ctx.roster.map((e) => e.id as number);
    const levelNameByOrder = new Map(LEVELS.map((l) => [l.order, l.name]));
    const levelOrderById = new Map([...ctx.levelIds.entries()].map(([order, id]) => [id, order]));

    // Certificados de graduação: as duas últimas cordas de quem tem Passaporte público + todas as
    // graduações dos últimos ~200 dias.
    const graduations = await tx.studentGraduation.findMany({
      where: { organizationId: ctx.orgId, studentId: { in: studentIds } },
      select: { id: true, studentId: true, graduationLevelId: true, graduatedAt: true },
      orderBy: { graduatedAt: 'desc' },
    });
    const haveGradCert = new Set(
      (
        await tx.certificate.findMany({
          where: { organizationId: ctx.orgId, studentGraduationId: { not: null } },
          select: { studentGraduationId: true },
        })
      ).map((c) => c.studentGraduationId as number),
    );
    const publishedIds = new Set(ctx.roster.filter((e) => e.spec.passport === 'published').map((e) => e.id as number));
    const seenPerStudent = new Map<number, number>();
    const certRows: Prisma.CertificateCreateManyInput[] = [];
    for (const g of graduations) {
      const n = (seenPerStudent.get(g.studentId) ?? 0) + 1;
      seenPerStudent.set(g.studentId, n);
      const recent = today.getTime() - g.graduatedAt.getTime() <= 200 * DAY;
      if (!(recent || (publishedIds.has(g.studentId) && n <= 2))) continue;
      if (haveGradCert.has(g.id)) continue;
      const order = levelOrderById.get(g.graduationLevelId) as number;
      certRows.push({
        organizationId: ctx.orgId,
        studentId: g.studentId,
        studentGraduationId: g.id,
        title: `Certificado de Graduação — Corda ${levelNameByOrder.get(order)}`,
        issuedAt: g.graduatedAt,
        createdAt: g.graduatedAt,
      });
    }

    // Certificado de participação no último workshop (3 alunos que compareceram).
    const workshop = await tx.event.findFirst({
      where: { organizationId: ctx.orgId, type: 'WORKSHOP', date: { lt: today } },
      orderBy: { date: 'desc' },
      select: { id: true, title: true, date: true },
    });
    if (workshop) {
      const attendees = await tx.eventParticipant.findMany({
        where: { organizationId: ctx.orgId, eventId: workshop.id, status: ParticipantStatus.ATTENDED, studentId: { not: null } },
        select: { studentId: true },
        orderBy: { id: 'asc' },
        take: 3,
      });
      const title = `Certificado de Participação — ${workshop.title}`;
      const haveTitle = new Set(
        (
          await tx.certificate.findMany({ where: { organizationId: ctx.orgId, title }, select: { studentId: true } })
        ).map((c) => c.studentId),
      );
      for (const a of attendees) {
        if (haveTitle.has(a.studentId as number)) continue;
        certRows.push({
          organizationId: ctx.orgId,
          studentId: a.studentId as number,
          title,
          issuedAt: workshop.date,
          createdAt: workshop.date,
        });
      }
    }
    if (certRows.length > 0) {
      const { count } = await tx.certificate.createMany({ data: certRows });
      bump(ctx, 'certificates', count);
    }

    // Passaportes: menor só publica com o consentimento do responsável (consentByGuardianId).
    const bios: Record<string, string> = {
      rafael: 'Capoeirista há anos, apaixonado por roda e tradição.',
      juliana: 'Treino toda semana e adoro cantar nas rodas.',
      bruno: 'Aluno graduado do grupo, sempre na bateria.',
      eduardo: 'Monitor da turma de graduados.',
      leonardo: 'Capoeira é saúde, cultura e amizade.',
      'maria-clara': 'Capoeirista mirim do Grupo Axé.',
    };
    for (const entry of ctx.roster) {
      const kind = entry.spec.passport;
      if (!kind) continue;
      const sid = entry.id as number;
      const existing = await tx.publicProfile.findUnique({ where: { studentId: sid } });
      if (existing) continue;
      const guardianId = ctx.guardianIds.get(entry.spec.key);
      const isMinor = entry.spec.age < 18;
      if (isMinor && !(entry.spec.guardian?.consent && guardianId)) continue; // sem consentimento: nunca cria
      await tx.publicProfile.create({
        data: {
          organizationId: ctx.orgId,
          studentId: sid,
          displayName: entry.spec.name,
          bio: bios[entry.spec.key] ?? null,
          isPublished: kind === 'published',
          consentByGuardianId: isMinor ? guardianId : null,
        },
      });
      bump(ctx, 'publicProfiles', 1);
    }
  });
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const password = resolveDemoPassword(process.env);
    await runDemo(prisma, { password }, consoleLogger);
  } catch (error) {
    if (error instanceof DemoConfigError) {
      consoleLogger.error(`${error.message} Nada foi gravado.`);
    } else {
      const err = error as Error & { code?: string };
      consoleLogger.error(redact(String(err?.message ?? err), [process.env.DEMO_PASSWORD ?? '']).split('\n')[0]);
    }
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main();
}
