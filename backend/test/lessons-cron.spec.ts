import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Test } from '@nestjs/testing';
import { ScheduleModule, SchedulerRegistry } from '@nestjs/schedule';
import { ClassLessonsRollingService } from '../src/interface/http/classes/class-lessons-rolling.service';
import {
  isLessonsCronEnabled,
  LESSONS_CRON_EXPRESSION,
  LESSONS_CRON_NAME,
  LESSONS_CRON_TIMEZONE,
  LessonsCronService,
} from '../src/jobs/lessons-cron.service';

/**
 * Job diario das aulas continuas. Testes de UNIDADE (sem banco, sem esperar o relogio): registro do @Cron no agendador
 * real com um ClassLessonsRollingService falso, execucao do corpo do job, LESSONS_CRON=false e falha engolida.
 * A fiacao no AppModule (JobsModule so' entra se algum job estiver ligado) e' conferida em overdue-cron.spec.ts.
 */
const RESULT = { classes: 3, created: 12, failed: 0, from: '2026-10-12', to: '2026-12-11' };

function fakeRolling(impl?: () => Promise<typeof RESULT>) {
  const calls: unknown[] = [];
  const service = {
    ensureHorizon: async (scope: unknown) => {
      calls.push(scope);
      return impl ? impl() : RESULT;
    },
  } as unknown as ClassLessonsRollingService;
  return { service, calls };
}

async function withEnv<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.LESSONS_CRON;
  if (value === undefined) delete process.env.LESSONS_CRON;
  else process.env.LESSONS_CRON = value;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.LESSONS_CRON;
    else process.env.LESSONS_CRON = previous;
  }
}

describe('job diario das aulas continuas (unidade)', () => {
  it('constantes: todo dia as 01:30 no fuso de Sao Paulo', () => {
    assert.equal(LESSONS_CRON_EXPRESSION, '30 1 * * *');
    assert.equal(LESSONS_CRON_TIMEZONE, 'America/Sao_Paulo');
  });

  it('isLessonsCronEnabled: ligado por padrao; so "false" desliga', () => {
    assert.equal(isLessonsCronEnabled({}), true);
    assert.equal(isLessonsCronEnabled({ LESSONS_CRON: 'true' }), true);
    assert.equal(isLessonsCronEnabled({ LESSONS_CRON: '' }), true);
    assert.equal(isLessonsCronEnabled({ LESSONS_CRON: 'false' }), false);
  });

  it('o @Cron e registrado no agendador real (nome, expressao, fuso, 01:30 SP) e disparar chama ensureHorizon() para TODAS as turmas', async () => {
    const { service, calls } = fakeRolling();
    const moduleRef = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot()],
      providers: [LessonsCronService, { provide: ClassLessonsRollingService, useValue: service }],
    }).compile();
    try {
      await moduleRef.init();
      const job = moduleRef.get(SchedulerRegistry).getCronJob(LESSONS_CRON_NAME);
      assert.equal(job.cronTime.source, '30 1 * * *');
      assert.equal(job.cronTime.timeZone, 'America/Sao_Paulo');
      const next = job.nextDate().setZone('America/Sao_Paulo');
      assert.deepEqual([next.hour, next.minute], [1, 30]);
      assert.equal(calls.length, 0, 'registrar nao executa nada');

      await withEnv(undefined, async () => {
        await job.fireOnTick();
      });
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0], {}, 'sem classId nem organizationId = todas as organizacoes ativas');
    } finally {
      await moduleRef.close();
    }
  });

  it('run(): devolve o resultado; LESSONS_CRON=false nao chama o servico', async () => {
    const { service, calls } = fakeRolling();
    assert.deepEqual(await withEnv(undefined, () => new LessonsCronService(service).run()), RESULT);
    assert.equal(calls.length, 1);
    assert.equal(await withEnv('false', () => new LessonsCronService(service).run()), null);
    assert.equal(calls.length, 1);
  });

  it('falha do servico e engolida (logada) e a proxima execucao roda; execucoes simultaneas nao se atropelam', async () => {
    let attempts = 0;
    const flaky = fakeRolling(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('banco fora');
      return RESULT;
    });
    const cron = new LessonsCronService(flaky.service);
    assert.equal(await withEnv(undefined, () => cron.run()), null);
    assert.deepEqual(await withEnv(undefined, () => cron.run()), RESULT);

    let release: () => void = () => undefined;
    const slow = fakeRolling(async () => {
      await new Promise<void>((resolve) => (release = resolve));
      return RESULT;
    });
    const slowCron = new LessonsCronService(slow.service);
    const first = withEnv(undefined, () => slowCron.run());
    await new Promise((r) => setImmediate(r));
    assert.equal(await withEnv(undefined, () => slowCron.run()), null, 'segunda execucao simultanea e ignorada');
    release();
    await first;
    assert.equal(slow.calls.length, 1);
  });
});
