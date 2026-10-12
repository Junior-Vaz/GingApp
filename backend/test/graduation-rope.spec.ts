import { BadRequestException } from '@nestjs/common';
import { RopeStyle } from '@prisma/client';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GRADUATION_TEMPLATES } from '../src/interface/http/graduations/graduation-templates';
import {
  DEFAULT_ROPE_COLOR,
  MAX_LEVELS_PER_SYSTEM,
  levelView,
  normalizeHex,
  resolveRope,
  withRope,
} from '../src/interface/http/graduations/rope';

/**
 * Cordas multicoloridas (rope.ts): regras de cor por estilo, normalização de hex, tolerância a linhas legadas
 * e invariantes dos modelos estáticos (graduation-templates.ts). Sem banco.
 */
const { SOLID, SPLIT, BRAIDED } = RopeStyle;
const bad = (fn: () => unknown) => assert.throws(fn, BadRequestException);

describe('resolveRope (cores por estilo)', () => {
  it('SOLID exige exatamente 1 cor; SPLIT e BRAIDED aceitam 2 ou 3', () => {
    assert.deepEqual(resolveRope({ style: SOLID, colors: ['#16a34a'] }), { style: SOLID, colors: ['#16A34A'], color: '#16A34A' });
    bad(() => resolveRope({ style: SOLID, colors: ['#16A34A', '#FACC15'] }));
    bad(() => resolveRope({ style: SPLIT, colors: ['#16A34A'] }));
    bad(() => resolveRope({ style: BRAIDED, colors: ['#16A34A'] }));
    assert.equal(resolveRope({ style: SPLIT, colors: ['#16A34A', '#FACC15'] }).colors.length, 2);
    assert.equal(resolveRope({ style: BRAIDED, colors: ['#16A34A', '#FACC15', '#2563EB'] }).colors.length, 3);
    bad(() => resolveRope({ style: BRAIDED, colors: ['#16A34A', '#FACC15', '#2563EB', '#FFFFFF'] }));
    bad(() => resolveRope({ style: SPLIT, colors: [] }));
  });

  it('só `color` (legado) vira SOLID; color = colors[0] sempre; `colors` vence `color`', () => {
    assert.deepEqual(resolveRope({ color: '#abc' }), { style: SOLID, colors: ['#AABBCC'], color: '#AABBCC' });
    const both = resolveRope({ style: SPLIT, colors: ['#111111', '#EEEEEE'], color: '#FF0000' });
    assert.equal(both.color, '#111111');
    // sem nada: cinza neutro
    assert.deepEqual(resolveRope({}).colors, [DEFAULT_ROPE_COLOR]);
    // só `color` com estilo que pede 2+ cores = 400
    bad(() => resolveRope({ style: SPLIT, color: '#16A34A' }));
  });

  it('hex inválido e cores consecutivas idênticas dão 400; a mesma cor em posições não vizinhas pode', () => {
    for (const color of ['verde', '#12345', '#GGGGGG', '16A34A', '', '#1234567']) {
      bad(() => resolveRope({ style: SOLID, colors: [color] }));
    }
    bad(() => resolveRope({ style: SPLIT, colors: ['#16A34A', '#16a34a'] }));
    bad(() => resolveRope({ style: BRAIDED, colors: ['#16A34A', '#FACC15', '#FACC15'] }));
    assert.deepEqual(resolveRope({ style: BRAIDED, colors: ['#16A34A', '#FACC15', '#16A34A'] }).colors, ['#16A34A', '#FACC15', '#16A34A']);
  });

  it('edição: só style/colors reaproveita o que falta do estado atual', () => {
    const current = { style: SPLIT, colors: ['#16A34A', '#FACC15'], color: '#16A34A' };
    // só style SOLID com 2 cores atuais = 400 (informe a cor)
    bad(() => resolveRope({ style: SOLID }, current));
    // só `colors` mantém o estilo atual
    assert.equal(resolveRope({ colors: ['#000000', '#FFFFFF', '#FF0000'] }, current).style, SPLIT);
    // só `color` vira SOLID
    assert.deepEqual(resolveRope({ color: '#123456' }, current), { style: SOLID, colors: ['#123456'], color: '#123456' });
  });
});

describe('normalizeHex / withRope / levelView', () => {
  it('normaliza para #RRGGBB maiúsculo e rejeita lixo', () => {
    assert.equal(normalizeHex('#fff'), '#FFFFFF');
    assert.equal(normalizeHex(' #e8dfc8 '), '#E8DFC8');
    assert.equal(normalizeHex('azul'), null);
    assert.equal(normalizeHex(null), null);
  });

  it('linha legada sem colors/style deriva do color; sem cor nenhuma usa o cinza neutro', () => {
    assert.deepEqual(withRope({ color: '#22c55e' }), { color: '#22C55E', style: SOLID, colors: ['#22C55E'] });
    assert.deepEqual(withRope({ color: null, style: SOLID, colors: [] }), { color: DEFAULT_ROPE_COLOR, style: SOLID, colors: [DEFAULT_ROPE_COLOR] });
    const v = levelView({ id: 1, name: 'X', order: 2, color: null, style: BRAIDED, colors: ['#111111', '#222222'] });
    assert.deepEqual(v, { id: 1, name: 'X', order: 2, color: '#111111', style: BRAIDED, colors: ['#111111', '#222222'] });
  });
});

describe('modelos de graduação (templates)', () => {
  it('tem ~5 modelos genéricos com código único, e cada um respeita as regras de corda', () => {
    assert.ok(GRADUATION_TEMPLATES.length >= 5);
    assert.equal(new Set(GRADUATION_TEMPLATES.map((t) => t.code)).size, GRADUATION_TEMPLATES.length);
    for (const t of GRADUATION_TEMPLATES) {
      assert.ok(t.name && t.description, t.code);
      assert.ok(t.levels.length >= 1 && t.levels.length <= MAX_LEVELS_PER_SYSTEM, `${t.code}: ${t.levels.length} níveis`);
      assert.equal(new Set(t.levels.map((l) => l.name)).size, t.levels.length, `${t.code}: nomes de nível repetidos`);
      for (const l of t.levels) {
        // passa pelo MESMO validador do create de nível, sem alterar as cores (já canônicas)
        const rope = resolveRope({ style: l.style, colors: l.colors });
        assert.deepEqual(rope.colors, l.colors, `${t.code}/${l.name}`);
      }
    }
  });

  it('os modelos cobrem lisas, divididas e trançadas (inclusive com 3 cores)', () => {
    const all = GRADUATION_TEMPLATES.flatMap((t) => t.levels);
    for (const style of [SOLID, SPLIT, BRAIDED]) assert.ok(all.some((l) => l.style === style), style);
    assert.ok(all.some((l) => l.style !== SOLID && l.colors.length === 3));
  });
});
