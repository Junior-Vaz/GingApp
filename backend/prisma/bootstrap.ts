// Bootstrap de PRODUÇÃO do GingApp (idempotente, sem nenhum dado de exemplo).
//
// O QUE FAZ (nesta ordem, numa única transação, depois de validar TODA a configuração):
//   1. Matriz base RolePermission (SSOT: prisma/permission-matrix.ts, a mesma do seed de dev):
//      cria SÓ as linhas (papel × recurso) AUSENTES. Linhas que já existem NUNCA são
//      sobrescritas (preserva um ajuste feito por um admin/DBA); se alguma diverge da matriz
//      base, o bootstrap AVISA (papel/recurso) sem alterar. Correções de segurança em bancos já
//      existentes continuam vindo por migrations de dados (UPSERT forçado, ex.:
//      20261009020000_restrict_professor_finance e 20261009030000_restrict_member_roles_least_privilege),
//      cujos valores são idênticos aos da matriz — por isso, numa base nova,
//      `migrate deploy` + bootstrap produz a MESMA matriz que `migrate deploy` + seed.
//   2. Primeiro usuário PLATFORM super admin, a partir de variáveis de ambiente:
//        SUPER_ADMIN_EMAIL     e-mail de login (gravado em minúsculas; login usa /api/auth/platform-login)
//        SUPER_ADMIN_PASSWORD  senha: 12..72 bytes UTF-8 (o bcrypt ignora o que passa de 72 bytes),
//                              ≥ 3 de 4 classes (minúscula, maiúscula, dígito, símbolo),
//                              ≥ 6 caracteres distintos, sem espaços nas pontas, sem conter o
//                              e-mail nem termos triviais (Dev@12345, password, senha, 123456...).
//        SUPER_ADMIN_NAME      opcional (2..120 caracteres; padrão "Super Admin")
//      - Nenhuma das duas (EMAIL/PASSWORD) definida: aplica só a matriz e AVISA (exit 0).
//      - Só uma das duas, ou qualquer valor inválido: FALHA (exit 1) ANTES de escrever qualquer
//        coisa no banco — nunca sobe produção com admin fraco/mal configurado em silêncio.
//      - Já existe usuário com esse e-mail (comparação sem diferenciar maiúsculas): NÃO altera
//        senha, tipo, status nem flags; só registra no log (exit 0). Rotacionar a senha depois
//        é pelo próprio admin (/platform-team), não por aqui.
//      - A senha só existe em memória para gerar o hash bcrypt (mesmo custo do PlatformTeamService);
//        nem a senha nem o hash aparecem em log ou mensagem de erro.
//
// O QUE NÃO FAZ (de propósito — nada disso é necessário para um PLATFORM logar e operar o admin):
//   - Organização "SYSTEM" id=1 (PLANO_PROJETO.md §2.2): nenhuma rota/guard depende dela —
//     PLATFORM não tem OrganizationUser, platform-login não consulta organização, e o
//     platform-dashboard só conta organizações GROUP. /health só faz SELECT 1.
//   - Planos de assinatura: catálogo comercial, criado pelo super admin em /api/plans.
//   - Organizações, membros, turmas etc. de exemplo: isso é o seed de DEV (prisma/seed.ts, senha
//     fixa Dev@12345) e NUNCA deve rodar em produção.
//
// USO
//   npm run bootstrap:prod                          (local: precisa de DATABASE_URL)
//   docker compose -f docker-compose.prod.yml run --rm migrate   (stage "migrate" do Dockerfile:
//                                                    migrate deploy && bootstrap)
// Idempotente: rodar N vezes = mesmo estado, sem erro e sem duplicar. Duas execuções simultâneas
// são serializadas por um advisory lock transacional do Postgres.

