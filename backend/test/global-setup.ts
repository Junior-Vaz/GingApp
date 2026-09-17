import { execSync } from 'node:child_process';

/**
 * Roda uma vez antes da suíte e2e (chamado pelo script npm `test:e2e`, não pelo test runner
 * em si). Garante que o schema está migrado e que o seed base (matriz RolePermission,
 * organização/usuários de exemplo) existe no Postgres apontado por DATABASE_URL — os specs
 * reaproveitam esses dados em vez de duplicar a criação.
 *
 * Pré-requisito: `docker compose up -d postgres` já rodando (mesmo Postgres do dev).
 */
execSync('npx prisma migrate deploy', { cwd: __dirname + '/..', stdio: 'inherit' });
execSync('npx prisma db seed', { cwd: __dirname + '/..', stdio: 'inherit' });
