import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp } from './utils/test-app';

/**
 * Bootstrap de PRODUÇÃO (prisma/bootstrap.ts) — roda em bancos ISOLADOS criados por este spec
 * (CREATE DATABASE via conexão admin no MESMO servidor de DATABASE_URL, DROP no final), nunca no
 * banco compartilhado da suíte (que tem o seed de dev). O bootstrap roda como PROCESSO real
 * (`npx ts-node prisma/bootstrap.ts`), exatamente como no stage "migrate" do
 * Dockerfile — então exit code e stdout/stderr são os de verdade.
 *
 *   A = migrate deploy + bootstrap (com super admin)  → login, idempotência, e-mail existente
 *   B = migrate deploy + seed (dev)                   → matriz de referência
 *   C = migrate deploy só                             → configs inválidas (nada gravado) e "sem variáveis"
 */
const BACKEND_DIR = `${__dirname}/..`;
const SUPER_EMAIL = 'root.ops@example.test';
const SUPER_PASSWORD = 'Boot-Strap#2026xQ';
const SUPER_NAME = 'Ops Root';

/** Oráculo INDEPENDENTE da matriz base (papel → 12 recursos na ordem abaixo; V/C/E/D ou "-").
 * Conferido contra a saída do seed ANTES da extração para prisma/permission-matrix.ts. */
const RESOURCES = ['students', 'classes', 'lessons', 'attendance', 'graduations', 'finance', 'events', 'rodas', 'announcements', 'teachers', 'dashboard', 'certificates'];
const ORACLE: Record<string, string[]> = {
  MESTRE: Array(12).fill('VCED'),
  PROFESSOR: ['VCE-', 'VCE-', 'VCE-', 'VCE-', 'VCE-', '----', 'VCE-', 'VCE-', 'VCE-', 'V---', 'VCE-', 'VCE-'],
  ALUNO: ['----', '----', '----', '----', '----', '----', 'V---', 'V---', 'V---', '----', '----', '----'],
  RESPONSAVEL: ['----', '----', '----', '----', '----', '----', 'V---', 'V---', 'V---', '----', '----', '----'],
};
const oracleRows = Object.entries(ORACLE)
  .flatMap(([role, flags]) => flags.map((f, i) => `${role}/${RESOURCES[i]}:${f}`))
  .sort();

interface RunResult {
  status: number | null;
  output: string;
}

function dbUrl(base: string, name: string): string {
  const url = new URL(base);
  url.pathname = `/${name}`;
  return url.toString();
}

/** Ambiente do processo filho SEM nenhum SUPER_ADMIN_* herdado + os extras informados. */
function childEnv(url: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: url };
  delete env.SUPER_ADMIN_EMAIL;
  delete env.SUPER_ADMIN_PASSWORD;
  delete env.SUPER_ADMIN_NAME;
  return { ...env, ...extra };
}

function run(command: string, url: string, extra: Record<string, string> = {}): RunResult {
  const res = spawnSync(command, {
    cwd: BACKEND_DIR,
    env: childEnv(url, extra),
    shell: true,
    encoding: 'utf8',
    timeout: 180_000,
  });
  return { status: res.status, output: `${res.stdout ?? ''}\n${res.stderr ?? ''}` };
}

const runBootstrap = (url: string, extra: Record<string, string> = {}) =>
  run('npx ts-node prisma/bootstrap.ts', url, extra);

function mustSucceed(label: string, res: RunResult): void {
  assert.equal(res.status, 0, `${label} falhou (exit ${res.status}):\n${res.output}`);
}

async function matrixOf(client: PrismaClient): Promise<string[]> {
  const rows = await client.rolePermission.findMany();
  return rows
    .map(
      (r) =>
        `${r.role}/${r.resource}:${r.canView ? 'V' : '-'}${r.canCreate ? 'C' : '-'}${r.canEdit ? 'E' : '-'}${r.canDelete ? 'D' : '-'}`,
    )
    .sort();
}