import { PrismaClient, UserType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { isEmail } from 'class-validator';
import {
  BCRYPT_ROUNDS,
  FORBIDDEN_PASSWORD_FRAGMENTS,
  NEW_PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_BYTES,
  passwordByteLength,
} from '../src/shared/security/password-policy';
import { findUserIdsByEmail } from '../src/shared/security/email-lookup';
import { buildPermissionMatrix, PermissionRow } from './permission-matrix';

/** Mínimo para a conta mais poderosa do sistema (a API de equipe aceita 10; aqui é mais estrito).
 * SSOT da política: src/shared/security/password-policy.ts. */
export const SUPER_ADMIN_PASSWORD_MIN_LENGTH = NEW_PASSWORD_MIN_LENGTH;
const EMAIL_MAX_LENGTH = 254;
const NAME_MIN_LENGTH = 2;
const NAME_MAX_LENGTH = 120;
const DEFAULT_NAME = 'Super Admin';
/** Chave fixa do pg_advisory_xact_lock que serializa bootstraps concorrentes. */
const BOOTSTRAP_LOCK_KEY = 4_270_001;

/** Termos que tornam a senha trivial (comparação sem diferenciar maiúsculas, por substring). */
const FORBIDDEN_PASSWORD_TERMS = [
  ...FORBIDDEN_PASSWORD_FRAGMENTS, // senha fixa do seed de desenvolvimento (pública no repositório)
  'password',
  'senha',
  'qwerty',
  '123456',
  'gingapp',
  'admin',
  'changeme',
  'letmein',
];

export class BootstrapConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BootstrapConfigError';
  }
}

export interface BootstrapLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface SuperAdminConfig {
  email: string;
  password: string;
  name: string;
}

export interface BootstrapResult {
  permissionsCreated: number;
  permissionsDivergent: string[];
  superAdmin: 'created' | 'exists' | 'skipped';
  activeSuperAdmins: number;
}

type Env = Record<string, string | undefined>;

const consoleLogger: BootstrapLogger = {
  info: (m) => console.log(`[bootstrap] ${m}`),
  warn: (m) => console.warn(`[bootstrap] AVISO: ${m}`),
  error: (m) => console.error(`[bootstrap] ERRO: ${m}`),
};

/** Lista de regras violadas (mensagens SEM o valor da senha). Vazia = senha aceita. */
export function passwordProblems(password: string, email: string): string[] {
  const problems: string[] = [];
  if (password !== password.trim()) {
    problems.push('não pode começar nem terminar com espaço/quebra de linha');
  }
  if ([...password].length < SUPER_ADMIN_PASSWORD_MIN_LENGTH) {
    problems.push(
      `deve ter pelo menos ${SUPER_ADMIN_PASSWORD_MIN_LENGTH} caracteres`,
    );
  }
  if (passwordByteLength(password) > PASSWORD_MAX_BYTES) {
    problems.push(
      `deve ter no máximo ${PASSWORD_MAX_BYTES} bytes (limite do bcrypt)`,
    );
  }
  const lower = password.toLowerCase();
  if (FORBIDDEN_PASSWORD_TERMS.some((term) => lower.includes(term))) {
    problems.push(
      'contém um termo trivial/conhecido (ex.: a senha de desenvolvimento, "senha", "123456", "admin")',
    );
  }
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) =>
    re.test(password),
  ).length;
  if (classes < 3) {
    problems.push(
      'deve combinar pelo menos 3 de: minúsculas, maiúsculas, dígitos, símbolos',
    );
  }
  if (new Set(password).size < 6) {
    problems.push('deve ter pelo menos 6 caracteres distintos');
  }
  const localPart = email.split('@')[0] ?? '';
  if (localPart.length >= 4 && lower.includes(localPart.toLowerCase())) {
    problems.push('não pode conter o próprio e-mail');
  }
  return problems;
}

/**
 * Lê e valida SUPER_ADMIN_*. Retorna null quando nenhuma credencial foi informada (o chamador
 * avisa); lança BootstrapConfigError (mensagem sem segredos) quando a configuração é inválida.
 */
