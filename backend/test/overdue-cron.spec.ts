import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, it } from 'node:test';
import { Test } from '@nestjs/testing';
import { ScheduleModule, SchedulerRegistry } from '@nestjs/schedule';
import { FinanceOverdueService } from '../src/interface/http/finance/finance-overdue.service';
import {
  isOverdueCronEnabled,
  OVERDUE_CRON_EXPRESSION,
  OVERDUE_CRON_NAME,
  OVERDUE_CRON_TIMEZONE,
  OVERDUE_MAX_BATCHES,
  OverdueCronService,
} from '../src/jobs/overdue-cron.service';

/**
 * E07/E09: job diario da mensalidade vencida. Testes de UNIDADE (sem banco, sem esperar o relogio):
 * o registro do cron no agendador real (@nestjs/schedule) com um FinanceOverdueService falso, a execucao
 * do corpo do job, o desligamento por OVERDUE_CRON=false e a fiacao do AppModule (processo filho).
 */
interface Call {
  organizationId: number | undefined;
}

function fakeOverdue(results: { marked: number; notified: number; hasMore: boolean }[]) {
  const calls: Call[] = [];
  let i = 0;
  const service = {
    markOverdueAndNotify: async (organizationId?: number) => {
      calls.push({ organizationId });
      const result = results[Math.min(i, results.length - 1)];
      i += 1;
      return result;
    },
  } as unknown as FinanceOverdueService;
  return { service, calls };
}

async function withEnv<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.OVERDUE_CRON;
  if (value === undefined) delete process.env.OVERDUE_CRON;
  else process.env.OVERDUE_CRON = value;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.OVERDUE_CRON;
    else process.env.OVERDUE_CRON = previous;
  }
}