describe('Bootstrap de produção (e2e, bancos isolados)', () => {
  const baseUrl = process.env.DATABASE_URL;
  assert.ok(baseUrl, 'DATABASE_URL é obrigatório para o e2e');
  const baseName = new URL(baseUrl).pathname.replace(/^\//, '');
  const tag = `${process.pid}_${Date.now().toString(36)}`;
  const names = { A: `${baseName}_bsa_${tag}`, B: `${baseName}_bsb_${tag}`, C: `${baseName}_bsc_${tag}` };
  const urls = { A: dbUrl(baseUrl, names.A), B: dbUrl(baseUrl, names.B), C: dbUrl(baseUrl, names.C) };

  const adminDb = new PrismaClient({ datasourceUrl: dbUrl(baseUrl, 'postgres') });
  let dbA: PrismaClient;
  let dbB: PrismaClient;
  let dbC: PrismaClient;
  let app: INestApplication | undefined;
  /** Toda saída de todo bootstrap rodado neste spec — conferida no fim: nenhuma senha/hash. */
  const outputs: string[] = [];
  const allPasswords = new Set<string>();
  const boot = (url: string, extra: Record<string, string> = {}) => {
    if (extra.SUPER_ADMIN_PASSWORD) allPasswords.add(extra.SUPER_ADMIN_PASSWORD);
    const res = runBootstrap(url, extra);
    outputs.push(res.output);
    return res;
  };
  const withAdmin = (password = SUPER_PASSWORD, email = SUPER_EMAIL) => ({
    SUPER_ADMIN_EMAIL: email,
    SUPER_ADMIN_PASSWORD: password,
    SUPER_ADMIN_NAME: SUPER_NAME,
  });

  before(async () => {
    for (const name of Object.values(names)) {
      assert.match(name, /^[a-z0-9_]+$/, `nome de banco inesperado: ${name}`);
      await adminDb.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    }
    for (const url of Object.values(urls)) mustSucceed('migrate deploy', run('npx prisma migrate deploy', url));
    mustSucceed('seed (B)', run('npx prisma db seed', urls.B));
    dbA = new PrismaClient({ datasourceUrl: urls.A });
    dbB = new PrismaClient({ datasourceUrl: urls.B });
    dbC = new PrismaClient({ datasourceUrl: urls.C });
  });

  after(async () => {
    await app?.close();
    await Promise.all([dbA?.$disconnect(), dbB?.$disconnect(), dbC?.$disconnect()]);
    for (const name of Object.values(names)) {
      await adminDb.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    }
    await adminDb.$disconnect();
  });

  // ---------------------------------------------------------------- C: config inválida
  /** [rótulo, env, regra que DEVE aparecer na mensagem — garante que falhou pelo motivo certo] */
  const TRIVIAL = /termo trivial/;
  const invalidConfigs: Array<[string, Record<string, string>, RegExp]> = [
    ['senha do seed de dev (Dev@12345)', withAdmin('Dev@12345'), TRIVIAL],
    ['senha que contém Dev@12345 (passaria nas demais regras)', withAdmin('Dev@12345-Prod'), TRIVIAL],
    ['senha curta (8)', withAdmin('Ab1!xyz9'), /pelo menos 12 caracteres/],
    ['senha de 11 caracteres (abaixo do mínimo 12)', withAdmin('Ab1!xyz9Qw#'), /pelo menos 12 caracteres/],
    ['senha > 72 bytes (73 ASCII)', withAdmin(`Aa1!${'x'.repeat(69)}`), /no máximo 72 bytes/],
    ['senha > 72 bytes com multibyte (39 caracteres, 74 bytes)', withAdmin(`Aa1!${'é'.repeat(35)}`), /no máximo 72 bytes/],
    ['senha trivial (uma classe só)', withAdmin('aaaaaaaaaaaaaaaa'), /pelo menos 3 de/],
    ['senha com termo trivial ("Senha")', withAdmin('Senha#Forte2026'), TRIVIAL],
    ['senha com poucos caracteres distintos', withAdmin('Ab1!Ab1!Ab1!Ab1!'), /6 caracteres distintos/],
    ['senha com \\r no fim (.env do Windows)', withAdmin(`${SUPER_PASSWORD}\r`), /espaço\/quebra de linha/],
    ['senha contendo o e-mail', withAdmin('Root.Ops#2026xyz'), /próprio e-mail/],
    ['e-mail inválido', withAdmin(SUPER_PASSWORD, 'not-an-email'), /SUPER_ADMIN_EMAIL não é um e-mail válido/],
    ['só SUPER_ADMIN_EMAIL (sem senha)', { SUPER_ADMIN_EMAIL: SUPER_EMAIL }, /JUNTAS/],
    ['só SUPER_ADMIN_PASSWORD (sem e-mail)', { SUPER_ADMIN_PASSWORD: SUPER_PASSWORD }, /JUNTAS/],
    ['nome curto demais', { ...withAdmin(), SUPER_ADMIN_NAME: 'X' }, /SUPER_ADMIN_NAME deve ter/],
  ];
  it('C: configuração inválida → exit != 0, mensagem clara e NADA gravado', async () => {
    const before = await matrixOf(dbC);
    assert.equal(await dbC.user.count(), 0);
    assert.ok(before.length < oracleRows.length, 'pré-condição: base só migrada tem matriz incompleta');

    for (const [label, env, rule] of invalidConfigs) {
      const res = boot(urls.C, env);
      assert.notEqual(res.status, 0, `${label}: deveria falhar, mas exit=${res.status}\n${res.output}`);
      assert.match(res.output, /\[bootstrap\] ERRO: SUPER_ADMIN_/, `${label}: mensagem clara ausente\n${res.output}`);
      assert.match(res.output, rule, `${label}: falhou, mas não pela regra esperada ${rule}\n${res.output}`);
      assert.match(res.output, /Nada foi gravado/, label);
      assert.deepEqual(await matrixOf(dbC), before, `${label}: a matriz mudou apesar da falha`);
      assert.equal(await dbC.user.count(), 0, `${label}: usuário criado apesar da falha`);
    }
  });

  it('C: sem variáveis SUPER_ADMIN_* → só a matriz + AVISO, exit 0, nenhum usuário', async () => {
    const res = boot(urls.C);
    mustSucceed('bootstrap sem variáveis', res);
    assert.match(res.output, /AVISO: SUPER_ADMIN_EMAIL\/SUPER_ADMIN_PASSWORD não definidas/);
    assert.match(res.output, /AVISO: Não há NENHUM super admin PLATFORM ativo/);
    assert.deepEqual(await matrixOf(dbC), oracleRows);
    assert.equal(await dbC.user.count(), 0);
  });

  // ---------------------------------------------------------------- A: caminho feliz
  it('A: migrate + bootstrap → matriz IDÊNTICA à de migrate + seed (linha a linha) e ao oráculo', async () => {
    const res = boot(urls.A, withAdmin());
    mustSucceed('bootstrap A', res);
    assert.match(res.output, /Super admin PLATFORM criado: root\.ops@example\.test/);

    const a = await matrixOf(dbA);
    const b = await matrixOf(dbB);
    assert.equal(a.length, 48);
    assert.deepEqual(a, b, 'matriz do bootstrap difere da do seed');
    assert.deepEqual(a, oracleRows, 'matriz difere do oráculo independente');
  });

  it('A: NENHUM dado de exemplo — só o super admin e a matriz', async () => {
    const users = await dbA.user.findMany();
    assert.equal(users.length, 1);
    assert.equal(users[0].email, SUPER_EMAIL);
    assert.equal(users[0].name, SUPER_NAME);
    assert.equal(users[0].userType, 'PLATFORM');
    assert.equal(users[0].isSuperAdmin, true);
    assert.equal(users[0].status, 'ACTIVE');
    assert.ok(users[0].passwordHash.startsWith('$2b$10$'), 'hash deve ser bcrypt custo 10 (mesmo do PlatformTeamService)');
    const counts = {
      organization: await dbA.organization.count(),
      organizationUser: await dbA.organizationUser.count(),
      plan: await dbA.plan.count(),
      subscription: await dbA.subscription.count(),
      unit: await dbA.unit.count(),
      student: await dbA.student.count(),
      class: await dbA.class.count(),
      graduationSystem: await dbA.graduationSystem.count(),
      state: await dbA.state.count(),
      roda: await dbA.roda.count(),
    };
    assert.deepEqual(counts, Object.fromEntries(Object.keys(counts).map((k) => [k, 0])));
    // sanity: o seed (B) cria sim dados de exemplo — a comparação acima não é vacuamente verdadeira
    assert.ok((await dbB.organization.count()) > 0);
    assert.ok((await dbB.user.count({ where: { email: 'owner@gingapp.com.br' } })) === 1);
  });

  it('A: super admin criado faz login (platform-login) e acessa /platform-dashboard e /platform-team (200)', async () => {
    // O app (PrismaService) lê DATABASE_URL na construção: aponta para A só neste processo de teste.
    process.env.DATABASE_URL = urls.A;
    app = await createTestApp();
    const http = () => request(app!.getHttpServer());

    const login = await http()
      .post('/api/auth/platform-login')
      .send({ email: SUPER_EMAIL, password: SUPER_PASSWORD })
      .expect(200);
    const token = login.body.accessToken as string;
    assert.equal(typeof token, 'string');
    assert.equal(login.body.user.userType, 'PLATFORM');
    assert.equal(login.body.user.isSuperAdmin, true);

    const dash = await http().get('/api/platform-dashboard').set('Authorization', `Bearer ${token}`).expect(200);
    assert.equal(dash.body.organizations.total, 0);
    const team = await http().get('/api/platform-team').set('Authorization', `Bearer ${token}`).expect(200);
    assert.ok(JSON.stringify(team.body).includes(SUPER_EMAIL));
    assert.ok(!JSON.stringify(team.body).includes('passwordHash'));

    // /api/auth/login é o login de MEMBER: conta PLATFORM é recusada lá (rota certa = platform-login).
    await http().post('/api/auth/login').send({ email: SUPER_EMAIL, password: SUPER_PASSWORD }).expect(401);
    // Senha errada → 401.
    await http().post('/api/auth/platform-login').send({ email: SUPER_EMAIL, password: `${SUPER_PASSWORD}x` }).expect(401);
  });

  it('A: 2ª execução idempotente — mesmos counts, mesma matriz, senha (hash) do admin intacta', async () => {
    const hashBefore = (await dbA.user.findUniqueOrThrow({ where: { email: SUPER_EMAIL } })).passwordHash;
    const matrixBefore = await matrixOf(dbA);
    const usersBefore = await dbA.user.count();

    const res = boot(urls.A, withAdmin());
    mustSucceed('bootstrap A (2x)', res);
    assert.match(res.output, /já existe .* NADA alterado/);
    assert.match(res.output, /0 criada\(s\), 48 já existia\(m\)/);

    assert.equal(await dbA.user.count(), usersBefore);
    assert.deepEqual(await matrixOf(dbA), matrixBefore);
    assert.equal((await dbA.user.findUniqueOrThrow({ where: { email: SUPER_EMAIL } })).passwordHash, hashBefore);
  });

  it('A: e-mail existente (maiúsculas, OUTRA senha válida) → nada alterado; senha antiga continua valendo', async () => {
    const userBefore = await dbA.user.findUniqueOrThrow({ where: { email: SUPER_EMAIL } });
    const otherPassword = 'Outra-Chave#9931zK';
    const res = boot(urls.A, withAdmin(otherPassword, SUPER_EMAIL.toUpperCase()));
    mustSucceed('bootstrap e-mail existente', res);
    assert.match(res.output, /já existe/);

    const userAfter = await dbA.user.findUniqueOrThrow({ where: { email: SUPER_EMAIL } });
    assert.deepEqual(userAfter, userBefore, 'usuário existente foi alterado');
    assert.equal(await dbA.user.count(), 1, 'duplicou o usuário (e-mail em maiúsculas)');
    assert.equal(await bcrypt.compare(SUPER_PASSWORD, userAfter.passwordHash), true);
    assert.equal(await bcrypt.compare(otherPassword, userAfter.passwordHash), false);
  });

  it('A: e-mail de um MEMBER existente → NÃO promove nem altera a conta (aviso)', async () => {
    const member = await dbA.user.create({
      data: { email: 'member.keep@example.test', passwordHash: await bcrypt.hash('Member#Keep2026', 4), name: 'Member Keep' },
    });
    const res = boot(urls.A, withAdmin('Promote-Me#2026q', member.email));
    mustSucceed('bootstrap com e-mail de MEMBER', res);
    assert.match(res.output, /NÃO é um super admin PLATFORM ativo/);
    assert.deepEqual(await dbA.user.findUniqueOrThrow({ where: { id: member.id } }), member);
    await dbA.user.delete({ where: { id: member.id } });
  });

  it('A: linha da matriz customizada por um admin NÃO é sobrescrita (aviso de divergência)', async () => {
    const where = { role_resource: { role: 'PROFESSOR' as const, resource: 'students' } };
    await dbA.rolePermission.update({ where, data: { canDelete: true } });
    try {
      const res = boot(urls.A);
      mustSucceed('bootstrap com linha customizada', res);
      assert.match(res.output, /1 linha\(s\) existente\(s\) diverge\(m\) .*PROFESSOR\/students/);
      assert.equal((await dbA.rolePermission.findUniqueOrThrow({ where })).canDelete, true);
    } finally {
      await dbA.rolePermission.update({ where, data: { canDelete: false } });
    }
    assert.deepEqual(await matrixOf(dbA), oracleRows);
  });

  it('nenhuma senha (nem hash) aparece em NENHUMA saída do bootstrap', async () => {
    assert.ok(outputs.length >= invalidConfigs.length + 5, `poucas execuções capturadas: ${outputs.length}`);
    const hash = (await dbA.user.findUniqueOrThrow({ where: { email: SUPER_EMAIL } })).passwordHash;
    const all = outputs.join('\n');
    for (const password of allPasswords) {
      const visible = password.trim();
      assert.ok(!all.includes(visible), `a senha de teste "${visible.slice(0, 3)}…" apareceu na saída`);
    }
    assert.ok(!all.includes(hash), 'o hash apareceu na saída');
    assert.ok(!/\$2[aby]\$\d\d\$/.test(all), 'algum hash bcrypt apareceu na saída');
  });
});