export function readSuperAdminConfig(env: Env): SuperAdminConfig | null {
  const rawEmail = env.SUPER_ADMIN_EMAIL?.trim() ?? '';
  const password = env.SUPER_ADMIN_PASSWORD ?? '';
  const hasPassword = password.trim() !== '';

  if (!rawEmail && !hasPassword) return null;
  if (!rawEmail || !hasPassword) {
    throw new BootstrapConfigError(
      'SUPER_ADMIN_EMAIL e SUPER_ADMIN_PASSWORD devem ser definidas JUNTAS (ou nenhuma das duas).',
    );
  }

  const email = rawEmail.toLowerCase();
  if (email.length > EMAIL_MAX_LENGTH || !isEmail(email)) {
    throw new BootstrapConfigError('SUPER_ADMIN_EMAIL não é um e-mail válido.');
  }

  const problems = passwordProblems(password, email);
  if (problems.length > 0) {
    throw new BootstrapConfigError(
      `SUPER_ADMIN_PASSWORD recusada: ${problems.join('; ')}.`,
    );
  }

  const name = env.SUPER_ADMIN_NAME?.trim() || DEFAULT_NAME;
  if (name.length < NAME_MIN_LENGTH || name.length > NAME_MAX_LENGTH) {
    throw new BootstrapConfigError(
      `SUPER_ADMIN_NAME deve ter entre ${NAME_MIN_LENGTH} e ${NAME_MAX_LENGTH} caracteres.`,
    );
  }

  return { email, password, name };
}

const key = (row: Pick<PermissionRow, 'role' | 'resource'>) =>
  `${row.role}/${row.resource}`;

/**
 * Aplica a matriz base e cria o primeiro super admin. Valida TUDO antes da primeira escrita;
 * escreve numa única transação (tudo ou nada).
 */
