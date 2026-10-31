import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { inflateSync } from 'node:zlib';
import sharp from 'sharp';
import {
  CERTIFICATE_VARIABLES,
  CertificateLayout,
  CertificateLayoutError,
  FONT_KEYS,
  formatLongDateBR,
  layoutUploadRefs,
  logoRefOf,
  relativeLuminance,
  resolveGroupLogo,
  substituteVariables,
  textVariablesProblem,
  validateCertificateLayout,
} from '../src/interface/http/certificates/certificate-layout';
import { CertificatePdfData, renderCertificatePdf } from '../src/interface/http/certificates/certificate-pdf';
import { CERTIFICATE_PRESETS, CLASSIC_LAYOUT } from '../src/interface/http/certificates/certificate-presets';
import { pdfMediaBox, pdfPageCount, pdfText } from './utils/pdf-text';

/**
 * Modelos de certificado — regras PURAS (sem banco): validação do desenho (docs/CONTRATO_CERTIFICADOS_MODELOS.md secao 2),
 * variáveis (secao 3), presets válidos (secao 5), logo do grupo (secao 7) e o renderizador (PDF, orientação, fallback de
 * fonte, imagem ausente/presente, nunca 2 páginas). O comportamento HTTP está em certificate-templates.e2e-spec.ts.
 */
const UUID_FILE = () => `${randomUUID()}.webp`;

/** Desenho mínimo válido (1 texto com {codigo} + 1 QR); `extra` entra no fim de `elements`. */
function minimal(extra: unknown[] = [], over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    page: { orientation: 'landscape', background: { color: '#ffffff' } },
    elements: [
      { id: 'codigo', type: 'text', x: 10, y: 10, w: 50, h: 10, text: 'Código: {codigo}', fontKey: 'helvetica', size: 12, color: '#000000', align: 'left', vAlign: 'top', bold: false, italic: false, uppercase: false, letterSpacing: 0, lineHeight: 1.2 },
      { id: 'qr', type: 'qr', x: 80, y: 70, size: 80, fg: '#111111' },
      ...extra,
    ],
    ...over,
  };
}

function withElement(patch: (els: Record<string, unknown>[]) => void): Record<string, unknown> {
  const layout = minimal();
  patch(layout.elements as Record<string, unknown>[]);
  return layout;
}

const rejects = (raw: unknown, pattern: RegExp) =>
  assert.throws(() => validateCertificateLayout(raw), (err: unknown) => err instanceof CertificateLayoutError && pattern.test((err as Error).message));

const DATA: CertificatePdfData = {
  organizationName: 'Grupo Ginga Brasil',
  studentName: 'João Çedilha da Conceição',
  title: 'Graduação à Corda Azul',
  graduationName: 'Corda Azul',
  issuedAt: new Date('2026-03-12T00:00:00.000Z'),
  verificationCode: 'codigo-de-teste-123',
  verificationUrl: 'https://app.e2e.test/verificar/codigo-de-teste-123',
};

/** Conteúdo (descomprimido) dos streams de página do PDF: operadores gráficos (m, l, S, d, J...). */
function pdfContent(pdf: Buffer): string {
  const raw = pdf.toString('latin1');
  const parts: string[] = [];
  for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try {
      parts.push(inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1'));
    } catch {
      /* stream binário/imagem: ignora */
    }
  }
  return parts.join('\n');
}

const isPdf = (pdf: Buffer) => {
  assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.ok(pdf.subarray(-16).toString('latin1').includes('%%EOF'));
};

