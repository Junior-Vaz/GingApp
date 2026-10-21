import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Test } from '@nestjs/testing';
import { ScheduleModule, SchedulerRegistry } from '@nestjs/schedule';
import {
  addDays,
  birthdayFallsOn,
  completedAge,
  datesFrom,
  greetingName,
  isLeapYear,
  normalizeBrazilPhone,
  occurrenceInYear,
  renderGreeting,
  saoPauloNow,
  startOfSaoPauloDay,
  turnsAgeInYear,
  whatsappLink,
  DEFAULT_GREETING_MESSAGE,
} from '../src/interface/http/birthdays/birthday-dates';
import { BirthdayAutomationService, digestBody } from '../src/interface/http/birthdays/birthday-automation.service';
import {
  BIRTHDAY_DIGEST_CRON_EXPRESSION,
  BIRTHDAY_DIGEST_CRON_NAME,
  BIRTHDAY_GREETING_CRON_EXPRESSION,
  BIRTHDAY_GREETING_CRON_NAME,
  BirthdaysCronService,
  isBirthdayCronEnabled,
} from '../src/jobs/birthdays-cron.service';

/** Aniversariantes: regras PURAS (29/02, idade, fuso, telefone) e o agendamento dos jobs. Sem banco. */
const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('aniversariantes: datas e idade (unidade)', () => {
  it('29/02 em ano nao bissexto comemora em 28/02; em bissexto fica em 29/02', () => {
    assert.equal(isLeapYear(2024), true);
    assert.equal(isLeapYear(2100), false);
    assert.equal(isLeapYear(2000), true);
    assert.deepEqual(occurrenceInYear(2, 29, 2026), { month: 2, day: 28 });
    assert.deepEqual(occurrenceInYear(2, 29, 2028), { month: 2, day: 29 });
    assert.deepEqual(occurrenceInYear(3, 1, 2026), { month: 3, day: 1 });
    assert.equal(birthdayFallsOn(2, 29, { year: 2026, month: 2, day: 28 }), true);
    assert.equal(birthdayFallsOn(2, 29, { year: 2026, month: 3, day: 1 }), false);
    assert.equal(birthdayFallsOn(2, 29, { year: 2028, month: 2, day: 28 }), false);
    assert.equal(birthdayFallsOn(2, 29, { year: 2028, month: 2, day: 29 }), true);
    assert.equal(birthdayFallsOn(2, 28, { year: 2026, month: 2, day: 28 }), true);
  });

  it('idade completa so sobe NO dia do aniversario; "faz" = ano - ano de nascimento', () => {
    const born = utc('2008-10-21');
    assert.equal(completedAge(born, { year: 2026, month: 10, day: 20 }), 17);
    assert.equal(completedAge(born, { year: 2026, month: 10, day: 21 }), 18);
    assert.equal(turnsAgeInYear(born, 2026), 18);
    // nascido em 29/02/2008: em 2026 (nao bissexto) faz anos em 28/02
    const leapling = utc('2008-02-29');
    assert.equal(completedAge(leapling, { year: 2026, month: 2, day: 27 }), 17);
    assert.equal(completedAge(leapling, { year: 2026, month: 2, day: 28 }), 18);
  });

  it('aritmetica de datas civis atravessa mes e ano', () => {
    assert.deepEqual(addDays({ year: 2026, month: 12, day: 30 }, 3), { year: 2027, month: 1, day: 2 });
    assert.deepEqual(datesFrom({ year: 2026, month: 2, day: 26 }, 4).map((d) => `${d.month}/${d.day}`), ['2/26', '2/27', '2/28', '3/1']);
    assert.equal(datesFrom({ year: 2026, month: 1, day: 1 }, 7).length, 7);
  });

  it('fuso de Sao Paulo: 02:30 UTC ainda e o dia anterior; inicio do dia civil e 03:00 UTC', () => {
    const now = new Date('2026-10-21T02:30:00.000Z'); // 23:30 de 20/10 em SP
    assert.deepEqual(saoPauloNow(now), { year: 2026, month: 10, day: 20, hour: 23, minute: 30 });
    assert.equal(startOfSaoPauloDay(now).toISOString(), '2026-10-20T03:00:00.000Z');
    const noon = new Date('2026-10-21T15:00:00.000Z'); // 12:00 SP
    assert.equal(saoPauloNow(noon).hour, 12);
    assert.equal(startOfSaoPauloDay(noon).toISOString(), '2026-10-21T03:00:00.000Z');
  });
});