export async function runBootstrap(
  prisma: PrismaClient,
  env: Env = process.env,
  log: BootstrapLogger = consoleLogger,
): Promise<BootstrapResult> {
  const admin = readSuperAdminConfig(env); // lança antes de qualquer escrita
  const passwordHash = admin
    ? await bcrypt.hash(admin.password, BCRYPT_ROUNDS)
    : null;
  const matrix = buildPermissionMatrix();

  const result = await prisma
    .$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BOOTSTRAP_LOCK_KEY})`;

        // 1. Matriz: só cria o que falta; diverge = avisa sem sobrescrever.
        const existing = await tx.rolePermission.findMany();
        const existingByKey = new Map(existing.map((row) => [key(row), row]));
        const missing = matrix.filter((row) => !existingByKey.has(key(row)));
        const divergent = matrix
          .filter((row) => {
            const current = existingByKey.get(key(row));
            return (
              !!current &&
              (current.canView !== row.canView ||
                current.canCreate !== row.canCreate ||
                current.canEdit !== row.canEdit ||
                current.canDelete !== row.canDelete)
            );
          })
          .map(key);
        const { count: permissionsCreated } = missing.length
          ? await tx.rolePermission.createMany({
              data: missing,
              skipDuplicates: true,
            })
          : { count: 0 };

        // 2. Super admin.
        let superAdmin: BootstrapResult['superAdmin'] = 'skipped';
        if (admin && passwordHash) {
          // Igualdade exata de lower(email) — o `mode: 'insensitive'` do Prisma é ILIKE (curingas "_" e "%").
          const [currentId] = await findUserIdsByEmail(tx, admin.email, 1);
          const current =
            currentId === undefined
              ? null
              : await tx.user.findUnique({
                  where: { id: currentId },
                  select: {
                    id: true,
                    userType: true,
                    isSuperAdmin: true,
                    status: true,
                  },
                });
          if (current) {
            superAdmin = 'exists';
            log.info(
              `Usuário ${admin.email} já existe (id=${current.id}, userType=${current.userType}, ` +
                `isSuperAdmin=${current.isSuperAdmin}, status=${current.status}) — NADA alterado (senha e flags preservadas).`,
            );
            if (
              current.userType !== UserType.PLATFORM ||
              !current.isSuperAdmin ||
              current.status !== 'ACTIVE'
            ) {
              log.warn(
                `${admin.email} NÃO é um super admin PLATFORM ativo; o bootstrap não promove contas existentes. ` +
                  'Use outro SUPER_ADMIN_EMAIL ou ajuste a conta manualmente.',
              );
            }
          } else {
            const created = await tx.user.create({
              data: {
                email: admin.email,
                passwordHash,
                name: admin.name,
                userType: UserType.PLATFORM,
                isSuperAdmin: true,
                status: 'ACTIVE',
              },
              select: { id: true },
            });
            superAdmin = 'created';
            log.info(
              `Super admin PLATFORM criado: ${admin.email} (id=${created.id}).`,
            );
          }
        }

        const activeSuperAdmins = await tx.user.count({
          where: {
            userType: UserType.PLATFORM,
            isSuperAdmin: true,
            status: 'ACTIVE',
          },
        });
        return {
          permissionsCreated,
          permissionsDivergent: divergent,
          superAdmin,
          activeSuperAdmins,
        };
      },
      { timeout: 30_000 },
    )
    .catch((error: unknown) => {
      // Erros do Prisma podem ecoar os argumentos da query (inclusive passwordHash): relança só
      // a 1a linha da mensagem, com senha e hash removidos.
      const err = error as Error & { code?: string };
      const clean = new Error(
        redact(String(err?.message ?? err), [
          admin?.password ?? '',
          passwordHash ?? '',
        ]).split('\n')[0],
      );
      (clean as Error & { code?: string }).code = err?.code;
      throw clean;
    });

  log.info(
    `RolePermission: ${matrix.length} linhas na matriz base; ${result.permissionsCreated} criada(s), ` +
      `${matrix.length - result.permissionsCreated} já existia(m).`,
  );
  if (result.permissionsDivergent.length > 0) {
    log.warn(
      `${result.permissionsDivergent.length} linha(s) existente(s) diverge(m) da matriz base e NÃO foram alteradas: ` +
        `${result.permissionsDivergent.join(', ')}.`,
    );
  }
  if (!admin) {
    log.warn(
      'SUPER_ADMIN_EMAIL/SUPER_ADMIN_PASSWORD não definidas — nenhum super admin criado (só a matriz foi aplicada).',
    );
  }
  if (result.activeSuperAdmins === 0) {
    log.warn(
      'Não há NENHUM super admin PLATFORM ativo: ninguém consegue operar o admin. Defina SUPER_ADMIN_* e rode de novo.',
    );
  }
  log.info('Concluído.');
  return result;
}

/** Remove qualquer ocorrência dos segredos de uma mensagem de erro inesperada (ex.: Prisma ecoa argumentos). */
function redact(message: string, secrets: string[]): string {
  return secrets
    .filter((s) => s.length > 0)
    .reduce((msg, s) => msg.split(s).join('[REDACTED]'), message);
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await runBootstrap(prisma, process.env, consoleLogger);
  } catch (error) {
    if (error instanceof BootstrapConfigError) {
      consoleLogger.error(`${error.message} Nada foi gravado no banco.`);
    } else {
      const secrets = [process.env.SUPER_ADMIN_PASSWORD ?? ''];
      const err = error as Error & { code?: string };
      const detail = err?.code ? ` (código ${err.code})` : '';
      // Só a mensagem (sem stack/argumentos), e ainda assim sem a senha; o hash nunca chega aqui.
      consoleLogger.error(
        `falha inesperada${detail}: ${redact(String(err?.message ?? err), secrets).split('\n')[0]}`,
      );
    }
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main();
}