describe('job diário de mensalidade vencida (unidade)', () => {
  it('constantes: todo dia às 03:00 no fuso de São Paulo', () => {
    assert.equal(OVERDUE_CRON_EXPRESSION, '0 3 * * *');
    assert.equal(OVERDUE_CRON_TIMEZONE, 'America/Sao_Paulo');
  });

  it('isOverdueCronEnabled: ligado por padrão; só "false" desliga', () => {
    assert.equal(isOverdueCronEnabled({}), true);
    assert.equal(isOverdueCronEnabled({ OVERDUE_CRON: 'true' }), true);
    assert.equal(isOverdueCronEnabled({ OVERDUE_CRON: '' }), true);
    assert.equal(isOverdueCronEnabled({ OVERDUE_CRON: 'false' }), false);
  });

  it('o @Cron é registrado no agendador real (nome, expressão e fuso) e disparar o job chama markOverdueAndNotify() para TODAS as organizações', async () => {
    const { service, calls } = fakeOverdue([{ marked: 3, notified: 5, hasMore: false }]);
    const moduleRef = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot()],
      providers: [OverdueCronService, { provide: FinanceOverdueService, useValue: service }],
    }).compile();
    try {
      await moduleRef.init(); // onApplicationBootstrap: o SchedulerOrchestrator monta os @Cron
      const registry = moduleRef.get(SchedulerRegistry);
      const job = registry.getCronJob(OVERDUE_CRON_NAME);
      assert.equal(job.cronTime.source, '0 3 * * *');
      assert.equal(job.cronTime.timeZone, 'America/Sao_Paulo');
      const next = job.nextDate().setZone('America/Sao_Paulo');
      assert.deepEqual([next.hour, next.minute], [3, 0], 'a próxima execução cai às 03:00 de São Paulo');
      assert.equal(calls.length, 0, 'registrar não executa nada: o job só roda no horário');

      // Dispara o callback do cron sem esperar o relógio (a "tick" real chama exatamente isto).
      await withEnv(undefined, async () => {
        await job.fireOnTick();
      });
      assert.equal(calls.length, 1);
      assert.equal(calls[0].organizationId, undefined, 'sem organizationId = todas as organizações');
    } finally {
      await moduleRef.close();
    }
  });

  it('run(): repete enquanto hasMore e soma os totais; respeita o teto de lotes', async () => {
    const { service, calls } = fakeOverdue([
      { marked: 1000, notified: 10, hasMore: true },
      { marked: 1000, notified: 20, hasMore: true },
      { marked: 7, notified: 1, hasMore: false },
    ]);
    const cron = new OverdueCronService(service);
    const summary = await withEnv(undefined, () => cron.run());
    assert.deepEqual(summary, { marked: 2007, notified: 31, batches: 3 });
    assert.equal(calls.length, 3);
    assert.ok(calls.every((c) => c.organizationId === undefined));

    const endless = fakeOverdue([{ marked: 1, notified: 0, hasMore: true }]);
    const capped = await withEnv(undefined, () => new OverdueCronService(endless.service).run());
    assert.equal(capped?.batches, OVERDUE_MAX_BATCHES);
    assert.equal(endless.calls.length, OVERDUE_MAX_BATCHES);
  });

  it('OVERDUE_CRON=false: run() não chama o serviço', async () => {
    const { service, calls } = fakeOverdue([{ marked: 1, notified: 1, hasMore: false }]);
    const result = await withEnv('false', () => new OverdueCronService(service).run());
    assert.equal(result, null);
    assert.equal(calls.length, 0);
  });

  it('falha do serviço é engolida (logada) e a próxima execução ainda roda; execuções simultâneas não se atropelam', async () => {
    let attempts = 0;
    const flaky = {
      markOverdueAndNotify: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('banco fora');
        return { marked: 1, notified: 0, hasMore: false };
      },
    } as unknown as FinanceOverdueService;
    const cron = new OverdueCronService(flaky);
    assert.equal(await withEnv(undefined, () => cron.run()), null); // não lança
    assert.deepEqual(await withEnv(undefined, () => cron.run()), { marked: 1, notified: 0, batches: 1 });

    let release: () => void = () => undefined;
    let started = 0;
    const slow = {
      markOverdueAndNotify: async () => {
        started += 1;
        await new Promise<void>((resolve) => (release = resolve));
        return { marked: 0, notified: 0, hasMore: false };
      },
    } as unknown as FinanceOverdueService;
    const slowCron = new OverdueCronService(slow);
    const first = withEnv(undefined, () => slowCron.run());
    await new Promise((r) => setImmediate(r));
    assert.equal(await withEnv(undefined, () => slowCron.run()), null, 'segunda execução simultânea é ignorada');
    release();
    await first;
    assert.equal(started, 1);
  });

  it('fiação do AppModule: ScheduleModule + JobsModule só entram quando algum job (OVERDUE_CRON / AUDIT_RETENTION_CRON / UPLOADS_GC) não é "false"', () => {
    const root = path.join(__dirname, '..');
    const script = `
      const { AppModule } = require('./src/app.module');
      const names = (Reflect.getMetadata('imports', AppModule) || []).map((m) => (m && (m.module ? m.module.name : m.name)) || '');
      process.stdout.write(JSON.stringify({ schedule: names.includes('ScheduleModule'), jobs: names.includes('JobsModule') }));
    `;
    const run = (value: string | undefined) => {
      const env: NodeJS.ProcessEnv = { ...process.env, TS_NODE_COMPILER_OPTIONS: '{"rootDir":"."}' };
      // Os 3 jobs semanais/diarios compartilham o agendador: o JobsModule so sai quando TODOS estao desligados.
      for (const key of ['OVERDUE_CRON', 'AUDIT_RETENTION_CRON', 'UPLOADS_GC']) {
        if (value === undefined) delete env[key];
        else env[key] = value;
      }
      const res = spawnSync(
        process.execPath,
        ['--require', 'ts-node/register/transpile-only', '-e', script],
        { cwd: root, env, encoding: 'utf8' },
      );
      assert.equal(res.status, 0, res.stderr);
      return JSON.parse(res.stdout.trim().split('\n').pop() ?? '{}') as { schedule: boolean; jobs: boolean };
    };
    assert.deepEqual(run('false'), { schedule: false, jobs: false });
    assert.deepEqual(run(undefined), { schedule: true, jobs: true });
    assert.deepEqual(run('true'), { schedule: true, jobs: true });
  });
});