describe('aniversariantes: telefone e mensagem (unidade)', () => {
  it('normaliza telefone BR: so digitos, prefixo 55 se faltar, invalido = null', () => {
    assert.equal(normalizeBrazilPhone('(61) 99999-1234'), '5561999991234');
    assert.equal(normalizeBrazilPhone('+55 61 99999-1234'), '5561999991234');
    assert.equal(normalizeBrazilPhone('61 3333-4444'), '556133334444');
    assert.equal(normalizeBrazilPhone('055 (11) 98888-7777'), '5511988887777', 'zero de tronco + 55 ja presente');
    assert.equal(normalizeBrazilPhone('(55) 99999-1234'), '5555999991234', 'DDD 55 (11 digitos) leva o prefixo do pais');
    assert.equal(normalizeBrazilPhone('12345'), null);
    assert.equal(normalizeBrazilPhone(''), null);
    assert.equal(normalizeBrazilPhone(null), null);
  });

  it('whatsappLink: wa.me com texto codificado; sem telefone valido = null', () => {
    const url = whatsappLink('(61) 99999-1234', 'Parabéns, Ana! 🎉');
    assert.equal(url, `https://wa.me/5561999991234?text=${encodeURIComponent('Parabéns, Ana! 🎉')}`);
    assert.equal(whatsappLink(null, 'x'), null);
    assert.equal(whatsappLink('123', 'x'), null);
  });

  it('mensagem padrao: {nome} = apelido ou primeiro nome, {grupo} = nome do grupo', () => {
    assert.equal(greetingName('Ana Maria Souza', null), 'Ana');
    assert.equal(greetingName('Ana Maria Souza', ' Pantera '), 'Pantera');
    assert.equal(
      renderGreeting(DEFAULT_GREETING_MESSAGE, { nome: 'Ana', grupo: 'Ginga Brasil' }),
      'Parabéns, Ana! 🎉 A família Ginga Brasil deseja um ótimo dia.',
    );
    assert.equal(renderGreeting('Oi {nome}, {nome}! {outro}', { nome: 'Bia', grupo: 'G' }), 'Oi Bia, Bia! {outro}');
  });

  it('resumo diario: nomes (ate 3) e "e mais N"; singular/plural', () => {
    assert.equal(digestBody(['Ana']), 'Hoje: 1 aniversariante (Ana).');
    assert.equal(digestBody(['Ana', 'Bia']), 'Hoje: 2 aniversariantes (Ana e Bia).');
    assert.equal(digestBody(['Ana', 'Bia', 'Caio']), 'Hoje: 3 aniversariantes (Ana, Bia e Caio).');
    assert.equal(digestBody(['Ana', 'Bia', 'Caio', 'Dani', 'Edu']), 'Hoje: 5 aniversariantes (Ana, Bia, Caio e mais 2).');
  });
});

describe('aniversariantes: jobs (unidade)', () => {
  const withEnv = async <T>(value: string | undefined, fn: () => Promise<T>): Promise<T> => {
    const previous = process.env.BIRTHDAY_CRON;
    if (value === undefined) delete process.env.BIRTHDAY_CRON;
    else process.env.BIRTHDAY_CRON = value;
    try {
      return await fn();
    } finally {
      if (previous === undefined) delete process.env.BIRTHDAY_CRON;
      else process.env.BIRTHDAY_CRON = previous;
    }
  };

  const fakeAutomation = () => {
    const calls: string[] = [];
    const service = {
      sendDailyDigests: async () => (calls.push('digest'), { organizations: 1, notified: 2 }),
      sendAutoGreetings: async () => (calls.push('greet'), { organizations: 1, greeted: 3 }),
    } as unknown as BirthdayAutomationService;
    return { service, calls };
  };

  it('BIRTHDAY_CRON: ligado por padrao; so "false" desliga', () => {
    assert.equal(isBirthdayCronEnabled({}), true);
    assert.equal(isBirthdayCronEnabled({ BIRTHDAY_CRON: 'true' }), true);
    assert.equal(isBirthdayCronEnabled({ BIRTHDAY_CRON: 'false' }), false);
  });

  it('os dois @Cron entram no agendador real: 07:30 e inicio de hora, fuso de Sao Paulo; disparar chama o servico', async () => {
    const { service, calls } = fakeAutomation();
    const moduleRef = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot()],
      providers: [BirthdaysCronService, { provide: BirthdayAutomationService, useValue: service }],
    }).compile();
    try {
      await moduleRef.init();
      const registry = moduleRef.get(SchedulerRegistry);
      const digest = registry.getCronJob(BIRTHDAY_DIGEST_CRON_NAME);
      assert.equal(digest.cronTime.source, BIRTHDAY_DIGEST_CRON_EXPRESSION);
      assert.equal(digest.cronTime.timeZone, 'America/Sao_Paulo');
      const next = digest.nextDate().setZone('America/Sao_Paulo');
      assert.deepEqual([next.hour, next.minute], [7, 30]);
      const hourly = registry.getCronJob(BIRTHDAY_GREETING_CRON_NAME);
      assert.equal(hourly.cronTime.source, BIRTHDAY_GREETING_CRON_EXPRESSION);
      assert.equal(hourly.cronTime.timeZone, 'America/Sao_Paulo');
      assert.equal(calls.length, 0, 'registrar nao executa nada');
      await withEnv(undefined, async () => {
        await digest.fireOnTick();
        await hourly.fireOnTick();
      });
      assert.deepEqual(calls, ['digest', 'greet']);
    } finally {
      await moduleRef.close();
    }
  });

  it('BIRTHDAY_CRON=false: run* nao chama o servico; erro do servico e engolido; execucao simultanea e ignorada', async () => {
    const { service, calls } = fakeAutomation();
    const cron = new BirthdaysCronService(service);
    assert.equal(await withEnv('false', () => cron.runDigest()), null);
    assert.equal(await withEnv('false', () => cron.runAutoGreeting()), null);
    assert.equal(calls.length, 0);

    const failing = new BirthdaysCronService({ sendDailyDigests: async () => { throw new Error('banco fora'); } } as unknown as BirthdayAutomationService);
    assert.equal(await withEnv(undefined, () => failing.runDigest()), null, 'nao lanca');

    let release: () => void = () => undefined;
    let started = 0;
    const slow = new BirthdaysCronService({
      sendAutoGreetings: async () => {
        started += 1;
        await new Promise<void>((resolve) => (release = resolve));
        return { organizations: 0, greeted: 0 };
      },
    } as unknown as BirthdayAutomationService);
    const first = withEnv(undefined, () => slow.runAutoGreeting());
    await new Promise((r) => setImmediate(r));
    assert.equal(await withEnv(undefined, () => slow.runAutoGreeting()), null);
    release();
    await first;
    assert.equal(started, 1);
  });
});
