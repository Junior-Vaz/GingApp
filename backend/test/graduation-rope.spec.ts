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
  ropeOf,
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
    assert.deepEqual(resolveRope({ style: SOLID, colors: ['#16a34a'] }), { style: SOLID, colors: ['#16A34A'], color: '#16A34A', tipStart: null, tipEnd: null });
    bad(() => resolveRope({ style: SOLID, colors: ['#16A34A', '#FACC15'] }));
    bad(() => resolveRope({ style: SPLIT, colors: ['#16A34A'] }));
    bad(() => resolveRope({ style: BRAIDED, colors: ['#16A34A'] }));
    assert.equal(resolveRope({ style: SPLIT, colors: ['#16A34A', '#FACC15'] }).colors.length, 2);
    assert.equal(resolveRope({ style: BRAIDED, colors: ['#16A34A', '#FACC15', '#2563EB'] }).colors.length, 3);
    bad(() => resolveRope({ style: BRAIDED, colors: ['#16A34A', '#FACC15', '#2563EB', '#FFFFFF'] }));
    bad(() => resolveRope({ style: SPLIT, colors: [] }));
  });

  it('só `color` (legado) vira SOLID; color = colors[0] sempre; `colors` vence `color`', () => {
    assert.deepEqual(resolveRope({ color: '#abc' }), { style: SOLID, colors: ['#AABBCC'], color: '#AABBCC', tipStart: null, tipEnd: null });
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
    const current = { style: SPLIT, colors: ['#16A34A', '#FACC15'], color: '#16A34A', tipStart: null, tipEnd: null };
    // só style SOLID com 2 cores atuais = 400 (informe a cor)
    bad(() => resolveRope({ style: SOLID }, current));
    // só `colors` mantém o estilo atual
    assert.equal(resolveRope({ colors: ['#000000', '#FFFFFF', '#FF0000'] }, current).style, SPLIT);
    // só `color` vira SOLID
    assert.deepEqual(resolveRope({ color: '#123456' }, current), { style: SOLID, colors: ['#123456'], color: '#123456', tipStart: null, tipEnd: null });
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
    assert.deepEqual(withRope({ color: '#22c55e' }), { color: '#22C55E', style: SOLID, colors: ['#22C55E'], tipStart: null, tipEnd: null });
    assert.deepEqual(withRope({ color: null, style: SOLID, colors: [] }), { color: DEFAULT_ROPE_COLOR, style: SOLID, colors: [DEFAULT_ROPE_COLOR], tipStart: null, tipEnd: null });
    const v = levelView({ id: 1, name: 'X', order: 2, color: null, style: BRAIDED, colors: ['#111111', '#222222'] });
    assert.deepEqual(v, { id: 1, name: 'X', order: 2, color: '#111111', style: BRAIDED, colors: ['#111111', '#222222'], tipStart: null, tipEnd: null });
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
        const rope = resolveRope({ style: l.style, colors: l.colors, tipStart: l.tipStart, tipEnd: l.tipEnd });
        assert.deepEqual(rope.colors, l.colors, `${t.code}/${l.name}`);
        assert.equal(rope.tipStart, l.tipStart ?? null, `${t.code}/${l.name}: ponta de cima`);
        assert.equal(rope.tipEnd, l.tipEnd ?? null, `${t.code}/${l.name}: ponta de baixo`);
      }
    }
  });

  it('os modelos cobrem lisas, divididas e trançadas (inclusive com 3 cores)', () => {
    const all = GRADUATION_TEMPLATES.flatMap((t) => t.levels);
    for (const style of [SOLID, SPLIT, BRAIDED]) assert.ok(all.some((l) => l.style === style), style);
    assert.ok(all.some((l) => l.style !== SOLID && l.colors.length === 3));
  });
});

describe('corda com pontas (tipStart/tipEnd)', () => {
  it('normaliza hex (#RGB e minusculo), aceita null/vazio para limpar e rejeita lixo', () => {
    const r = resolveRope({ style: SOLID, colors: ['#E8DFC8'], tipStart: '#0f0', tipEnd: ' #facc15 '.trim() });
    assert.equal(r.tipStart, '#00FF00');
    assert.equal(r.tipEnd, '#FACC15');
    const cleared = resolveRope({ tipStart: null, tipEnd: '' }, { ...r });
    assert.equal(cleared.tipStart, null);
    assert.equal(cleared.tipEnd, null);
    assert.equal(resolveRope({ tipStart: '   ' }, { ...r }).tipStart, null);
    for (const tip of ['verde', '#12345', '#GGGGGG', '16A34A', '#1234567']) {
      bad(() => resolveRope({ tipStart: tip }));
      bad(() => resolveRope({ tipEnd: tip }));
    }
    bad(() => resolveRope({ tipStart: 123 as unknown as string }));
  });

  it('as pontas sao independentes (so uma) e o PATCH parcial reaproveita o estado atual', () => {
    const current = resolveRope({ style: SPLIT, colors: ['#16A34A', '#FACC15'], tipStart: '#2563EB' });
    assert.equal(current.tipEnd, null);
    // mexer so no corpo mantem as pontas
    const body = resolveRope({ colors: ['#000000', '#FFFFFF'] }, current);
    assert.equal(body.tipStart, '#2563EB');
    assert.equal(body.tipEnd, null);
    // mexer so numa ponta mantem o corpo e a outra ponta
    const end = resolveRope({ tipEnd: '#16A34A' }, current);
    assert.deepEqual([end.style, end.colors, end.tipStart, end.tipEnd], [SPLIT, ['#16A34A', '#FACC15'], '#2563EB', '#16A34A']);
    // pontas nao entram na regra de cores consecutivas do corpo
    assert.equal(resolveRope({ style: SOLID, colors: ['#16A34A'], tipStart: '#16A34A', tipEnd: '#16A34A' }).tipEnd, '#16A34A');
  });

  it('withRope/levelView/ropeOf devolvem tipStart/tipEnd (null em linha legada ou valor invalido)', () => {
    assert.equal(withRope({ color: '#22c55e' }).tipStart, null);
    const v = levelView({ id: 1, name: 'X', order: 1, color: '#E8DFC8', style: SOLID, colors: ['#E8DFC8'], tipStart: '#16a34a', tipEnd: 'lixo' });
    assert.equal(v.tipStart, '#16A34A');
    assert.equal(v.tipEnd, null);
    assert.deepEqual(ropeOf({ color: null, tipEnd: '#fff' }), { color: DEFAULT_ROPE_COLOR, style: SOLID, colors: [DEFAULT_ROPE_COLOR], tipStart: null, tipEnd: '#FFFFFF' });
  });

  it('os modelos novos de corda com pontas existem e todo nivel deles tem pelo menos uma ponta', () => {
    for (const code of ['cordas-com-pontas-classicas', 'pontas-por-graduacao']) {
      const t = GRADUATION_TEMPLATES.find((x) => x.code === code);
      assert.ok(t, code);
      assert.ok(t.levels.every((l) => l.tipStart || l.tipEnd), code);
      assert.ok(t.levels.some((l) => l.tipStart && l.tipEnd && l.tipStart !== l.tipEnd), `${code}: pontas de cores diferentes`);
    }
    assert.equal(GRADUATION_TEMPLATES.find((x) => x.code === 'cordas-com-pontas-classicas')?.name, 'Cordas com pontas (cores clássicas)');
    assert.equal(GRADUATION_TEMPLATES.find((x) => x.code === 'pontas-por-graduacao')?.name, 'Pontas por graduação');
  });
});
