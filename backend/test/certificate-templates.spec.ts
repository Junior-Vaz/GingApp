import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
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
    assert.equal(CERTIFICATE_PRESETS[0].layout, CLASSIC_LAYOUT, 'o clássico é o desenho embutido');
    assert.ok(CERTIFICATE_PRESETS.some((p) => p.layout.page.orientation === 'portrait'), 'ao menos 1 retrato');
    assert.equal(CLASSIC_LAYOUT.elements.some((e) => e.type === 'image'), false, 'o clássico não depende do logo');
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
});

// Tipagem: o tipo exportado aceita os presets (compila só se o formato bater).
const _typecheck: CertificateLayout[] = CERTIFICATE_PRESETS.map((p) => p.layout);
void _typecheck;
