import 'reflect-metadata'; // o Nest carrega no app; aqui os decorators rodam fora dele
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  DEFAULT_PAGE_SIZE,
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