describe('Modelos de certificado — validação do desenho (unitário)', () => {
  it('desenho mínimo passa e sai NORMALIZADO (cor em maiúsculo, imageRef null, imageFit cover)', () => {
    const layout = validateCertificateLayout(minimal());
    assert.equal(layout.page.background.color, '#FFFFFF');
    assert.equal(layout.page.background.imageRef, null);
    assert.equal(layout.page.background.imageFit, 'cover');
    assert.equal(layout.elements.length, 2);
  });

  it('whitelist de chaves: campo extra na raiz, na página, no fundo ou no elemento = erro indicando o campo', () => {
    rejects(minimal([], { extra: 1 }), /campo desconhecido "extra"/);
    rejects({ ...minimal(), page: { orientation: 'landscape', background: { color: '#FFFFFF' }, margin: 0 } }, /Página: campo desconhecido "margin"/);
    rejects({ ...minimal(), page: { orientation: 'landscape', background: { color: '#FFFFFF', url: 'x' } } }, /Fundo: campo desconhecido "url"/);
    rejects(withElement((els) => (els[0].html = '<b>x</b>')), /Elemento "codigo" \(texto\): campo desconhecido "html"/);
    rejects(withElement((els) => delete els[0].lineHeight), /Elemento "codigo" \(texto\): campo "lineHeight" é obrigatório/);
  });

  it('versão, orientação, tipo e id', () => {
    rejects({ ...minimal(), version: 2 }, /"version" deve ser 1/);
    rejects({ ...minimal(), page: { orientation: 'square', background: { color: '#FFFFFF' } } }, /orientation/);
    rejects(withElement((els) => (els[0].type = 'svg')), /"type" deve ser um de/);
    rejects(withElement((els) => (els[0].id = 'Com Espaço')), /"id" deve ter de 1 a 40/);
    rejects(withElement((els) => (els[1].id = 'codigo')), /id repetido/);
  });

  it('cores só #RRGGBB (3 dígitos e nomes = erro); null só onde o contrato permite', () => {
    rejects(withElement((els) => (els[0].color = '#FFF')), /"color" deve ser uma cor no formato #RRGGBB/);
    rejects(withElement((els) => (els[0].color = 'red')), /#RRGGBB/);
    rejects(withElement((els) => (els[0].color = null)), /#RRGGBB/);
    const rect = { id: 'r', type: 'rect', x: 0, y: 0, w: 10, h: 10, fill: null, fillOpacity: 1, stroke: '#abcdef', strokeWidth: 1, radius: 0 };
    const ok = validateCertificateLayout(minimal([rect]));
    assert.equal((ok.elements[2] as { stroke: string }).stroke, '#ABCDEF');
  });

  it('faixas numéricas: x+w e y+h <= 100, w/h >= 1, size 6..160, lineHeight 0.8..2.5, letterSpacing 0..30, Infinity/NaN/texto = erro', () => {
    rejects(withElement((els) => (els[0].x = 60)), /x \+ w passa da largura/);
    rejects(withElement((els) => (els[0].y = 95)), /y \+ h passa da altura/);
    rejects(withElement((els) => (els[0].w = 0.5)), /"w" deve estar entre 1 e 100/);
    rejects(withElement((els) => (els[0].size = 200)), /"size" deve estar entre 6 e 160/);
    rejects(withElement((els) => (els[0].lineHeight = 3)), /"lineHeight" deve estar entre 0.8 e 2.5/);
    rejects(withElement((els) => (els[0].letterSpacing = -1)), /"letterSpacing"/);
    rejects(withElement((els) => (els[0].size = Infinity)), /"size" deve ser um número/);
    rejects(withElement((els) => (els[0].size = '12')), /"size" deve ser um número/);
    rejects(withElement((els) => (els[0].bold = 'sim')), /"bold" deve ser verdadeiro ou falso/);
    rejects(withElement((els) => (els[0].fontKey = 'comic')), /"fontKey" deve ser um de/);
  });

  it('exatamente 1 QR; QR >= 56 pt, escuro e cabendo na página', () => {
    rejects(withElement((els) => els.splice(1, 1)), /exatamente 1 QR Code/);
    rejects(minimal([{ id: 'qr2', type: 'qr', x: 0, y: 0, size: 60, fg: '#000000' }]), /exatamente 1 QR Code/);
    rejects(withElement((els) => (els[1].size = 50)), /"size" deve estar entre 56 e 220/);
    rejects(withElement((els) => (els[1].fg = '#FFFF00')), /precisa ser escura/);
    rejects(withElement((els) => Object.assign(els[1], { x: 95, size: 80 })), /precisa caber inteiro/);
    // retrato: 80% de 595 pt + 120 pt passa da largura; em paisagem (842 pt) cabe
    const portrait = withElement((els) => Object.assign(els[1], { x: 80, y: 10, size: 120 }));
    (portrait.page as { orientation: string }).orientation = 'portrait';
    rejects(portrait, /precisa caber inteiro/);
    assert.doesNotThrow(() => validateCertificateLayout(withElement((els) => Object.assign(els[1], { x: 80, y: 10, size: 120 }))));
  });

  it('ao menos 1 texto com {codigo} ou {link}', () => {
    rejects(withElement((els) => (els[0].text = 'Sem verificação {aluno}')), /\{codigo\} ou \{link\}/);
    assert.doesNotThrow(() => validateCertificateLayout(withElement((els) => (els[0].text = 'Verifique: {link}'))));
  });

  it('variáveis: desconhecida e chave solta = erro com o nome; texto vazio/só espaços = erro; > 500 = erro; normaliza como o feed', () => {
    rejects(withElement((els) => (els[0].text = '{codigo} {nome}')), /variável desconhecida \{nome\}/);
    rejects(withElement((els) => (els[0].text = '{codigo} {Aluno}')), /variável desconhecida \{Aluno\}/);
    rejects(withElement((els) => (els[0].text = '{codigo} { aluno')), /chave \{ ou \} solta/);
    rejects(withElement((els) => (els[0].text = '{codigo} }')), /chave \{ ou \} solta/);
    rejects(withElement((els) => (els[0].text = '{codigo} {}')), /variável desconhecida \{\}/);
    rejects(withElement((els) => (els[0].text = '   ')), /não pode ficar vazio/);
    rejects(withElement((els) => (els[0].text = `{codigo} ${'a'.repeat(500)}`)), /no máximo 500/);
    const ok = validateCertificateLayout(withElement((els) => (els[0].text = 'Código:\u0007   {codigo}\r\nlinha  2​')));
    assert.equal((ok.elements[0] as { text: string }).text, 'Código: {codigo}\nlinha 2');
  });

  it('imagens: só /api/uploads/<uuid>.<ext> (URL externa, "..", outro caminho = erro); máx. 8 contando o fundo; máx. 40 elementos', () => {
    const img = (id: string, ref: unknown) => ({ id, type: 'image', x: 0, y: 0, w: 10, h: 10, ref, useGroupLogo: false, fit: 'contain', opacity: 1 });
    rejects(minimal([img('i', 'https://evil.example.com/a.png')]), /"ref" deve ser o caminho devolvido por POST \/uploads/);
    rejects(minimal([img('i', '/api/uploads/../../etc/passwd')]), /POST \/uploads/);
    rejects(minimal([img('i', `/api/uploads/${randomUUID()}.svg`)]), /POST \/uploads/);
    rejects({ ...minimal(), page: { orientation: 'landscape', background: { color: '#FFFFFF', imageRef: 'data:image/png;base64,AAAA' } } }, /Fundo: "imageRef"/);
    const eight = Array.from({ length: 8 }, (_, i) => img(`i${i}`, `/api/uploads/${UUID_FILE()}`));
    assert.doesNotThrow(() => validateCertificateLayout(minimal(eight)));
    const withBg = minimal(eight, {});
    (withBg.page as { background: Record<string, unknown> }).background.imageRef = `/api/uploads/${UUID_FILE()}`;
    rejects(withBg, /no máximo 8 imagens \(contando o fundo\)/);
    const rects = Array.from({ length: 39 }, (_, i) => ({ id: `r${i}`, type: 'rect', x: 0, y: 0, w: 1, h: 1, fill: '#000000', fillOpacity: 1, stroke: null, strokeWidth: 0, radius: 0 }));
    rejects(minimal(rects), /de 1 a 40 elementos/);
    assert.doesNotThrow(() => validateCertificateLayout(minimal(rects.slice(0, 38))));
  });

  it('limite de 64 KB do JSON', () => {
    const big = Array.from({ length: 30 }, (_, i) => ({
      id: `t${i}`, type: 'text', x: 0, y: 0, w: 10, h: 10, text: 'x'.repeat(499), fontKey: 'helvetica', size: 12, color: '#000000',
      align: 'left', vAlign: 'top', bold: false, italic: false, uppercase: false, letterSpacing: 0, lineHeight: 1.2,
    }));
    for (const el of big) (el as Record<string, unknown>).padding = 'y'.repeat(2000);
    rejects(minimal(big), /limite de 64 KB/);
  });

  it('não é objeto / elements não é lista = erro claro', () => {
    rejects(null, /deve ser um objeto/);
    rejects([], /deve ser um objeto/);
    rejects({ ...minimal(), elements: {} }, /"elements" deve ser uma lista/);
  });
});

/** Elemento linha válido; `over` troca campos. */
function lineEl(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 'linha', type: 'line', x: 10, y: 80, length: 30, orientation: 'horizontal', color: '#1f2933', thickness: 1, lineStyle: 'solid', ...over };
}

describe('Modelos de certificado — elemento LINHA (validação, unitário)', () => {
  it('linha válida passa e sai normalizada (cor em MAIÚSCULO), na ordem e sem perder os demais elementos', () => {
    const layout = validateCertificateLayout(minimal([lineEl()]));
    assert.equal(layout.elements.length, 3);
    assert.deepEqual(layout.elements[2], {
      id: 'linha', type: 'line', x: 10, y: 80, length: 30, orientation: 'horizontal', color: '#1F2933', thickness: 1, lineStyle: 'solid',
    });
    assert.deepEqual(layout.elements.map((e) => e.id), ['codigo', 'qr', 'linha']);
    for (const lineStyle of ['solid', 'dashed', 'dotted']) {
      assert.doesNotThrow(() => validateCertificateLayout(minimal([lineEl({ lineStyle })])), lineStyle);
    }
    assert.doesNotThrow(() => validateCertificateLayout(minimal([lineEl({ orientation: 'vertical', x: 50, y: 10, length: 90 })])));
  });

  it('desenho antigo (sem linha) continua válido e idêntico', () => {
    const old = validateCertificateLayout(minimal());
    assert.equal(old.elements.some((e) => e.type === 'line'), false);
    assert.deepEqual(validateCertificateLayout(JSON.parse(JSON.stringify(old))), old);
  });

  it('whitelist: campo extra = erro; campo obrigatório ausente = erro (mensagem indica o elemento "linha")', () => {
    rejects(minimal([lineEl({ extra: 1 })]), /Elemento "linha" \(linha\): campo desconhecido "extra"/);
    rejects(minimal([lineEl({ w: 10 })]), /Elemento "linha" \(linha\): campo desconhecido "w"/);
    rejects(minimal([lineEl({ h: 1 })]), /campo desconhecido "h"/);
    for (const key of ['x', 'y', 'length', 'orientation', 'color', 'thickness', 'lineStyle']) {
      const el = lineEl();
      delete el[key];
      rejects(minimal([el]), new RegExp(`Elemento "linha" \\(linha\\): campo "${key}" é obrigatório`));
    }
  });

  it('faixas: x,y 0..100; length 1..100; thickness 0.5..10; NaN/Infinity/texto = erro', () => {
    assert.doesNotThrow(() => validateCertificateLayout(minimal([lineEl({ x: 0, length: 100, thickness: 0.5 })])));
    assert.doesNotThrow(() => validateCertificateLayout(minimal([lineEl({ thickness: 10, y: 100 })])));
    rejects(minimal([lineEl({ x: -1 })]), /Elemento "linha" \(linha\): "x" deve estar entre 0 e 100/);
    rejects(minimal([lineEl({ x: 101 })]), /"x" deve estar entre 0 e 100/);
    rejects(minimal([lineEl({ y: -0.1 })]), /"y" deve estar entre 0 e 100/);
    rejects(minimal([lineEl({ y: 100.5 })]), /"y" deve estar entre 0 e 100/);
    rejects(minimal([lineEl({ length: 0.9 })]), /"length" deve estar entre 1 e 100/);
    rejects(minimal([lineEl({ x: 0, length: 101 })]), /"length" deve estar entre 1 e 100/);
    rejects(minimal([lineEl({ thickness: 0.4 })]), /"thickness" deve estar entre 0.5 e 10/);
    rejects(minimal([lineEl({ thickness: 10.1 })]), /"thickness" deve estar entre 0.5 e 10/);
    rejects(minimal([lineEl({ thickness: Infinity })]), /"thickness" deve ser um número/);
    rejects(minimal([lineEl({ length: NaN })]), /"length" deve ser um número/);
    rejects(minimal([lineEl({ x: '10' })]), /"x" deve ser um número/);
  });

  it('orientation, lineStyle e cor (#RRGGBB) inválidos = erro', () => {
    rejects(minimal([lineEl({ orientation: 'diagonal' })]), /Elemento "linha" \(linha\): "orientation" deve ser um de: horizontal, vertical/);
    rejects(minimal([lineEl({ lineStyle: 'wavy' })]), /"lineStyle" deve ser um de: solid, dashed, dotted/);
    rejects(minimal([lineEl({ color: '#FFF' })]), /"color" deve ser uma cor no formato #RRGGBB/);
    rejects(minimal([lineEl({ color: 'red' })]), /#RRGGBB/);
    rejects(minimal([lineEl({ color: null })]), /#RRGGBB/);
  });

  it('regra de caber: horizontal x+length <= 100; vertical y+length <= 100 (e só a dimensão da orientação conta)', () => {
    assert.doesNotThrow(() => validateCertificateLayout(minimal([lineEl({ x: 70, length: 30 })])), 'encosta exatamente na borda');
    rejects(minimal([lineEl({ x: 70.5, length: 30 })]), /Elemento "linha" \(linha\): x \+ length passa da largura da página/);
    rejects(minimal([lineEl({ orientation: 'vertical', x: 5, y: 80, length: 30 })]), /Elemento "linha" \(linha\): y \+ length passa da altura da página/);
    assert.doesNotThrow(() => validateCertificateLayout(minimal([lineEl({ orientation: 'vertical', x: 99, y: 70, length: 30 })])));
    // horizontal com y alto e length grande não é erro (só x+length conta), e vertical com x alto idem
    assert.doesNotThrow(() => validateCertificateLayout(minimal([lineEl({ y: 99, x: 0, length: 100 })])));
    assert.doesNotThrow(() => validateCertificateLayout(minimal([lineEl({ orientation: 'vertical', x: 100, y: 0, length: 100 })])));
  });

  it('id repetido com a linha = erro; a linha conta nos 40 elementos', () => {
    rejects(minimal([lineEl({ id: 'qr' })]), /id repetido/);
    rejects(minimal([lineEl({ id: 'a' }), lineEl({ id: 'a' })]), /id repetido/);
    const lines = (n: number) => Array.from({ length: n }, (_, i) => lineEl({ id: `l${i}` }));
    assert.doesNotThrow(() => validateCertificateLayout(minimal(lines(38))), '38 linhas + texto + QR = 40');
    rejects(minimal(lines(39)), /de 1 a 40 elementos/);
  });

  it('o tipo desconhecido segue recusado e a mensagem lista "line"', () => {
    rejects(withElement((els) => (els[0].type = 'circle')), /"type" deve ser um de: text, image, rect, line, qr/);
  });
});

describe('Modelos de certificado — variáveis, logo e presets (unitário)', () => {
  it('lista de variáveis do contrato (secao 3), na ordem', () => {
    assert.deepEqual([...CERTIFICATE_VARIABLES], ['aluno', 'grupo', 'titulo', 'graduacao', 'data', 'dataExtenso', 'codigo', 'link']);
    assert.deepEqual([...FONT_KEYS], ['helvetica', 'playfair', 'cinzel', 'lora', 'montserrat', 'greatvibes']);
  });

  it('substituição simples: todas as variáveis; ausente/null = vazio; texto sem variável fica igual', () => {
    const text = '{aluno}|{grupo}|{titulo}|{graduacao}|{data}|{dataExtenso}|{codigo}|{link}';
    assert.equal(
      substituteVariables(text, { aluno: 'A', grupo: 'G', titulo: 'T', graduacao: 'Gr', data: '12/03/2026', dataExtenso: '12 de março de 2026', codigo: 'C', link: 'L' }),
      'A|G|T|Gr|12/03/2026|12 de março de 2026|C|L',
    );
    assert.equal(substituteVariables('Graduação: {graduacao}.', { graduacao: null }), 'Graduação: .');
    assert.equal(substituteVariables('{aluno}{aluno}', { aluno: 'Zé' }), 'ZéZé');
    assert.equal(substituteVariables('sem variável', {}), 'sem variável');
    assert.equal(textVariablesProblem('{codigo} e {link}'), null);
  });

  it('data por extenso (campos UTC) e luminância', () => {
    assert.equal(formatLongDateBR(new Date('2026-03-12T00:00:00Z')), '12 de março de 2026');
    assert.equal(formatLongDateBR(new Date('2026-12-01T23:59:00Z')), '1 de dezembro de 2026');
    assert.equal(relativeLuminance('#000000'), 0);
    assert.equal(Math.round(relativeLuminance('#FFFFFF') * 1000) / 1000, 1);
  });

  it('logo do grupo: caminho ou URL do próprio backend -> caminho; URL externa/ausente = null', () => {
    const file = UUID_FILE();
    assert.equal(logoRefOf(`/api/uploads/${file}`), `/api/uploads/${file}`);
    assert.equal(logoRefOf(`https://api.gingapp.com.br/api/uploads/${file}`), `/api/uploads/${file}`);
    assert.equal(logoRefOf('https://cdn.example.com/logo.png'), null);
    assert.equal(logoRefOf(`javascript:alert(1)//api/uploads/${file}`), null);
    assert.equal(logoRefOf(null), null);
  });

  it('resolveGroupLogo: com logo vira ref concreta (useGroupLogo=false); sem logo o elemento SAI; o original não muda', () => {
    const logo = { id: 'logo', type: 'image', x: 0, y: 0, w: 10, h: 10, useGroupLogo: true, fit: 'contain', opacity: 1 };
    const layout = validateCertificateLayout(minimal([logo]));
    const file = `/api/uploads/${UUID_FILE()}`;
    const resolved = resolveGroupLogo(layout, file);
    assert.deepEqual(resolved.elements[2], { ...layout.elements[2], useGroupLogo: false, ref: file });
    assert.deepEqual(layoutUploadRefs(resolved), [file]);
    assert.equal(resolveGroupLogo(layout, null).elements.some((e) => e.id === 'logo'), false);
    assert.equal((layout.elements[2] as { useGroupLogo: boolean }).useGroupLogo, true);
    assert.doesNotThrow(() => validateCertificateLayout(resolved), 'o snapshot resolvido continua válido');
  });

  it('presets: 5 chaves do contrato, todos VÁLIDOS e já normalizados, sem imagem de upload, 1 QR e {codigo}/{link}', () => {
    assert.deepEqual(CERTIFICATE_PRESETS.map((p) => p.key), ['classico', 'moderno', 'batizado', 'evento', 'minimalista']);
    for (const preset of CERTIFICATE_PRESETS) {
      const normalized = validateCertificateLayout(JSON.parse(JSON.stringify(preset.layout)));
      assert.deepEqual(normalized, preset.layout, `${preset.key} já normalizado`);
      assert.deepEqual(layoutUploadRefs(preset.layout), [], `${preset.key} sem upload`);
      assert.ok(preset.name.length >= 1 && preset.name.length <= 60);
    }
    assert.notEqual(CERTIFICATE_PRESETS[0].layout, CLASSIC_LAYOUT, 'o preset clássico é uma CÓPIA separada do desenho embutido');
    assert.ok(CERTIFICATE_PRESETS.some((p) => p.layout.page.orientation === 'portrait'), 'ao menos 1 retrato');
    assert.equal(CLASSIC_LAYOUT.elements.some((e) => e.type === 'image'), false, 'o clássico não depende do logo');
  });

  it('CLASSIC_LAYOUT (certificados sem snapshot) NÃO tem linha nem assinatura; o preset clássico = CLASSIC_LAYOUT + só a assinatura', () => {
    assert.equal(CLASSIC_LAYOUT.elements.some((e) => e.type === 'line'), false, 'sem linha');
    assert.equal(CLASSIC_LAYOUT.elements.some((e) => e.id.startsWith('assinatura')), false, 'sem assinatura');
    assert.equal(CLASSIC_LAYOUT.elements.length, 14, 'os 14 elementos originais');
    const preset = CERTIFICATE_PRESETS[0].layout;
    assert.deepEqual(preset.elements.slice(0, 14), CLASSIC_LAYOUT.elements, 'os 14 originais seguem idênticos no preset');
    assert.deepEqual(preset.elements.slice(14).map((e) => e.id), ['assinatura-linha', 'assinatura-texto']);
    assert.deepEqual({ ...preset, elements: [] }, { ...CLASSIC_LAYOUT, elements: [] }, 'página igual');
    // cópia profunda: nenhum elemento é o mesmo objeto
    for (let i = 0; i < 14; i++) assert.notEqual(preset.elements[i], CLASSIC_LAYOUT.elements[i], `elemento ${i} copiado`);
  });

  it('os 5 presets têm o espaço de assinatura (linha + texto "Assinatura do Mestre"), <= 40 elementos', () => {
    for (const preset of CERTIFICATE_PRESETS) {
      const els = preset.layout.elements;
      assert.ok(els.length <= 40, `${preset.key}: ${els.length} elementos`);
      const lines = els.filter((e) => e.type === 'line');
      assert.equal(lines.length, 1, `${preset.key}: 1 linha`);
      const l = lines[0] as Extract<typeof els[number], { type: 'line' }>;
      assert.equal(l.id, 'assinatura-linha');
      assert.equal(l.orientation, 'horizontal');
      assert.equal(l.lineStyle, 'solid');
      assert.equal(l.thickness, 1);
      assert.ok(l.length >= 28 && l.length <= 32, `${preset.key}: comprimento ${l.length}`);
      const t = els.find((e) => e.id === 'assinatura-texto') as Extract<typeof els[number], { type: 'text' }>;
      assert.equal(t.text, 'Assinatura do Mestre');
      assert.equal(t.align, 'center');
      assert.ok(t.size >= 11 && t.size <= 12, `${preset.key}: tamanho ${t.size}`);
      assert.equal(t.x, l.x, 'texto alinhado com a linha');
      assert.equal(t.w, l.length, 'texto com a largura da linha');
      assert.ok(t.y > l.y, 'texto logo abaixo da linha');
      assert.ok(t.y - l.y < 2, 'texto colado na linha');
    }
  });

  it('a assinatura de cada preset não sobrepõe o QR, os textos (inclusive {codigo}/{link}) nem as imagens (caixas dos elementos)', () => {
    type Box = { id: string; x0: number; y0: number; x1: number; y1: number };
    const boxes = (layout: CertificateLayout): Box[] => {
      const { width, height } = layout.page.orientation === 'landscape' ? { width: 841.89, height: 595.28 } : { width: 595.28, height: 841.89 };
      return layout.elements.flatMap((e): Box[] => {
        if (e.type === 'rect') return []; // faixas/molduras/filetes são fundo decorativo
        if (e.type === 'qr') return [{ id: e.id, x0: e.x, y0: e.y, x1: e.x + (e.size / width) * 100, y1: e.y + (e.size / height) * 100 }];
        if (e.type === 'line') {
          return [{ id: e.id, x0: e.x, y0: e.y, x1: e.x + e.length, y1: e.y + (e.thickness / height) * 100 }];
        }
        return [{ id: e.id, x0: e.x, y0: e.y, x1: e.x + e.w, y1: e.y + e.h }];
      });
    };
    const overlap = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
    for (const preset of CERTIFICATE_PRESETS) {
      const all = boxes(preset.layout);
      const signature = all.filter((b) => b.id.startsWith('assinatura'));
      assert.equal(signature.length, 2, preset.key);
      assert.ok(all.some((b) => b.id === 'qr'), `${preset.key}: tem QR`);
      for (const s of signature) {
        assert.ok(s.x0 >= 0 && s.x1 <= 100 && s.y0 >= 0 && s.y1 <= 100, `${preset.key}/${s.id}: dentro da página`);
        for (const other of all.filter((b) => !b.id.startsWith('assinatura'))) {
          assert.equal(overlap(s, other), false, `${preset.key}: "${s.id}" sobrepõe "${other.id}"`);
        }
      }
      assert.equal(overlap(signature[0], signature[1]), false, `${preset.key}: linha e texto não se sobrepõem`);
    }
  });

  it('PDF: o preset clássico (Helvetica) imprime "Assinatura do Mestre"; o CLASSIC_LAYOUT embutido (sem snapshot) NÃO; todos os presets geram 1 página', async () => {
    const withSignature = await renderCertificatePdf(DATA, resolveGroupLogo(CERTIFICATE_PRESETS[0].layout, null));
    isPdf(withSignature);
    assert.ok(pdfText(withSignature).includes('Assinatura do Mestre'));
    const embedded = await renderCertificatePdf(DATA);
    assert.ok(!pdfText(embedded).includes('Assinatura do Mestre'), 'o clássico embutido (sem snapshot) não tem assinatura');
    assert.ok(!pdfContent(embedded).includes(' l\n'), 'e nenhuma linha traçada (certificado antigo idêntico ao de antes)');
    assert.ok(pdfContent(withSignature).includes(' l\n'), 'o preset clássico traça a linha de assinatura');
    for (const preset of CERTIFICATE_PRESETS) {
      const pdf = await renderCertificatePdf(DATA, resolveGroupLogo(preset.layout, null));
      isPdf(pdf);
      assert.equal(pdfPageCount(pdf), 1, preset.key);
    }
  });
});

describe('Modelos de certificado — renderizador (unitário)', () => {
  let dir = '';
  let webp = '';
  let png = '';

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gingapp-certpdf-'));
    webp = UUID_FILE();
    png = `${randomUUID()}.png`;
    await fs.writeFile(path.join(dir, webp), await sharp({ create: { width: 40, height: 20, channels: 3, background: '#cc3300' } }).webp().toBuffer());
    await fs.writeFile(path.join(dir, png), await sharp({ create: { width: 20, height: 20, channels: 4, background: { r: 0, g: 80, b: 0, alpha: 0.5 } } }).png().toBuffer());
  });

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('sem desenho = clássico: PDF válido (%PDF ... %%EOF), 1 página A4 paisagem, com os textos e as variáveis trocadas', async () => {
    const pdf = await renderCertificatePdf(DATA);
    isPdf(pdf);
    assert.equal(pdfPageCount(pdf), 1);
    assert.deepEqual(pdfMediaBox(pdf), [841.89, 595.28]);
    const text = pdfText(pdf);
    for (const expected of ['GRUPO GINGA BRASIL', 'CERTIFICADO', 'João Çedilha da Conceição', 'Graduação à Corda Azul', 'Emitido em 12/03/2026', 'codigo-de-teste-123', DATA.verificationUrl!]) {
      assert.ok(text.includes(expected), `PDF deve conter "${expected}"`);
    }
    assert.ok(!text.includes('{'), 'nenhuma variável sobra sem trocar');
  });

  it('retrato vs paisagem pelo MediaBox; todos os presets geram PDF de 1 página', async () => {
    for (const preset of CERTIFICATE_PRESETS) {
      const pdf = await renderCertificatePdf(DATA, resolveGroupLogo(preset.layout, null), { uploadsDir: dir });
      isPdf(pdf);
      assert.equal(pdfPageCount(pdf), 1, preset.key);
      const [w, h] = pdfMediaBox(pdf)!;
      assert.equal(w > h, preset.layout.page.orientation === 'landscape', `${preset.key}: orientação`);
    }
  });

  it('fontes do contrato são embutidas; diretório de fontes inexistente cai na Helvetica sem falhar', async () => {
    const layout = validateCertificateLayout(withElement((els) => Object.assign(els[0], { fontKey: 'playfair', bold: true })));
    const embedded = (await renderCertificatePdf(DATA, layout)).toString('latin1');
    assert.match(embedded, /\/BaseFont \/[A-Z]{6}\+PlayfairDisplay/);

    const fallback = await renderCertificatePdf(DATA, layout, { fontsDir: path.join(dir, 'nao-existe') });
    isPdf(fallback);
    const raw = fallback.toString('latin1');
    assert.doesNotMatch(raw, /PlayfairDisplay/);
    assert.match(raw, /\/BaseFont \/Helvetica-Bold/);
    assert.ok(pdfText(fallback).includes('codigo-de-teste-123'), 'o texto sai na Helvetica');
  });

  it('todas as fontes e variantes carregam (bold/italic que a fonte não tem é ignorado)', async () => {
    const texts = FONT_KEYS.flatMap((fontKey, i) =>
      [false, true].map((bold, j) => ({
        id: `f${i}-${j}`, type: 'text', x: 1, y: 1 + i * 12 + j * 6, w: 60, h: 5, text: 'Ação coração', fontKey, size: 12, color: '#000000',
        align: 'left', vAlign: 'top', bold, italic: true, uppercase: false, letterSpacing: 0, lineHeight: 1.2,
      })),
    );
    const pdf = (await renderCertificatePdf(DATA, validateCertificateLayout(minimal(texts)))).toString('latin1');
    for (const family of ['PlayfairDisplay', 'Cinzel', 'Lora', 'Montserrat', 'GreatVibes']) assert.match(pdf, new RegExp(`\\+${family}`), family);
  });

  it('imagem ausente/ilegível é PULADA (PDF sai); WebP e PNG de upload entram como imagem', async () => {
    const img = (id: string, ref: string, fit = 'contain') => ({ id, type: 'image', x: 0, y: 0, w: 20, h: 20, ref, useGroupLogo: false, fit, opacity: 0.5 });
    const missing = validateCertificateLayout(minimal([img('sumiu', `/api/uploads/${UUID_FILE()}`)]));
    const pdfMissing = await renderCertificatePdf(DATA, missing, { uploadsDir: dir });
    isPdf(pdfMissing);
    assert.doesNotMatch(pdfMissing.toString('latin1'), /\/Subtype \/Image/);

    await fs.writeFile(path.join(dir, 'lixo.webp'), 'nao e imagem');
    const garbage = UUID_FILE();
    await fs.writeFile(path.join(dir, garbage), 'nao e imagem');
    const pdfGarbage = await renderCertificatePdf(DATA, validateCertificateLayout(minimal([img('lixo', `/api/uploads/${garbage}`)])), { uploadsDir: dir });
    isPdf(pdfGarbage);

    const both = validateCertificateLayout(minimal([img('a', `/api/uploads/${webp}`, 'cover'), img('b', `/api/uploads/${png}`)]));
    (both.page.background as { imageRef: string | null }).imageRef = `/api/uploads/${webp}`;
    const pdf = await renderCertificatePdf(DATA, both, { uploadsDir: dir });
    isPdf(pdf);
    assert.ok((pdf.toString('latin1').match(/\/Subtype \/Image/g) ?? []).length >= 2, 'imagens embutidas');
  });

  it('texto longo numa caixa pequena é CORTADO na altura (1 página só); vAlign/uppercase/letterSpacing não quebram', async () => {
    const long = `{codigo} ${'palavra '.repeat(60)}`.trim();
    const layout = validateCertificateLayout(
      withElement((els) => Object.assign(els[0], { text: long, w: 45, h: 3, vAlign: 'bottom', uppercase: true, letterSpacing: 2 })),
    );
    const pdf = await renderCertificatePdf(DATA, layout);
    isPdf(pdf);
    assert.equal(pdfPageCount(pdf), 1);
    const text = pdfText(pdf);
    assert.ok(text.includes('CODIGO-DE-TESTE-123'), 'a 1ª linha sempre sai (em maiúsculas)');
    assert.ok((text.match(/PALAVRA/g) ?? []).length < 60, 'o resto foi cortado');
  });

  it('linha: solid/dashed/dotted, horizontal e vertical, geram PDF válido com o traço certo (coordenadas, espessura, padrão de traço, ponta)', async () => {
    const base = await renderCertificatePdf(DATA, validateCertificateLayout(minimal()));
    isPdf(base);
    const baseContent = pdfContent(base);
    assert.ok(!baseContent.includes(' l\n') && !/\] 0 d/.test(baseContent), 'sem linha, nenhum traço');

    // A4 paisagem: 841.89 x 595.28. O stream do pdfkit usa a origem no canto superior esquerdo (a matriz de página inverte o y).
    const cases = [
      { orientation: 'horizontal', lineStyle: 'solid', dash: null, cap: null },
      { orientation: 'horizontal', lineStyle: 'dashed', dash: '[8 6] 0 d', cap: null },
      { orientation: 'horizontal', lineStyle: 'dotted', dash: '[0.01 4] 0 d', cap: '1 J' },
      { orientation: 'vertical', lineStyle: 'solid', dash: null, cap: null },
      { orientation: 'vertical', lineStyle: 'dashed', dash: '[8 6] 0 d', cap: null },
      { orientation: 'vertical', lineStyle: 'dotted', dash: '[0.01 4] 0 d', cap: '1 J' },
    ] as const;
    for (const c of cases) {
      const layout = validateCertificateLayout(minimal([lineEl({ id: 'l', x: 10, y: 20, length: 50, thickness: 2, color: '#ff0000', orientation: c.orientation, lineStyle: c.lineStyle })]));
      const pdf = await renderCertificatePdf(DATA, layout);
      isPdf(pdf);
      assert.equal(pdfPageCount(pdf), 1, `${c.orientation}/${c.lineStyle}`);
      const content = pdfContent(pdf);
      assert.ok(pdf.length > base.length, `${c.orientation}/${c.lineStyle}: o PDF com linha é maior que o sem linha`);
      assert.ok(content.includes('1 0 0 SCN'), 'cor vermelha de contorno');
      assert.ok(/\n2 w\n/.test(content), 'espessura 2 pt');
      const x1 = (10 / 100) * 841.89;
      const y1 = (20 / 100) * 595.28;
      const x2 = c.orientation === 'horizontal' ? x1 + 0.5 * 841.89 : x1;
      const y2 = c.orientation === 'horizontal' ? y1 : y1 + 0.5 * 595.28;
      const fmt = (n: number) => String(Math.round(n * 1000) / 1000);
      assert.ok(content.includes(`${fmt(x1)} ${fmt(y1)} m`), `${c.orientation}: início da linha`);
      assert.ok(content.includes(`${fmt(x2)} ${fmt(y2)} l`), `${c.orientation}: fim da linha (length em % da ${c.orientation === 'horizontal' ? 'largura' : 'altura'})`);
      if (c.dash) assert.ok(content.includes(c.dash), `${c.lineStyle}: padrão ${c.dash}`);
      else assert.ok(content.includes('[] 0 d') && !/\[\S+ \S+\] 0 d/.test(content), 'sólida: sem padrão de traço');
      if (c.cap) assert.ok(content.includes(c.cap), 'ponta arredondada no pontilhado');
    }
  });

  it('linha: nunca derruba o PDF (extremos 100%, espessura 10 pt, layout com 38 linhas) e o estado gráfico é restaurado (o QR/texto seguintes saem normais)', async () => {
    const extremes = validateCertificateLayout(
      minimal([
        lineEl({ id: 'a', x: 0, y: 0, length: 100, thickness: 10, lineStyle: 'dotted' }),
        lineEl({ id: 'b', x: 100, y: 0, length: 100, orientation: 'vertical', thickness: 0.5, lineStyle: 'dashed' }),
        lineEl({ id: 'c', x: 0, y: 100, length: 1, thickness: 3 }),
      ]),
    );
    const pdf = await renderCertificatePdf(DATA, extremes);
    isPdf(pdf);
    assert.equal(pdfPageCount(pdf), 1);
    assert.ok(pdfText(pdf).includes('codigo-de-teste-123'), 'o texto desenhado antes da linha segue no PDF');

    const many = validateCertificateLayout(minimal(Array.from({ length: 38 }, (_, i) => lineEl({ id: `l${i}`, y: i + 1, lineStyle: ['solid', 'dashed', 'dotted'][i % 3] }))));
    const pdfMany = await renderCertificatePdf(DATA, many);
    isPdf(pdfMany);
    assert.equal(pdfPageCount(pdfMany), 1);

    // linha por cima do QR e do texto não muda a contagem de páginas nem o texto
    const over = validateCertificateLayout(minimal([lineEl({ id: 'riscado', x: 10, y: 11, length: 50, thickness: 4 })]));
    const pdfOver = await renderCertificatePdf(DATA, over);
    assert.equal(pdfPageCount(pdfOver), 1);
    assert.ok(pdfText(pdfOver).includes('codigo-de-teste-123'));
  });

  it('sem APP_URL (link vazio) o QR leva o código e o PDF sai igual', async () => {
    const pdf = await renderCertificatePdf({ ...DATA, verificationUrl: null }, CLASSIC_LAYOUT);
    isPdf(pdf);
    assert.ok(!pdfText(pdf).includes('https://'), 'sem link no texto');
  });
});

describe('Modelos de certificado — conformidade com o editor do painel', () => {
  it('o desenho em branco que o painel envia (toWireLayout) passa na validação sem mudar nada', () => {
    // Capturado do painel (modules/certificados/modelos/layout-utils.ts: blankLayout("landscape") + toWireLayout).
    const fromPainel = {
      version: 1,
      page: { orientation: 'landscape', background: { color: '#FFFFFF', imageRef: null, imageFit: 'cover' } },
      elements: [
        { id: 'texto-principal', type: 'text', x: 10, y: 40, w: 80, h: 20, text: '{aluno}', fontKey: 'helvetica', size: 36, color: '#1F2937', align: 'center', vAlign: 'middle', bold: false, italic: false, uppercase: false, letterSpacing: 0, lineHeight: 1.2 },
        { id: 'texto-verificacao', type: 'text', x: 6, y: 88, w: 70, h: 6, text: 'Código de verificação: {codigo}', fontKey: 'helvetica', size: 10, color: '#1F2937', align: 'left', vAlign: 'middle', bold: false, italic: false, uppercase: false, letterSpacing: 0, lineHeight: 1.2 },
        { id: 'qr-verificacao', type: 'qr', x: 86, y: 78, size: 80, fg: '#000000' },
      ],
    };
    assert.deepEqual(validateCertificateLayout(fromPainel), fromPainel);
  });

  it('a linha e o bloco de assinatura que o painel envia (linha + texto, horizontal e vertical tracejada) passam sem mudar nada', () => {
    // Capturado do painel: "Bloco de assinatura" (linha + texto "Assinatura") e uma linha vertical tracejada.
    const text = { fontKey: 'helvetica', color: '#1F2937', bold: false, italic: false, uppercase: false, letterSpacing: 0 };
    const fromPainel = {
      version: 1,
      page: { orientation: 'landscape', background: { color: '#FFFFFF', imageRef: null, imageFit: 'cover' } },
      elements: [
        { id: 'texto-verificacao', type: 'text', x: 6, y: 88, w: 70, h: 6, text: 'Código: {codigo}', size: 10, align: 'left', vAlign: 'middle', lineHeight: 1.2, ...text },
        { id: 'qr-verificacao', type: 'qr', x: 86, y: 78, size: 80, fg: '#000000' },
        { id: 'e-aaaaaa', type: 'line', x: 35, y: 80, length: 30, orientation: 'horizontal', color: '#1F2937', thickness: 1, lineStyle: 'solid' },
        { id: 'e-bbbbbb', type: 'text', x: 35, y: 81, w: 30, h: 5, text: 'Assinatura', size: 12, align: 'center', vAlign: 'top', lineHeight: 1.2, ...text },
        { id: 'e-cccccc', type: 'line', x: 50, y: 10, length: 40, orientation: 'vertical', color: '#1F2937', thickness: 2.5, lineStyle: 'dashed' },
      ],
    };
    assert.deepEqual(JSON.parse(JSON.stringify(validateCertificateLayout(fromPainel))), JSON.parse(JSON.stringify(fromPainel)));
  });
});

// Tipagem: o tipo exportado aceita os presets (compila só se o formato bater).
const _typecheck: CertificateLayout[] = CERTIFICATE_PRESETS.map((p) => p.layout);
void _typecheck;
