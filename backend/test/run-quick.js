// Modo rápido dos testes e2e (desenvolvimento): `npm run test:quick [-- filtro1 filtro2 ...]`.
//  - sem checagem de tipos (ts-node transpile-only; o tipo continua coberto por `npm run build`);
//  - sem migrate/seed (assume o banco de dev já preparado; `npm run test:e2e` faz o setup);
//  - sem o spec de bootstrap (cria bancos isolados, ~95 s) — só roda com `quick -- bootstrap` ou no test:e2e.
// Filtros: substrings do nome do arquivo (ex.: `npm run test:quick -- classes events`).
// A suíte completa e rigorosa (com tipos, setup e bootstrap) continua sendo `npm run test:e2e`.
const { spawnSync } = require('node:child_process');
const { readdirSync } = require('node:fs');
const path = require('node:path');

const dir = __dirname;
// `--smoke`: só o essencial (login, RBAC, isolamento entre grupos, alunos, turmas) — dezenas de segundos,
// para rodar a cada alteração; o `test:quick` completo e o `test:e2e` ficam para antes do commit/release.
const SMOKE = ['auth.e2e', 'rbac', 'multi-tenant', 'students.e2e', 'classes.e2e'];
const args = process.argv.slice(2);
const smoke = args.includes('--smoke');
const filters = smoke ? SMOKE : args;
let specs = readdirSync(dir).filter((f) => f.endsWith('.e2e-spec.ts'));
if (filters.length > 0) {
  specs = specs.filter((f) => filters.some((p) => f.includes(p)));
} else {
  specs = specs.filter((f) => !f.startsWith('bootstrap'));
}
if (specs.length === 0) {
  console.error(`Nenhum spec casa com: ${filters.join(', ')}`);
  process.exit(1);
}
console.log(`test:quick -> ${specs.length} spec(s)`);

const result = spawnSync(
  process.execPath,
  [
    '--require', 'ts-node/register/transpile-only',
    '--require', path.join(dir, 'env-setup.ts'),
    '--test', '--test-concurrency=1',
    ...specs.map((f) => path.join('test', f)),
  ],
  {
    stdio: 'inherit',
    cwd: path.join(dir, '..'),
    // rootDir explícito: sem ele o ts-node em modo transpile-only reclama (TS5011) do tsconfig.
    env: { ...process.env, TS_NODE_COMPILER_OPTIONS: '{"rootDir":"."}' },
  },
);
process.exit(result.status ?? 1);
