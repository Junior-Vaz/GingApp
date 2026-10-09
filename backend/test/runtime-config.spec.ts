import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEV_JWT_SECRET,
  parseCorsOrigins,
  parseTrustProxy,
  resolveJwtSecret,
} from '../src/shared/config/runtime-config';

const PROD = { NODE_ENV: 'production' };
const DEV = { NODE_ENV: 'development' };
const STRONG = 'a'.repeat(48);

describe('resolveJwtSecret', () => {
  it('produção: falha sem JWT_SECRET (ausente, vazio e só espaços)', () => {
    for (const value of [undefined, '', '   ']) {
      assert.throws(() => resolveJwtSecret(value, PROD), /obrigatório em produção/);
    }
  });

  it('produção: recusa o valor público de dev', () => {
    assert.throws(() => resolveJwtSecret(DEV_JWT_SECRET, PROD), /valor de desenvolvimento/);
  });

  it('produção: recusa segredo curto', () => {
    assert.throws(() => resolveJwtSecret('curto', PROD), /pelo menos 32/);
  });

  it('produção: aceita segredo forte', () => {
    assert.equal(resolveJwtSecret(STRONG, PROD), STRONG);
  });

  it('dev/test: sem segredo cai no valor de dev (compatível com a suíte e2e)', () => {
    assert.equal(resolveJwtSecret(undefined, DEV), DEV_JWT_SECRET);
    assert.equal(resolveJwtSecret('', {}), DEV_JWT_SECRET);
  });

  it('dev/test: respeita segredo informado', () => {
    assert.equal(resolveJwtSecret('meu-segredo', DEV), 'meu-segredo');
  });
});

describe('parseCorsOrigins', () => {
  it('produção: falha sem CORS_ORIGINS', () => {
    for (const value of [undefined, '', ' , ']) {
      assert.throws(() => parseCorsOrigins(value, PROD), /obrigatório em produção/);
    }
  });

  it('produção: recusa "*" mesmo misturado a outras origens', () => {
    assert.throws(() => parseCorsOrigins('*', PROD), /não pode conter "\*"/);
    assert.throws(() => parseCorsOrigins('https://a.com,*', PROD), /não pode conter "\*"/);
  });

  it('produção: devolve lista normalizada (trim e sem barra final)', () => {
    assert.deepEqual(parseCorsOrigins(' https://app.x.com/ , https://painel.x.com ', PROD), [
      'https://app.x.com',
      'https://painel.x.com',
    ]);
  });

  it('dev: vazio ou "*" libera qualquer origem', () => {
    assert.equal(parseCorsOrigins(undefined, DEV), true);
    assert.equal(parseCorsOrigins('*', DEV), true);
  });

  it('dev: lista informada é respeitada', () => {
    assert.deepEqual(parseCorsOrigins('http://localhost:4173', DEV), ['http://localhost:4173']);
  });
});

describe('parseTrustProxy', () => {
  it('ausente ou vazio = não confiar (undefined)', () => {
    assert.equal(parseTrustProxy(undefined), undefined);
    assert.equal(parseTrustProxy('  '), undefined);
  });

  it('interpreta número de saltos, booleanos e valores do Express', () => {
    assert.equal(parseTrustProxy('1'), 1);
    assert.equal(parseTrustProxy('2'), 2);
    assert.equal(parseTrustProxy('true'), true);
    assert.equal(parseTrustProxy('false'), false);
    assert.equal(parseTrustProxy('loopback'), 'loopback');
  });
});
