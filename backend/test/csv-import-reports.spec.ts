import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { buildCsv, centsToReais, CSV_BOM, neutralizeFormula, unescapeFormulaCell } from '../src/shared/csv/csv';
import {
  isValidCpf,
  normalizeText,
  parseCivilDate,
  parseStudentRow,
  parseStudentStatus,
  UnitRef,
} from '../src/interface/http/students/student-import';
import { addDays, ageOn, monthsOf, percentOf, resolvePeriod, startOfMonthShift } from '../src/interface/http/reports/report-period';

/** Regras puras da exportação/importação CSV e dos períodos dos relatórios — sem banco. */
describe('CSV: escape e proteção contra injeção de fórmula', () => {
  it('prefixa apóstrofo em =, +, -, @ iniciais e o desfaz na importação', () => {
    for (const bad of ['=1+1', '+55 11 99999-9999', '-2+3', '@SUM(A1)', ' =x', '\tcmd']) {
      assert.ok(neutralizeFormula(bad).startsWith("'"), bad);
    }
    assert.equal(neutralizeFormula('Maria =legal'), 'Maria =legal');
    assert.equal(unescapeFormulaCell("'=1+1"), '=1+1');
    assert.equal(unescapeFormulaCell("D'Ávila"), "D'Ávila");
  });

  it('BOM + separador ";" + aspas em campos com ; " ou quebra de linha + CRLF', () => {
    const csv = buildCsv(['Nome', 'Obs'], [['Ana; Souza', 'disse "oi"\nlinha 2'], ['=HYPERLINK("x")', null]]);
    assert.ok(csv.startsWith(CSV_BOM + 'Nome;Obs\r\n'));
    assert.ok(csv.includes('"Ana; Souza";"disse ""oi""\nlinha 2"\r\n'));
    assert.ok(csv.includes('"\'=HYPERLINK(""x"")";\r\n'));
    assert.equal(centsToReais(123456), '1234,56');
    assert.equal(centsToReais(5), '0,05');
  });
});

describe('Importação de alunos: validação de uma linha', () => {
  const units = new Map<string, UnitRef>([
    [normalizeText('Matriz Centro'), { id: 7, name: 'Matriz Centro', active: true }],
    [normalizeText('Filial Velha'), { id: 8, name: 'Filial Velha', active: false }],
  ]);
  const today = new Date(Date.UTC(2026, 9, 11));

  it('datas dd/mm/aaaa e aaaa-mm-dd; dia inexistente e ano < 1900 são recusados', () => {
    assert.equal(parseCivilDate('05/03/2010')?.toISOString(), '2010-03-05T00:00:00.000Z');
    assert.equal(parseCivilDate('2010-03-05')?.toISOString(), '2010-03-05T00:00:00.000Z');
    assert.equal(parseCivilDate('31/02/2010'), null);
    assert.equal(parseCivilDate('01/01/1800'), null);
    assert.equal(parseCivilDate('amanhã'), null);
  });

  it('CPF: dígitos verificadores', () => {
    assert.equal(isValidCpf('52998224725'), true);
    assert.equal(isValidCpf('52998224726'), false);
    assert.equal(isValidCpf('11111111111'), false);
  });

  it('linha válida é normalizada; situação em pt-BR; unidade por nome sem acento/caixa', () => {
    const r = parseStudentRow(
      { name: '  João   da Silva ', birthDate: '05/03/2010', email: ' JOAO@Ex.com ', phone: '(11) 91234-5678', document: '529.982.247-25', unit: 'matriz CENTRO', status: 'ex-aluno' },
      units,
      today,
    );
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.row.name, 'João da Silva');
      assert.equal(r.row.email, 'joao@ex.com');
      assert.equal(r.row.document, '529.982.247-25');
      assert.equal(r.row.unitId, 7);
      assert.equal(r.row.status, 'FORMER');
    }
    assert.equal(parseStudentStatus('Suspenso'), 'SUSPENDED');
    assert.equal(parseStudentStatus('???'), null);
  });

  it('coleta TODOS os erros da linha (nome, data futura, e-mail, telefone, CPF, unidade inativa/inexistente, situação)', () => {
    const r = parseStudentRow(
      { name: '', birthDate: '01/01/2030', email: 'x@', phone: '123', document: '123', unit: 'Filial Velha', status: 'talvez' },
      units,
      today,
    );
    assert.ok(!r.ok);
    if (!r.ok) assert.equal(r.errors.length, 7);
    const missing = parseStudentRow({ name: 'Ana', unit: 'Não existe' }, units, today);
    assert.ok(!missing.ok);
  });
});

describe('Relatórios: períodos e agregações puras', () => {
  const now = new Date('2026-10-11T15:00:00Z');
  const opts = { defaultFrom: (t: string) => addDays(t, -29), defaultTo: (t: string) => t, maxDays: 366 };

  it('padrão = últimos 30 dias (dia civil de São Paulo); to inclusivo (end exclusivo = dia seguinte)', () => {
    const p = resolvePeriod(undefined, undefined, opts, now);
    assert.deepEqual([p.from, p.to], ['2026-09-12', '2026-10-11']);
    assert.equal(p.end.toISOString(), '2026-10-12T00:00:00.000Z');
  });

  it('from > to, dia inexistente e período acima do teto => 400', () => {
    assert.throws(() => resolvePeriod('2026-10-10', '2026-10-01', opts, now), BadRequestException);
    assert.throws(() => resolvePeriod('2026-02-30', '2026-03-10', opts, now), BadRequestException);
    assert.throws(() => resolvePeriod('2020-01-01', '2026-01-01', opts, now), BadRequestException);
  });

  it('meses contínuos, percentuais e faixa etária', () => {
    assert.deepEqual(monthsOf({ from: '2026-11-15', to: '2027-02-01' }), ['2026-11', '2026-12', '2027-01', '2027-02']);
    assert.equal(startOfMonthShift('2026-10-11', 5), '2026-05-01');
    assert.equal(percentOf(1, 3), 33.3);
    assert.equal(percentOf(0, 0), null);
    assert.equal(ageOn(new Date('2010-10-12T00:00:00Z'), '2026-10-11'), 15);
    assert.equal(ageOn(new Date('2010-10-11T00:00:00Z'), '2026-10-11'), 16);
  });
});
