import 'reflect-metadata'; // o Nest carrega no app; aqui os decorators rodam fora dele
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { civilDateRange } from '../src/shared/dates/date-range';
import {
  DEFAULT_PAGE_SIZE,
  LimitOffsetQueryDto,
  MAX_PAGE_SIZE,
  PageQueryDto,
  TOTAL_COUNT_HEADER,
  pageArgs,
  sendPage,
} from '../src/shared/pagination/pagination';

const parse = (raw: Record<string, string>) => {
  const dto = plainToInstance(PageQueryDto, raw);
  return { dto, errors: validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }) };
};

describe('pageArgs', () => {
  it('sem limit/offset mantém o comportamento antigo (take 50, skip 0)', () => {
    assert.deepEqual(pageArgs({}), { take: DEFAULT_PAGE_SIZE, skip: 0 });
    assert.equal(DEFAULT_PAGE_SIZE, 50);
  });

  it('respeita limit e offset informados', () => {
    assert.deepEqual(pageArgs({ limit: 20, offset: 40 }), { take: 20, skip: 40 });
  });
});

describe('PageQueryDto (query string chega como texto)', () => {
  it('converte limit/offset de string para número', () => {
    const { dto, errors } = parse({ limit: '25', offset: '50' });
    assert.equal(errors.length, 0);
    assert.equal(dto.limit, 25);
    assert.equal(dto.offset, 50);
  });

  it('aceita o teto e recusa acima dele', () => {
    assert.equal(parse({ limit: String(MAX_PAGE_SIZE) }).errors.length, 0);
    assert.ok(parse({ limit: String(MAX_PAGE_SIZE + 1) }).errors.length > 0);
  });

  it('recusa limit 0, negativo, offset negativo e valores não numéricos', () => {
    const invalid: Array<Record<string, string>> = [
      { limit: '0' },
      { limit: '-5' },
      { offset: '-1' },
      { limit: 'abc' },
      { offset: '1.5' },
    ];
    for (const raw of invalid) {
      assert.ok(parse(raw).errors.length > 0, JSON.stringify(raw));
    }
  });

  it('recusa q gigante (limita custo de busca)', () => {
    assert.ok(parse({ q: 'x'.repeat(101) }).errors.length > 0);
    assert.equal(parse({ q: 'x'.repeat(100) }).errors.length, 0);
  });
});

describe('sendPage', () => {
  it('escreve o total no header e devolve só os itens (corpo segue array)', () => {
    const headers: Record<string, string> = {};
    const res = { setHeader: (k: string, v: string) => void (headers[k] = v) };
    const items = sendPage(res, { items: [{ id: 1 }, { id: 2 }], total: 137 });
    assert.deepEqual(items, [{ id: 1 }, { id: 2 }]);
    assert.equal(headers[TOTAL_COUNT_HEADER], '137');
  });
});

describe('LimitOffsetQueryDto (rotas "/me" sem busca textual)', () => {
  const parseLO = (raw: Record<string, string>) =>
    validateSync(plainToInstance(LimitOffsetQueryDto, raw), { whitelist: true, forbidNonWhitelisted: true });

  it('aceita limit/offset válidos e recusa q e qualquer parâmetro desconhecido', () => {
    assert.equal(parseLO({ limit: '200', offset: '0' }).length, 0);
    assert.ok(parseLO({ limit: '201' }).length > 0);
    assert.ok(parseLO({ q: 'x' }).length > 0);
    assert.ok(parseLO({ foo: '1' }).length > 0);
  });
});

describe('civilDateRange (data civil da aula/vencimento)', () => {
  it('sem from/to não filtra; from vale desde a meia-noite UTC; to só com data inclui o dia inteiro', () => {
    assert.equal(civilDateRange(), undefined);
    assert.deepEqual(civilDateRange('2026-10-01'), { gte: new Date('2026-10-01T00:00:00.000Z') });
    assert.deepEqual(civilDateRange(undefined, '2026-10-31'), { lte: new Date('2026-10-31T23:59:59.999Z') });
    assert.deepEqual(civilDateRange('2026-10-01', '2026-10-31T12:00:00.000Z'), {
      gte: new Date('2026-10-01T00:00:00.000Z'),
      lte: new Date('2026-10-31T12:00:00.000Z'),
    });
  });
});
