import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  mediaExpiry,
  mediaSignature,
  parseSignedParams,
  signedMediaUrl,
  verifyMediaSignature,
} from '../src/interface/http/feed/feed-media-storage';
import {
  ageOn,
  cleanBlockedWords,
  containsBlockedWord,
  decodeCursor,
  encodeCursor,
  foldForMatch,
  normalizeUserText,
  startOfDaySaoPaulo,
} from '../src/interface/http/feed/feed-text';

/** Feed do grupo: funcoes puras (URL assinada, texto puro, palavras bloqueadas, cursor, idade). */
describe('feed (unidade)', () => {
  const key = Buffer.alloc(32, 7);
  const now = Date.UTC(2026, 9, 21, 15, 0, 0);

  it('URL assinada: presa a grupo + midia + variante + expiracao; adulterar qualquer parte falha', () => {
    const e = mediaExpiry(now, 6 * 3600_000);
    assert.ok(e * 1000 >= now + 6 * 3600_000 && e * 1000 < now + 7 * 3600_000, 'expira entre TTL e TTL + 1 h (hora cheia)');
    assert.equal(e % 3600, 0);
    const s = mediaSignature(5, 42, 'full', e, key);
    assert.match(s, /^[A-Za-z0-9_-]{43}$/);
    assert.ok(verifyMediaSignature(5, 42, 'full', e, s, key));
    assert.equal(verifyMediaSignature(6, 42, 'full', e, s, key), false, 'outro grupo');
    assert.equal(verifyMediaSignature(5, 43, 'full', e, s, key), false, 'outra midia');
    assert.equal(verifyMediaSignature(5, 42, 'thumb', e, s, key), false, 'outra variante');
    assert.equal(verifyMediaSignature(5, 42, 'full', e + 3600, s, key), false, 'outra expiracao');
    assert.equal(verifyMediaSignature(5, 42, 'full', e, s.slice(0, 42) + (s[42] === 'A' ? 'B' : 'A'), key), false, 'assinatura adulterada');
    assert.equal(verifyMediaSignature(5, 42, 'full', e, s.slice(0, 20), key), false, 'tamanho diferente nao lanca (timingSafeEqual protegido)');
    assert.equal(verifyMediaSignature(5, 42, 'full', e, s, Buffer.alloc(32, 8)), false, 'outro segredo');
    assert.equal(signedMediaUrl(5, 42, 'thumb', e, key), `/api/feed/media/42/thumb?e=${e}&s=${mediaSignature(5, 42, 'thumb', e, key)}`);
    // escopo de revisao (foto nao aprovada): assinatura propria, nao troca com a de membro
    const r = mediaSignature(5, 42, 'full', e, key, 'review');
    assert.notEqual(r, s);
    assert.ok(verifyMediaSignature(5, 42, 'full', e, r, key, 'review'));
    assert.equal(verifyMediaSignature(5, 42, 'full', e, r, key, 'member'), false);
    assert.equal(verifyMediaSignature(5, 42, 'full', e, s, key, 'review'), false);
    assert.match(signedMediaUrl(5, 42, 'full', e, key, 'review'), /&r=1$/);
  });

  it('URL de revisao: 30-35 min, nunca alem disso', () => {
    const e = mediaExpiry(now, undefined, 'review');
    assert.ok(e * 1000 >= now + 30 * 60_000 && e * 1000 <= now + 35 * 60_000);
    assert.equal(parseSignedParams(String(e), 'a'.repeat(43), now, '1')?.scope, 'review');
    const sixHours = mediaExpiry(now, 6 * 3600_000);
    assert.equal(parseSignedParams(String(sixHours), 'a'.repeat(43), now, '1'), null, 'review com validade longa recusada');
    assert.equal(parseSignedParams(String(e), 'a'.repeat(43), now, '2'), null);
    assert.equal(parseSignedParams(String(e), 'a'.repeat(43), now, ['1']), null);
  });

  it('parametros da URL: formato estrito, expirada e longe demais no futuro recusadas', () => {
    const e = mediaExpiry(now, 6 * 3600_000);
    const s = 'a'.repeat(43);
    assert.deepEqual(parseSignedParams(String(e), s, now), { expiresAtSec: e, signature: s, scope: 'member' });
    assert.equal(parseSignedParams(String(Math.floor(now / 1000) - 1), s, now), null, 'expirada');
    assert.equal(parseSignedParams(String(Math.floor(now / 1000) + 30 * 86400), s, now), null, 'futuro alem de 7 dias');
    assert.equal(parseSignedParams(`${e}x`, s, now), null);
    assert.equal(parseSignedParams(String(e), `${s}=`, now), null);
    assert.equal(parseSignedParams(undefined, s, now), null);
    assert.equal(parseSignedParams([String(e)], s, now), null, 'array (query repetida)');
  });

  it('texto puro: normaliza espacos/linhas, remove invisiveis e controle, nao interpreta HTML', () => {
    assert.equal(normalizeUserText('  oi   tudo\t bem  \r\n\r\n\r\n\r\nlinha 2  '), 'oi tudo bem\n\nlinha 2');
    assert.equal(normalizeUserText('a​b‮c\u0007d'), 'abcd');
    assert.equal(normalizeUserText('<script>alert(1)</script>'), '<script>alert(1)</script>', 'guardado como TEXTO, nunca executado');
    assert.equal(normalizeUserText('   \n\t '), null);
    assert.equal(normalizeUserText('uma\nduas', false), 'uma duas');
    assert.equal(normalizeUserText(undefined), null);
  });

  it('palavras bloqueadas: sem acento/caixa, palavra inteira, expressao com pontuacao no meio', () => {
    assert.equal(foldForMatch('ÁRVORE, Ação!'), 'arvore acao');
    const words = cleanBlockedWords(['Idiota', ' idióta ', '', 'pau mole', 'cu']);
    assert.deepEqual(words, ['Idiota', 'pau mole', 'cu'], 'repetida pela forma de comparacao sai');
    assert.ok(containsBlockedWord('Que IDIÓTA!', words));
    assert.ok(containsBlockedWord('isso e PAU... mole', words));
    assert.ok(containsBlockedWord('cu', words));
    assert.equal(containsBlockedWord('cultura e capoeira', words), false, 'nao casa pedaco de palavra');
    assert.equal(containsBlockedWord('idiotas', words), false, 'limitacao documentada: plural nao casa');
    assert.equal(containsBlockedWord(null, words), false);
    assert.equal(containsBlockedWord('idiota', []), false);
  });

  it('cursor: ida e volta; lixo/adulterado = null', () => {
    const c = { pinned: true, createdAt: new Date('2026-10-21T12:34:56.789Z'), id: 77 };
    assert.deepEqual(decodeCursor(encodeCursor(c)), c);
    assert.equal(decodeCursor('não-base64!'), null);
    assert.equal(decodeCursor(Buffer.from('2.123.4').toString('base64url')), null);
    assert.equal(decodeCursor(Buffer.from('1.123.0').toString('base64url')), null);
    assert.equal(decodeCursor(Buffer.from('1.123.99999999999').toString('base64url')), null);
    assert.equal(decodeCursor('A'.repeat(200)), null);
  });

  it('dia civil e idade em Sao Paulo (menor de 18; 29/02)', () => {
    // 02:00 UTC de 22/10 = 23:00 de 21/10 em SP
    assert.equal(startOfDaySaoPaulo(new Date('2026-10-22T02:00:00Z')).toISOString(), '2026-10-21T03:00:00.000Z');
    assert.equal(startOfDaySaoPaulo(new Date('2026-10-22T03:00:00Z')).toISOString(), '2026-10-22T03:00:00.000Z');
    const birth = new Date('2008-10-22T00:00:00Z');
    assert.equal(ageOn(birth, new Date('2026-10-22T02:59:00Z')), 17, 'ainda 21/10 em SP');
    assert.equal(ageOn(birth, new Date('2026-10-22T03:00:00Z')), 18, 'faz 18 a meia-noite de SP');
    const leap = new Date('2008-02-29T00:00:00Z');
    assert.equal(ageOn(leap, new Date('2026-02-28T15:00:00Z')), 17, '29/02 em ano nao bissexto: conservador (so em 01/03)');
    assert.equal(ageOn(leap, new Date('2026-03-01T15:00:00Z')), 18);
  });
});
