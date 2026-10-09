import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildSlugCandidate, isForbiddenPassword, slugify } from '../src/interface/http/organizations/organizations.rules';

describe('organizations.rules — slugify', () => {
  it('kebab-case, minúsculo, sem acento nem símbolos', () => {
    assert.equal(slugify('Grupo Ginga Brasil'), 'grupo-ginga-brasil');
    assert.equal(slugify('  Capoeira Ângela & Filhos!!  '), 'capoeira-angela-filhos');
    assert.equal(slugify('Ação São João Ç'), 'acao-sao-joao-c');
    assert.equal(slugify('A__B--C   D'), 'a-b-c-d');
    assert.equal(slugify('Nº 7 (Matriz)'), 'n-7-matriz');
  });

  it('só símbolos / vazio => "grupo"', () => {
    assert.equal(slugify('!!'), 'grupo');
    assert.equal(slugify('   '), 'grupo');
    assert.equal(slugify('日本語'), 'grupo');
  });

  it('nunca passa de 54 caracteres (reserva sufixo) nem termina em hífen', () => {
    const slug = slugify('a'.repeat(53) + ' bbbbbbbbbb');
    assert.ok(slug.length <= 54, slug);
    assert.ok(!slug.endsWith('-'), slug);
    assert.match(slugify('palavra '.repeat(30)), /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });
});

describe('organizations.rules — buildSlugCandidate', () => {
  it('1 => base; n >= 2 => base-n', () => {
    assert.equal(buildSlugCandidate('ginga', 1), 'ginga');
    assert.equal(buildSlugCandidate('ginga', 2), 'ginga-2');
    assert.equal(buildSlugCandidate('ginga', 11), 'ginga-11');
  });
});

describe('organizations.rules — isForbiddenPassword', () => {
  it('recusa a senha de dev, em qualquer caixa e embutida em outra', () => {
    assert.equal(isForbiddenPassword('Dev@12345'), true);
    assert.equal(isForbiddenPassword('dev@12345'), true);
    assert.equal(isForbiddenPassword('xxDEV@12345yy'), true);
    assert.equal(isForbiddenPassword('Dev@12345!!!'), true);
  });

  it('aceita senhas normais', () => {
    assert.equal(isForbiddenPassword('Mestre#Seguro2026'), false);
    assert.equal(isForbiddenPassword('Dev@1234'), false);
  });
});
