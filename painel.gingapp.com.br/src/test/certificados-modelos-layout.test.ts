import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  COALESCE_MS,
  HISTORY_LIMIT,
  canRedo,
  canUndo,
  createHistory,
  pushHistory,
  redo,
  undo,
} from "@/modules/certificados/modelos/history";
import {
  ADDABLE_TYPES,
  LINE_HIT_PT,
  SIGNATURE_BLOCK,
  SNAP_THRESHOLD,
  addDefaultElement,
  addSignatureBlock,
  analyzeVariables,
  applyVariables,
  blankLayout,
  canReorder,
  clampBox,
  clampElement,
  countImages,
  defaultElement,
  duplicateElement,
  elementBox,
  generateId,
  hasVerificationToken,
  insertAtCursor,
  isDarkEnoughForQr,
  layoutBytes,
  lineDash,
  lineHandles,
  lineOffsetPct,
  moveElement,
  relativeLuminance,
  removeElement,
  reorderElement,
  resizeBox,
  resizeElement,
  resizeLine,
  resizeQr,
  sampleVariables,
  setBackground,
  setOrientation,
  snapBox,
  snapLineResize,
  snapMove,
  snapResize,
  toWireLayout,
  updateElement,
  validateLayout,
  validateName,
  whyCannotAdd,
  whyCannotAddSignatureBlock,
  type Box,
} from "@/modules/certificados/modelos/layout-utils";
import {
  ELEMENT_ID,
  ELEMENT_TYPE_LABEL,
  FONTS,
  LIMITS,
  PAGE_PT,
  PURPOSES,
  VARIABLES,
  type CertificateElement,
  type CertificateLayout,
  type ImageEl,
  type LineEl,
  type QrEl,
  type TextEl,
} from "@/modules/certificados/modelos/types";

const UPLOAD = "/api/uploads/0a1b2c3d-1111-2222-3333-444455556666.png";

const text = (layout: CertificateLayout, id: string) => layout.elements.find((e) => e.id === id) as TextEl;
const qr = (layout: CertificateLayout) => layout.elements.find((e) => e.type === "qr") as QrEl;
const messages = (layout: CertificateLayout) => validateLayout(layout).map((i) => i.message);

describe("conformidade com o contrato (constantes)", () => {
  it("FONTS: chaves e flags bold/italic do §4", () => {
    expect(FONTS.map((f) => [f.key, f.bold, f.italic])).toEqual([
      ["helvetica", true, true],
      ["playfair", true, true],
      ["cinzel", true, false],
      ["lora", true, true],
      ["montserrat", true, true],
      ["greatvibes", false, false],
    ]);
  });

  it("VARIABLES: as 8 variáveis do §3, na ordem", () => {
    expect(VARIABLES.map((v) => v.token)).toEqual([
      "{aluno}",
      "{grupo}",
      "{titulo}",
      "{graduacao}",
      "{data}",
      "{dataExtenso}",
      "{codigo}",
      "{link}",
    ]);
    for (const v of VARIABLES) expect(v.token).toBe(`{${v.key}}`);
  });

  it("PURPOSES: usos do §5 com rótulos em português", () => {
    expect(PURPOSES.map((p) => p.value)).toEqual(["GRADUACAO", "BATIZADO", "EVENTO", "PARTICIPACAO", "OUTRO"]);
    expect(PURPOSES.map((p) => p.label)).toEqual(["Graduação", "Batizado", "Evento", "Participação", "Outro"]);
  });

  it("limites do §2/§5 e páginas A4", () => {
    expect(LIMITS).toMatchObject({ maxElements: 40, maxImages: 8, maxText: 500, maxLayoutBytes: 65536, maxTemplates: 30, nameMax: 60 });
    expect(LIMITS.qrSize).toEqual({ min: 56, max: 220 });
    expect(LIMITS.fontSize).toEqual({ min: 6, max: 160 });
    expect(LIMITS.lineHeight).toEqual({ min: 0.8, max: 2.5 });
    expect(PAGE_PT.landscape).toEqual({ w: 842, h: 595 });
    expect(PAGE_PT.portrait).toEqual({ w: 595, h: 842 });
  });

  // Lê o PRÓPRIO documento do contrato (quando o repositório inteiro está presente) e compara com as constantes.
  const contractPath = resolve(process.cwd(), "..", "docs", "CONTRATO_CERTIFICADOS_MODELOS.md");
  const hasContract = existsSync(contractPath);

  it.skipIf(!hasContract)("FONTS e VARIABLES batem com as tabelas do docs/CONTRATO_CERTIFICADOS_MODELOS.md", () => {
    const doc = readFileSync(contractPath, "utf8");
    const variables = [...doc.matchAll(/^\| `\{(\w+)\}` \|/gm)].map((m) => m[1]);
    expect(variables).toEqual(VARIABLES.map((v) => v.key));
    const fonts = [...doc.matchAll(/^\| `(helvetica|playfair|cinzel|lora|montserrat|greatvibes)` \|[^|]*\| (sim|não) \| (sim|não) \|/gm)].map(
      (m) => [m[1], m[2] === "sim", m[3] === "sim"],
    );
    expect(fonts).toEqual(FONTS.map((f) => [f.key, f.bold, f.italic]));
    const limits = doc.match(/Máx\. \*\*(\d+)\*\* elementos, máx\. \*\*(\d+)\*\* imagens/);
    expect([Number(limits?.[1]), Number(limits?.[2])]).toEqual([LIMITS.maxElements, LIMITS.maxImages]);
  });
});

describe("clamp, mover e redimensionar", () => {
  it("clampBox mantém x+w <= 100 e y+h <= 100, w,h em [min,100]", () => {
    expect(clampBox({ x: 95, y: 98, w: 20, h: 10 })).toEqual({ x: 80, y: 90, w: 20, h: 10 });
    expect(clampBox({ x: -5, y: -1, w: 30, h: 30 })).toEqual({ x: 0, y: 0, w: 30, h: 30 });
    expect(clampBox({ x: 10, y: 10, w: 0, h: 500 })).toEqual({ x: 10, y: 0, w: 1, h: 100 });
    const odd = clampBox({ x: 66.667, y: 0, w: 33.333, h: 10 });
    expect(odd.x + odd.w).toBeLessThanOrEqual(100);
  });

  it("clampElement do QR respeita o lado em pt e a página (retrato e paisagem)", () => {
    const base = defaultElement("qr", "landscape", "qr-1") as QrEl;
    const far = clampElement({ ...base, x: 99, y: 99 }, "landscape");
    const box = elementBox(far, "landscape");
    expect(box.x + box.w).toBeLessThanOrEqual(100);
    expect(box.y + box.h).toBeLessThanOrEqual(100);
    const portrait = clampElement({ ...base, x: 99, y: 99, size: 500 }, "portrait");
    expect(portrait.size).toBe(220);
    const pbox = elementBox(portrait, "portrait");
    expect(pbox.x + pbox.w).toBeLessThanOrEqual(100);
    expect(pbox.y + pbox.h).toBeLessThanOrEqual(100);
    expect(clampElement({ ...base, size: 10 }, "landscape").size).toBe(56);
  });

  it("moveElement nunca sai da página", () => {
    const el = defaultElement("rect", "landscape", "r-1"); // 30x15 em (10,10)
    const moved = moveElement(el, 500, 500, "landscape") as typeof el & { x: number; y: number; w: number; h: number };
    expect(moved.x).toBe(70);
    expect(moved.y).toBe(85);
    const back = moveElement(el, -500, -500, "landscape") as typeof moved;
    expect([back.x, back.y]).toEqual([0, 0]);
  });

  it("resizeBox: o lado oposto fica parado, respeita o mínimo e a página", () => {
    const box = { x: 20, y: 20, w: 20, h: 20 };
    expect(resizeBox(box, "se", 10, 5)).toEqual({ x: 20, y: 20, w: 30, h: 25 });
    expect(resizeBox(box, "nw", -10, -5)).toEqual({ x: 10, y: 15, w: 30, h: 25 });
    expect(resizeBox(box, "e", -100, 0)).toEqual({ x: 20, y: 20, w: 2, h: 20 });
    expect(resizeBox(box, "w", 100, 0)).toEqual({ x: 38, y: 20, w: 2, h: 20 });
    const wide = resizeBox(box, "se", 500, 500);
    expect(wide).toEqual({ x: 20, y: 20, w: 80, h: 80 });
    const up = resizeBox(box, "n", -500, -500);
    expect(up).toEqual({ x: 20, y: 0, w: 20, h: 40 });
  });

  it("resizeQr: só quadrado, entre 56 e 220 pt, com o canto oposto parado", () => {
    const el: QrEl = { id: "qr-1", type: "qr", x: 40, y: 40, size: 100, fg: "#000000" };
    const grown = resizeQr(el, "se", 5, 0, "landscape"); // +5% de 842 = 42 pt
    expect(grown.size).toBe(142);
    expect([grown.x, grown.y]).toEqual([40, 40]);
    const fromNw = resizeQr(el, "nw", -5, -5, "landscape");
    expect(fromNw.size).toBeGreaterThan(100);
    const boxBefore = elementBox(el, "landscape");
    const boxAfter = elementBox(fromNw, "landscape");
    expect(boxAfter.x + boxAfter.w).toBeCloseTo(boxBefore.x + boxBefore.w, 1);
    expect(boxAfter.y + boxAfter.h).toBeCloseTo(boxBefore.y + boxBefore.h, 1);
    expect(resizeQr(el, "se", -90, -90, "landscape").size).toBe(56);
    expect(resizeQr(el, "se", 90, 90, "landscape").size).toBeLessThanOrEqual(220);
  });
});

describe("guias e snap", () => {
  it("gruda no centro da página dentro do limiar e acende a guia", () => {
    const box = { x: 19.5, y: 10, w: 61, h: 10 }; // centro = 50
    const snap = snapMove({ ...box, x: 20 }, []);
    expect(snap.dx).toBeCloseTo(-0.5, 5); // centro 50.5 -> 50
    expect(snap.guides).toContainEqual({ axis: "x", pos: 50 });
  });

  it("não gruda além do limiar", () => {
    const snap = snapMove({ x: 10, y: 10, w: 20, h: 10 }, []);
    expect(SNAP_THRESHOLD).toBe(1);
    expect(snap.dx).toBe(0);
    expect(snap.dy).toBe(0);
    expect(snap.guides).toEqual([]);
  });

  it("gruda nas bordas da página e nas bordas/centro de OUTROS elementos", () => {
    const edge = snapMove({ x: 0.6, y: 30, w: 20, h: 10 }, []);
    expect(edge.dx).toBeCloseTo(-0.6, 5);
    expect(edge.guides).toContainEqual({ axis: "x", pos: 0 });
    const other = { x: 40, y: 60, w: 20, h: 10 }; // linhas x: 40,50,60 ; y: 60,65,70
    const snap = snapMove({ x: 60.7, y: 20, w: 10, h: 10 }, [other]); // borda esquerda 60.7 -> 60
    expect(snap.dx).toBeCloseTo(-0.7, 5);
    expect(snap.guides).toContainEqual({ axis: "x", pos: 60 });
    const vertical = snapMove({ x: 10, y: 55.4, w: 10, h: 10 }, [other]); // borda inferior 65.4 -> 65 (centro do outro)
    expect(vertical.dy).toBeCloseTo(-0.4, 5);
    expect(vertical.guides).toContainEqual({ axis: "y", pos: 65 });
  });

  it("snapResize só gruda a(s) borda(s) que se movem", () => {
    const resized = snapResize({ x: 10, y: 10, w: 39.4, h: 20 }, "e", [], SNAP_THRESHOLD); // direita 49.4 -> 50
    expect(resized.box.w).toBeCloseTo(40, 5);
    expect(resized.box.x).toBe(10);
    expect(resized.guides).toContainEqual({ axis: "x", pos: 50 });
    const west = snapResize({ x: 0.7, y: 10, w: 30, h: 20 }, "w", []);
    expect(west.box.x).toBe(0);
    expect(west.box.x + west.box.w).toBeCloseTo(30.7, 5); // borda direita parada
  });
});

describe("elementos: criar, atualizar, ordem, duplicar, remover", () => {
  const base = () => blankLayout();

  it("defaultElement cria cada tipo dentro da página e com id válido", () => {
    for (const type of ["text", "image", "rect", "qr"] as const) {
      for (const orientation of ["landscape", "portrait"] as const) {
        const el = defaultElement(type, orientation, "novo-1");
        const box = elementBox(el, orientation);
        expect(box.x + box.w).toBeLessThanOrEqual(100);
        expect(box.y + box.h).toBeLessThanOrEqual(100);
        expect(el.type).toBe(type);
      }
    }
  });

  it("generateId: único, só [a-z0-9-] e até 40 chars", () => {
    const taken = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const id = generateId(taken);
      expect(ELEMENT_ID.test(id)).toBe(true);
      expect(taken.has(id)).toBe(false);
      taken.add(id);
    }
    // colisão forçada: o gerador tenta de novo
    const fixed = generateId(["e-000000"], (() => {
      const values = [0, 0.5];
      return () => values.shift() ?? 0.9;
    })());
    expect(fixed).not.toBe("e-000000");
  });

  it("addDefaultElement respeita o limite de 40 elementos, 8 imagens e o QR único", () => {
    let layout = base();
    expect(addDefaultElement(layout, "qr")).toBeNull();
    expect(whyCannotAdd(layout, "qr")).toMatch(/QR Code/);
    const added = addDefaultElement(layout, "text")!;
    expect(added.layout.elements).toHaveLength(layout.elements.length + 1);
    expect(added.layout.elements.at(-1)!.id).toBe(added.id);

    for (let i = 0; i < LIMITS.maxImages; i++) layout = addDefaultElement(layout, "image")!.layout;
    expect(countImages(layout)).toBe(8);
    expect(addDefaultElement(layout, "image")).toBeNull();
    expect(whyCannotAdd(layout, "image")).toMatch(/8 imagens/);
    expect(addDefaultElement(layout, "rect")).not.toBeNull();

    while (layout.elements.length < LIMITS.maxElements) layout = addDefaultElement(layout, "rect")!.layout;
    expect(addDefaultElement(layout, "rect")).toBeNull();
    expect(whyCannotAdd(layout, "text")).toMatch(/40 elementos/);
  });

  it("a imagem de fundo conta nas 8 imagens", () => {
    let layout = setBackground(base(), { imageRef: UPLOAD });
    for (let i = 0; i < 7; i++) layout = addDefaultElement(layout, "image")!.layout;
    expect(countImages(layout)).toBe(8);
    expect(whyCannotAdd(layout, "image")).not.toBeNull();
  });

  it("updateElement: trocar para fonte sem negrito/itálico desliga a flag e o clamp vale", () => {
    let layout = updateElement(base(), "texto-principal", { fontKey: "montserrat", bold: true, italic: true });
    expect(text(layout, "texto-principal")).toMatchObject({ bold: true, italic: true });
    layout = updateElement(layout, "texto-principal", { fontKey: "cinzel" });
    expect(text(layout, "texto-principal")).toMatchObject({ bold: true, italic: false });
    layout = updateElement(layout, "texto-principal", { fontKey: "greatvibes" });
    expect(text(layout, "texto-principal")).toMatchObject({ bold: false, italic: false });
    layout = updateElement(layout, "texto-principal", { x: 95, w: 50 });
    const el = text(layout, "texto-principal");
    expect(el.x + el.w).toBeLessThanOrEqual(100);
    expect(updateElement(layout, "nao-existe", { x: 1 })).toBe(layout);
  });

  it("removeElement remove texto mas NUNCA o QR", () => {
    const layout = base();
    const without = removeElement(layout, "texto-principal");
    expect(without.elements.map((e) => e.id)).not.toContain("texto-principal");
    expect(removeElement(layout, "qr-verificacao")).toBe(layout);
    expect(qr(removeElement(layout, "qr-verificacao"))).toBeDefined();
  });

  it("duplicateElement: id novo, logo acima do original, deslocado; QR e limites não duplicam", () => {
    const layout = base();
    const dup = duplicateElement(layout, "texto-principal")!;
    expect(dup.id).not.toBe("texto-principal");
    const order = dup.layout.elements.map((e) => e.id);
    expect(order.indexOf(dup.id)).toBe(order.indexOf("texto-principal") + 1);
    expect(text(dup.layout, dup.id)).toMatchObject({ x: 12, y: 42, text: "{aluno}" });
    expect(duplicateElement(layout, "qr-verificacao")).toBeNull();
    expect(duplicateElement(layout, "nada")).toBeNull();
    let full = layout;
    while (full.elements.length < LIMITS.maxElements) full = addDefaultElement(full, "rect")!.layout;
    expect(duplicateElement(full, "texto-principal")).toBeNull();
  });

  it("ordem frente/trás (o último fica por cima)", () => {
    const layout = base(); // texto-principal, texto-verificacao, qr-verificacao
    const ids = (l: CertificateLayout) => l.elements.map((e) => e.id);
    expect(ids(reorderElement(layout, "texto-principal", "front"))).toEqual(["texto-verificacao", "qr-verificacao", "texto-principal"]);
    expect(ids(reorderElement(layout, "qr-verificacao", "back"))).toEqual(["qr-verificacao", "texto-principal", "texto-verificacao"]);
    expect(ids(reorderElement(layout, "texto-principal", "forward"))).toEqual(["texto-verificacao", "texto-principal", "qr-verificacao"]);
    expect(ids(reorderElement(layout, "texto-verificacao", "backward"))).toEqual(["texto-verificacao", "texto-principal", "qr-verificacao"]);
    expect(reorderElement(layout, "qr-verificacao", "front")).toBe(layout);
    expect(canReorder(layout, "qr-verificacao", "front")).toBe(false);
    expect(canReorder(layout, "texto-principal", "back")).toBe(false);
    expect(canReorder(layout, "texto-principal", "forward")).toBe(true);
  });

  it("setOrientation mantém as posições em % e garante que o QR cabe", () => {
    const portrait = setOrientation(blankLayout(), "portrait");
    expect(portrait.page.orientation).toBe("portrait");
    expect(text(portrait, "texto-principal")).toMatchObject({ x: 10, y: 40 });
    const box = elementBox(qr(portrait), "portrait");
    expect(box.x + box.w).toBeLessThanOrEqual(100);
    expect(setOrientation(portrait, "portrait")).toBe(portrait);
    expect(validateLayout(portrait)).toEqual([]);
  });
});

describe("histórico desfazer/refazer", () => {
  it("push, undo, redo e limpeza do futuro", () => {
    let h = createHistory("a");
    expect(canUndo(h)).toBe(false);
    h = pushHistory(h, "b");
    h = pushHistory(h, "c");
    expect(h.present).toBe("c");
    h = undo(h);
    expect(h.present).toBe("b");
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(h.present).toBe("c");
    h = undo(undo(h));
    expect(h.present).toBe("a");
    expect(undo(h)).toBe(h);
    h = pushHistory(h, "d");
    expect(canRedo(h)).toBe(false);
    expect(redo(h)).toBe(h);
  });

  it("valor igual ao atual não cria passo", () => {
    const h = createHistory("a");
    expect(pushHistory(h, "a")).toBe(h);
  });

  it("junta edições seguidas da mesma chave (digitação) num só passo, dentro da janela de tempo", () => {
    let h = createHistory("");
    h = pushHistory(h, "o", { key: "t", now: 1000 });
    h = pushHistory(h, "oi", { key: "t", now: 1300 });
    h = pushHistory(h, "oi!", { key: "t", now: 1900 });
    expect(h.past).toEqual([""]);
    expect(h.present).toBe("oi!");
    // chave diferente ou janela expirada = novo passo
    h = pushHistory(h, "oi!!", { key: "outra", now: 2000 });
    expect(h.past).toEqual(["", "oi!"]);
    h = pushHistory(h, "oi!!!", { key: "outra", now: 2000 + COALESCE_MS + 1 });
    expect(h.past).toHaveLength(3);
    expect(undo(h).present).toBe("oi!!");
  });

  it("guarda no máximo HISTORY_LIMIT passos", () => {
    let h = createHistory(0);
    for (let i = 1; i <= HISTORY_LIMIT + 20; i++) h = pushHistory(h, i);
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    expect(h.present).toBe(HISTORY_LIMIT + 20);
    expect(h.past[0]).toBe(20); // os 20 estados mais antigos (0..19) caíram
  });
});

describe("variáveis", () => {
  it("applyVariables troca as conhecidas e mantém as desconhecidas", () => {
    const data = sampleVariables("Grupo Axé", new Date(2026, 2, 12));
    expect(applyVariables("{aluno} — {grupo} em {data} ({dataExtenso}) {xpto}", data)).toBe(
      "Maria da Silva Santos — Grupo Axé em 12/03/2026 (12 de março de 2026) {xpto}",
    );
    expect(applyVariables("Código {codigo}", data)).toBe("Código EXEMPLO-0000");
    expect(applyVariables("{titulo} / {graduacao}", data)).toBe("Batizado e troca de corda / Corda Verde");
    expect(data.link).toMatch(/\/verificar\/EXEMPLO-0000$/);
    expect(sampleVariables(null).grupo).toBe("Seu grupo");
  });

  it("analyzeVariables aponta desconhecidas e chaves soltas", () => {
    expect(analyzeVariables("{aluno} e {grupo}")).toEqual({ unknown: [], stray: false });
    expect(analyzeVariables("{nome} {aluno}")).toEqual({ unknown: ["{nome}"], stray: false });
    expect(analyzeVariables("abre { sem fechar")).toEqual({ unknown: [], stray: true });
    expect(analyzeVariables("fecha } sozinho")).toEqual({ unknown: [], stray: true });
    expect(analyzeVariables("{{aluno}}").stray).toBe(true);
    expect(analyzeVariables("{}").unknown).toEqual(["{}"]);
    expect(analyzeVariables("{Aluno}").unknown).toEqual(["{Aluno}"]); // maiúsculas diferem
  });

  it("hasVerificationToken e insertAtCursor", () => {
    expect(hasVerificationToken("ver {codigo}")).toBe(true);
    expect(hasVerificationToken("ver {link}")).toBe(true);
    expect(hasVerificationToken("{aluno}")).toBe(false);
    expect(insertAtCursor("Olá , tudo bem", "{aluno}", 4, 4)).toEqual({ text: "Olá {aluno}, tudo bem", cursor: 11 });
    expect(insertAtCursor("abcdef", "X", 1, 4)).toEqual({ text: "aXef", cursor: 2 });
    expect(insertAtCursor("abc", "X", 99, 99).text).toBe("abcX");
  });
});

describe("validação local (espelho do §2)", () => {
  it("o modelo em branco é válido", () => {
    expect(validateLayout(blankLayout("landscape"))).toEqual([]);
    expect(validateLayout(blankLayout("portrait"))).toEqual([]);
  });

  it("exige exatamente 1 QR", () => {
    const none = { ...blankLayout(), elements: blankLayout().elements.filter((e) => e.type !== "qr") };
    expect(messages(none)).toContain("O modelo precisa do QR Code de verificação.");
    const two = { ...blankLayout(), elements: [...blankLayout().elements, defaultElement("qr", "landscape", "qr-2")] };
    expect(messages(two)).toContain("O modelo só pode ter um QR Code.");
  });

  it("exige um texto com {codigo} ou {link}", () => {
    const layout = updateElement(blankLayout(), "texto-verificacao", { text: "sem variavel" });
    expect(messages(layout).join(" ")).toMatch(/\{codigo\} ou \{link\}/);
    expect(validateLayout(updateElement(layout, "texto-verificacao", { text: "veja {link}" }))).toEqual([]);
  });

  it("variável desconhecida e chaves soltas (mensagem indica o elemento)", () => {
    let layout = updateElement(blankLayout(), "texto-principal", { text: "Olá {nome}" });
    let issues = validateLayout(layout);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ elementId: "texto-principal" });
    expect(issues[0]!.message).toMatch(/^Texto 1: variável desconhecida \{nome\}/);
    layout = updateElement(blankLayout(), "texto-principal", { text: "abre { e {aluno}" });
    issues = validateLayout(layout);
    expect(issues[0]!.message).toMatch(/\{ ou \} solto/);
  });

  it("texto vazio e acima de 500 caracteres", () => {
    expect(messages(updateElement(blankLayout(), "texto-principal", { text: "   " }))[0]).toMatch(/não pode ficar vazio/);
    expect(messages(updateElement(blankLayout(), "texto-principal", { text: "a".repeat(501) }))[0]).toMatch(/no máximo 500/);
    expect(validateLayout(updateElement(blankLayout(), "texto-principal", { text: "a".repeat(500) }))).toEqual([]);
  });

  it("cores só #RRGGBB (3 dígitos não); fundo e elementos", () => {
    const short = updateElement(blankLayout(), "texto-principal", { color: "#fff" });
    expect(messages(short)[0]).toMatch(/cor do texto.*#RRGGBB/);
    const bg = setBackground(blankLayout(), { color: "red" });
    expect(messages(bg)).toContain("A cor de fundo precisa estar no formato #RRGGBB.");
    const rect = { ...blankLayout(), elements: [...blankLayout().elements, { ...defaultElement("rect", "landscape", "r-1"), fill: "#12", stroke: "#GGGGGG" } as CertificateElement] };
    expect(messages(rect)).toHaveLength(2);
  });

  it("o QR precisa ser escuro (luminância <= 0.45) e caber na página", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 5);
    expect(isDarkEnoughForQr("#1F2937")).toBe(true);
    expect(isDarkEnoughForQr("#FFFFFF")).toBe(false);
    expect(isDarkEnoughForQr("#FFD700")).toBe(false);
    const light = updateElement(blankLayout(), "qr-verificacao", { fg: "#CCCCCC" });
    expect(messages(light)[0]).toMatch(/clara demais/);
    const out = { ...blankLayout(), elements: blankLayout().elements.map((e) => (e.type === "qr" ? ({ ...e, x: 99, y: 99 } as QrEl) : e)) };
    expect(messages(out)[0]).toMatch(/caber dentro da página/);
  });

  it("faixas numéricas: tamanho, entrelinha, espaçamento, caixa, opacidade", () => {
    const small = updateElement(blankLayout(), "texto-principal", { size: 100 });
    expect(validateLayout(small)).toEqual([]);
    const bad: TextEl = { ...text(blankLayout(), "texto-principal"), size: 5, lineHeight: 3, letterSpacing: 31 };
    const layout = { ...blankLayout(), elements: [bad, ...blankLayout().elements.slice(1)] };
    const joined = messages(layout).join("\n");
    expect(joined).toMatch(/tamanho da letra.*6 e 160/);
    expect(joined).toMatch(/entrelinha.*0\.8 e 2\.5/);
    expect(joined).toMatch(/espaçamento entre letras.*0 e 30/);
    const nan = { ...blankLayout(), elements: [{ ...bad, size: 20, lineHeight: 1, letterSpacing: 0, w: Number.NaN }, ...blankLayout().elements.slice(1)] };
    expect(messages(nan)[0]).toMatch(/caixa precisa ficar dentro da página/);
    const image = { ...(defaultElement("image", "landscape", "img-1") as ImageEl), opacity: 2 };
    expect(messages({ ...blankLayout(), elements: [...blankLayout().elements, image] })[0]).toMatch(/opacidade/);
  });

  it("limites: 40 elementos, 8 imagens (com o fundo) e ids únicos/válidos", () => {
    let many = blankLayout();
    while (many.elements.length < 41) many = { ...many, elements: [...many.elements, defaultElement("rect", "landscape", `r-${String(many.elements.length)}`)] };
    expect(messages(many)).toContain("O modelo pode ter no máximo 40 elementos.");

    let images = setBackground(blankLayout(), { imageRef: UPLOAD });
    for (let i = 0; i < 8; i++) images = { ...images, elements: [...images.elements, defaultElement("image", "landscape", `img-${String(i)}`)] };
    expect(countImages(images)).toBe(9);
    expect(messages(images)).toContain("O modelo pode ter no máximo 8 imagens (o fundo conta).");

    const dup = { ...blankLayout(), elements: [...blankLayout().elements, defaultElement("rect", "landscape", "texto-principal"), defaultElement("rect", "landscape", "ID Inválido")] };
    const joined = messages(dup).join("\n");
    expect(joined).toMatch(/identificador repetido/);
    expect(joined).toMatch(/identificador inválido/);
  });

  it("JSON do desenho acima de 64 KB é recusado", () => {
    const layout = blankLayout();
    const long = "a".repeat(500);
    const many: CertificateElement[] = [...layout.elements];
    for (let i = 0; i < 38; i++) many.push({ ...(defaultElement("text", "landscape", `t-${String(i)}`) as TextEl), text: long });
    const big = { ...layout, elements: many };
    expect(layoutBytes(big)).toBeLessThan(LIMITS.maxLayoutBytes); // 38 x ~0,8 KB: ainda cabe
    // "€" ocupa 3 bytes em UTF-8: o limite é em BYTES do JSON enviado.
    const huge = { ...big, elements: big.elements.map((e) => (e.type === "text" ? { ...e, text: "€".repeat(500) } : e)) };
    expect(layoutBytes(huge)).toBeGreaterThan(LIMITS.maxLayoutBytes);
    expect(messages(huge)).toContain("O desenho passou de 64 KB: remova alguns elementos ou textos longos.");
  });

  it("imagens só por referência de upload (sem URL externa)", () => {
    const ok = { ...(defaultElement("image", "landscape", "img-1") as ImageEl), ref: UPLOAD };
    expect(validateLayout({ ...blankLayout(), elements: [...blankLayout().elements, ok] })).toEqual([]);
    const external = { ...ok, ref: "https://exemplo.com/a.png" };
    expect(messages({ ...blankLayout(), elements: [...blankLayout().elements, external] })[0]).toMatch(/imagem enviada pelo painel/);
    expect(messages(setBackground(blankLayout(), { imageRef: "/api/uploads/../x.png" }))[0]).toMatch(/imagem de fundo/);
  });

  it("validateName: 1..60", () => {
    expect(validateName("  ")).toBe("Informe o nome do modelo.");
    expect(validateName("a".repeat(61))).toMatch(/no máximo 60/);
    expect(validateName("Batizado 2026")).toBeNull();
  });
});

describe("formato do fio (toWireLayout)", () => {
  it("só as chaves do contrato, cores em maiúsculo e opcionais preenchidos", () => {
    const dirty = {
      version: 1,
      page: { orientation: "landscape", background: { color: "#aabbcc", extra: 1 } },
      elements: [
        { ...(defaultElement("text", "landscape", "t-1") as TextEl), color: "#abcdef", lixo: true },
        { ...(defaultElement("image", "landscape", "i-1") as ImageEl), ref: undefined, selecionado: 1 },
        { ...defaultElement("rect", "landscape", "r-1"), fill: "#00ff00", stroke: null },
        { ...(defaultElement("qr", "landscape", "q-1") as QrEl), fg: "#0a0a0a", w: 9 },
      ],
    } as unknown as CertificateLayout;
    const wire = toWireLayout(dirty);
    expect(wire.page.background).toEqual({ color: "#AABBCC", imageRef: null, imageFit: "cover" });
    const keys = (id: string) => Object.keys(wire.elements.find((e) => e.id === id)!).sort();
    expect(keys("t-1")).toEqual(
      ["align", "bold", "color", "fontKey", "h", "id", "italic", "letterSpacing", "lineHeight", "size", "text", "type", "uppercase", "vAlign", "w", "x", "y"].sort(),
    );
    expect(keys("i-1")).toEqual(["fit", "h", "id", "opacity", "ref", "type", "useGroupLogo", "w", "x", "y"].sort());
    expect(keys("r-1")).toEqual(["fill", "fillOpacity", "h", "id", "radius", "stroke", "strokeWidth", "type", "w", "x", "y"].sort());
    expect(keys("q-1")).toEqual(["fg", "id", "size", "type", "x", "y"].sort());
    expect(wire.elements.find((e) => e.id === "t-1")).toMatchObject({ color: "#ABCDEF" });
    expect(wire.elements.find((e) => e.id === "r-1")).toMatchObject({ fill: "#00FF00" });
    expect(wire.elements.find((e) => e.id === "i-1")).toMatchObject({ ref: null });
    expect(wire.elements.find((e) => e.id === "q-1")).toMatchObject({ fg: "#0A0A0A" });
  });
});

// ------------------------------------------------------------------ linha e bloco de assinatura (contrato §2 LineEl e §8.1)

const line = (over: Partial<LineEl> = {}): LineEl => ({
  ...(defaultElement("line", "landscape", "linha-1") as LineEl),
  ...over,
});
/** Modelo em branco + os elementos dados (a linha vira o "Linha 4"). */
const withEls = (...els: CertificateElement[]): CertificateLayout => ({
  ...blankLayout(),
  elements: [...blankLayout().elements, ...els],
});
const overlaps = (a: Box, b: Box): boolean =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1e-9 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1e-9;

describe("linha: conformidade com o contrato", () => {
  it("constantes e rótulo em português", () => {
    expect(LIMITS.lineLength).toEqual({ min: 1, max: 100 });
    expect(LIMITS.lineThickness).toEqual({ min: 0.5, max: 10 });
    expect(ELEMENT_TYPE_LABEL.line).toBe("Linha");
    expect(ADDABLE_TYPES).toContain("line");
    expect(ADDABLE_TYPES).not.toContain("qr");
  });

  const contractPath = resolve(process.cwd(), "..", "docs", "CONTRATO_CERTIFICADOS_MODELOS.md");
  it.skipIf(!existsSync(contractPath))("LineEl do docs/CONTRATO_CERTIFICADOS_MODELOS.md: chaves, faixas e estilos batem com o painel", () => {
    const doc = readFileSync(contractPath, "utf8");
    const block = doc.match(/interface LineEl extends BaseEl \{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(block).not.toBe("");
    const code = block
      .split("\n")
      .map((l) => l.split("//")[0]!)
      .join(" ");
    const keys = [...code.matchAll(/(\w+)\??:/g)].map((m) => m[1]);
    const wire = toWireLayout(withEls(line())).elements.at(-1)!;
    expect([...keys].sort()).toEqual(Object.keys(wire).filter((k) => k !== "id").sort());
    const length = doc.match(/length: number;\s*\/\/ comprimento em % \((\d+)\.\.(\d+)\)/);
    expect([Number(length?.[1]), Number(length?.[2])]).toEqual([LIMITS.lineLength.min, LIMITS.lineLength.max]);
    const thickness = doc.match(/thickness: number;\s*\/\/ pt, ([\d.]+)\.\.(\d+)/);
    expect([Number(thickness?.[1]), Number(thickness?.[2])]).toEqual([LIMITS.lineThickness.min, LIMITS.lineThickness.max]);
    expect(code).toContain("'solid' | 'dashed' | 'dotted'");
    expect(code).toContain("'horizontal' | 'vertical'");
    expect(doc).toMatch(/CertificateElement = TextEl \| ImageEl \| RectEl \| LineEl \| QrEl/);
  });
});

describe("linha: criar, caixa de seleção e guias", () => {
  it("defaultElement('line'): horizontal, ~30% da largura, 1 pt, escura, sólida, dentro da página", () => {
    for (const orientation of ["landscape", "portrait"] as const) {
      const el = defaultElement("line", orientation, "linha-1") as LineEl;
      expect(el).toMatchObject({ id: "linha-1", type: "line", orientation: "horizontal", length: 30, thickness: 1, lineStyle: "solid" });
      expect(isDarkEnoughForQr(el.color)).toBe(true);
      expect(el.x + el.length).toBeLessThanOrEqual(100);
      const box = elementBox(el, orientation);
      expect(box.y + box.h).toBeLessThanOrEqual(100);
    }
  });

  it("elementBox é a caixa de SELEÇÃO (fina, ~2-3%, centrada na linha) e não altera os dados", () => {
    const el = line({ x: 35, y: 75, length: 30 });
    const box = elementBox(el, "landscape");
    expect(box).toMatchObject({ x: 35, w: 30 });
    expect(box.h).toBeCloseTo((LINE_HIT_PT / PAGE_PT.landscape.h) * 100, 1);
    expect(box.h).toBeGreaterThanOrEqual(2);
    expect(box.h).toBeLessThanOrEqual(3.5);
    expect(box.y + box.h / 2).toBeCloseTo(75, 1);
    expect(lineOffsetPct(el, box)).toBeCloseTo(50, 0);
    const vertical = line({ orientation: "vertical", x: 20, y: 10, length: 40 });
    const vbox = elementBox(vertical, "landscape");
    expect(vbox).toMatchObject({ y: 10, h: 40 });
    expect(vbox.w).toBeGreaterThanOrEqual(1.9);
    expect(vbox.w).toBeLessThanOrEqual(3.5);
    expect(vbox.x + vbox.w / 2).toBeCloseTo(20, 1);
    // nas bordas da página a caixa continua dentro dela e a linha continua dentro da caixa
    const top = line({ y: 0 });
    expect(elementBox(top, "landscape").y).toBe(0);
    expect(lineOffsetPct(top, elementBox(top, "landscape"))).toBe(0);
    const bottom = line({ y: 100 });
    const bbox = elementBox(bottom, "landscape");
    expect(bbox.y + bbox.h).toBeLessThanOrEqual(100);
    expect(lineOffsetPct(bottom, bbox)).toBeCloseTo(100, 5);
    expect(el).toEqual(line({ x: 35, y: 75, length: 30 })); // o dado não mudou
  });

  it("snapBox: espessura zero (a guia é a própria linha); os outros tipos seguem a elementBox", () => {
    expect(snapBox(line({ x: 10, y: 20, length: 30 }), "landscape")).toEqual({ x: 10, y: 20, w: 30, h: 0 });
    expect(snapBox(line({ orientation: "vertical", x: 20, y: 10, length: 40 }), "landscape")).toEqual({ x: 20, y: 10, w: 0, h: 40 });
    const rect = defaultElement("rect", "landscape", "r-1");
    expect(snapBox(rect, "landscape")).toEqual(elementBox(rect, "landscape"));
  });

  it("lineDash: sólida sem traço; tracejada e pontilhada proporcionais à espessura", () => {
    expect(lineDash({ lineStyle: "solid", thickness: 3 })).toEqual({ dasharray: undefined, cap: "butt" });
    expect(lineDash({ lineStyle: "dashed", thickness: 1 })).toEqual({ dasharray: "4 3", cap: "butt" });
    expect(lineDash({ lineStyle: "dashed", thickness: 2 })).toEqual({ dasharray: "8 6", cap: "butt" });
    expect(lineDash({ lineStyle: "dotted", thickness: 1 })).toEqual({ dasharray: "0.01 3", cap: "round" });
    expect(lineDash({ lineStyle: "dotted", thickness: 4 })).toEqual({ dasharray: "0.01 10", cap: "round" });
  });

  it("alças só nas duas pontas", () => {
    expect(lineHandles(line())).toEqual(["w", "e"]);
    expect(lineHandles(line({ orientation: "vertical" }))).toEqual(["n", "s"]);
  });
});

describe("linha: clamp, mover e redimensionar", () => {
  it("clampElement: horizontal x+length<=100, vertical y+length<=100, comprimento 1..100", () => {
    expect(clampElement(line({ x: 90, length: 30 }), "landscape")).toMatchObject({ x: 70, length: 30 });
    expect(clampElement(line({ x: -5, y: 120, length: 30 }), "landscape")).toMatchObject({ x: 0, y: 100 });
    expect(clampElement(line({ length: 500 }), "landscape")).toMatchObject({ x: 0, length: 100 });
    expect(clampElement(line({ length: 0 }), "landscape").length).toBe(1);
    expect(clampElement(line({ orientation: "vertical", x: 50, y: 90, length: 30 }), "portrait")).toMatchObject({ x: 50, y: 70, length: 30 });
    // y de uma linha horizontal e x de uma vertical só precisam estar em 0..100 (não somam o comprimento)
    expect(clampElement(line({ y: 99, length: 30 }), "landscape")).toMatchObject({ y: 99, length: 30 });
    const odd = clampElement(line({ x: 66.667, length: 33.333 }), "landscape");
    expect(odd.x + odd.length).toBeLessThanOrEqual(100);
  });

  it("moveElement nunca sai da página (horizontal e vertical)", () => {
    expect(moveElement(line({ x: 35, y: 75, length: 30 }), 500, 500, "landscape")).toMatchObject({ x: 70, y: 100 });
    expect(moveElement(line({ x: 35, y: 75, length: 30 }), -500, -500, "landscape")).toMatchObject({ x: 0, y: 0 });
    const vertical = line({ orientation: "vertical", x: 20, y: 10, length: 40 });
    expect(moveElement(vertical, 500, 500, "landscape")).toMatchObject({ x: 100, y: 60 });
    expect(moveElement(vertical, -500, -500, "landscape")).toMatchObject({ x: 0, y: 0 });
  });

  it("trocar a orientação reencaixa a linha dentro da página", () => {
    let layout = withEls(line({ id: "l1", x: 70, y: 90, length: 30 }));
    layout = updateElement(layout, "l1", { orientation: "vertical" });
    expect(layout.elements.at(-1)).toMatchObject({ orientation: "vertical", x: 70, y: 70, length: 30 });
    expect(validateLayout(layout)).toEqual([]);
    layout = updateElement(layout, "l1", { orientation: "horizontal", length: 100 });
    expect(layout.elements.at(-1)).toMatchObject({ orientation: "horizontal", x: 0, length: 100 });
    layout = updateElement(layout, "l1", { thickness: 3, color: "#AA0000", lineStyle: "dotted" });
    expect(layout.elements.at(-1)).toMatchObject({ thickness: 3, color: "#AA0000", lineStyle: "dotted" });
    expect(validateLayout(layout)).toEqual([]);
  });

  it("resizeLine horizontal: só as pontas (e/w); a outra ponta fica parada; mínimo e página respeitados", () => {
    const h = line({ x: 30, y: 50, length: 40 }); // de 30 a 70
    expect(resizeLine(h, "e", 10, 999)).toMatchObject({ x: 30, y: 50, length: 50 });
    expect(resizeLine(h, "w", -10, 999)).toMatchObject({ x: 20, y: 50, length: 50 });
    expect(resizeLine(h, "w", 10, 0)).toMatchObject({ x: 40, length: 30 });
    expect(resizeLine(h, "e", -500, 0)).toMatchObject({ x: 30, length: 2 });
    expect(resizeLine(h, "w", 500, 0)).toMatchObject({ x: 68, length: 2 });
    expect(resizeLine(h, "e", 500, 0)).toMatchObject({ x: 30, length: 70 });
    expect(resizeLine(h, "w", -500, 0)).toMatchObject({ x: 0, length: 70 });
    // alça que não é de ponta não faz nada
    expect(resizeLine(h, "n", 0, 10)).toBe(h);
    expect(resizeLine(h, "s", 0, 10)).toBe(h);
    // Alt+setas (teclado) usa "se": numa horizontal é a ponta final
    expect(resizeElement(h, "se", 1, 1, "landscape")).toMatchObject({ length: 41, y: 50 });
  });

  it("resizeLine vertical: só as pontas (n/s)", () => {
    const v = line({ orientation: "vertical", x: 60, y: 10, length: 30 }); // de 10 a 40
    expect(resizeLine(v, "s", 999, 15)).toMatchObject({ x: 60, y: 10, length: 45 });
    expect(resizeLine(v, "n", 0, -5)).toMatchObject({ x: 60, y: 5, length: 35 });
    expect(resizeLine(v, "s", 0, 500)).toMatchObject({ y: 10, length: 90 });
    expect(resizeLine(v, "n", 0, -500)).toMatchObject({ y: 0, length: 40 });
    expect(resizeLine(v, "n", 0, 500)).toMatchObject({ y: 38, length: 2 });
    expect(resizeLine(v, "e", 50, 0)).toBe(v);
    expect(resizeLine(v, "w", 50, 0)).toBe(v);
    expect(resizeElement(v, "se", 5, 5, "landscape")).toMatchObject({ y: 10, length: 35 });
  });

  it("snapLineResize: só a ponta que se move gruda (centro/bordas da página e de outros elementos)", () => {
    const end = snapLineResize(line({ x: 10, length: 39.4 }), "e", []); // ponta final 49.4 -> 50
    expect(end.line.length).toBeCloseTo(40, 5);
    expect(end.line.x).toBe(10);
    expect(end.guides).toContainEqual({ axis: "x", pos: 50 });
    const start = snapLineResize(line({ x: 60.6, length: 20 }), "w", [{ x: 40, y: 60, w: 20, h: 10 }]); // 60.6 -> 60
    expect(start.line.x).toBeCloseTo(60, 5);
    expect(start.line.x + start.line.length).toBeCloseTo(80.6, 5); // a ponta final não mexeu
    expect(start.guides).toContainEqual({ axis: "x", pos: 60 });
    const vertical = snapLineResize(line({ orientation: "vertical", y: 10, length: 39.5 }), "s", []); // 49.5 -> 50
    expect(vertical.line.length).toBeCloseTo(40, 5);
    expect(vertical.guides).toContainEqual({ axis: "y", pos: 50 });
    const same = line();
    expect(snapLineResize(same, "n", []).line).toBe(same);
  });

  it("snapMove com a linha: o centro e a posição Y da própria linha grudam (não a caixa de seleção)", () => {
    const moved = line({ x: 35.4, y: 49.7, length: 30 }); // centro x = 50.4; y = 49.7
    const snap = snapMove(snapBox(moved, "landscape"), []);
    expect(snap.dx).toBeCloseTo(-0.4, 5);
    expect(snap.dy).toBeCloseTo(0.3, 5);
    expect(snap.guides).toContainEqual({ axis: "x", pos: 50 });
    expect(snap.guides).toContainEqual({ axis: "y", pos: 50 });
  });
});

describe("linha: duplicar, remover, ordem, página e limites", () => {
  it("duplicar: id novo, logo acima do original, deslocada 2% e dentro da página", () => {
    const layout = withEls(line({ id: "l1", x: 35, y: 75 }));
    const dup = duplicateElement(layout, "l1")!;
    expect(dup.id).not.toBe("l1");
    const order = dup.layout.elements.map((e) => e.id);
    expect(order.indexOf(dup.id)).toBe(order.indexOf("l1") + 1);
    expect(dup.layout.elements.find((e) => e.id === dup.id)).toMatchObject({ type: "line", x: 37, y: 77, length: 30, orientation: "horizontal" });
    const edge = duplicateElement(withEls(line({ id: "v1", orientation: "vertical", x: 99, y: 80, length: 20 })), "v1")!;
    expect(edge.layout.elements.find((e) => e.id === edge.id)).toMatchObject({ x: 100, y: 80, length: 20 });
    expect(validateLayout(edge.layout)).toEqual([]);
  });

  it("remover e ordenar valem para a linha; trocar a orientação da página mantém tudo válido", () => {
    const layout = withEls(line({ id: "l1" }));
    expect(removeElement(layout, "l1").elements.map((e) => e.id)).not.toContain("l1");
    expect(reorderElement(layout, "l1", "back").elements[0]!.id).toBe("l1");
    expect(canReorder(layout, "l1", "front")).toBe(false);
    expect(validateLayout(setOrientation(layout, "portrait"))).toEqual([]);
  });

  it("addDefaultElement('line') coloca a linha num lugar livre (sem encostar nos outros elementos)", () => {
    for (const orientation of ["landscape", "portrait"] as const) {
      const base = blankLayout(orientation);
      const added = addDefaultElement(base, "line")!;
      const el = added.layout.elements.at(-1) as LineEl;
      expect(el.id).toBe(added.id);
      expect(el).toMatchObject({ x: 35, y: 75, orientation: "horizontal", length: 30, thickness: 1, lineStyle: "solid" });
      expect(validateLayout(added.layout)).toEqual([]);
      for (const other of base.elements) expect(overlaps(elementBox(el, orientation), elementBox(other, orientation))).toBe(false);
    }
    // faixa ocupada onde ela nasceria: a linha vai para outro ponto livre
    const strip = { x: 0, y: 70, w: 100, h: 10 };
    const busy = withEls({ ...defaultElement("rect", "landscape", "faixa"), ...strip } as CertificateElement);
    const moved = addDefaultElement(busy, "line")!.layout.elements.at(-1) as LineEl;
    expect(overlaps(elementBox(moved, "landscape"), strip)).toBe(false);
    // moldura da página inteira é decoração: não bloqueia
    const framed = withEls({ ...defaultElement("rect", "landscape", "moldura"), x: 2, y: 2, w: 96, h: 96, fill: null, stroke: "#C2410C" } as CertificateElement);
    expect(addDefaultElement(framed, "line")!.layout.elements.at(-1)).toMatchObject({ x: 35, y: 75 });
  });

  it("a linha conta nos 40 elementos (adicionar, duplicar e validar)", () => {
    let layout = blankLayout();
    while (layout.elements.length < LIMITS.maxElements) {
      const next = addDefaultElement(layout, "line");
      expect(next).not.toBeNull();
      layout = next!.layout;
    }
    expect(layout.elements).toHaveLength(40);
    expect(addDefaultElement(layout, "line")).toBeNull();
    expect(whyCannotAdd(layout, "line")).toMatch(/40 elementos/);
    expect(duplicateElement(layout, layout.elements.at(-1)!.id)).toBeNull();
    expect(validateLayout(layout).map((i) => i.message)).toEqual([]);
    expect(messages({ ...layout, elements: [...layout.elements, line({ id: "extra" })] })).toContain("O modelo pode ter no máximo 40 elementos.");
  });
});

describe("linha: validação (espelho do §2)", () => {
  it("linha válida, inclusive nos extremos das faixas", () => {
    expect(validateLayout(withEls(line()))).toEqual([]);
    expect(validateLayout(withEls(line({ x: 0, length: 100, thickness: 0.5 })))).toEqual([]);
    expect(validateLayout(withEls(line({ orientation: "vertical", x: 100, y: 0, length: 100, thickness: 10, lineStyle: "dotted" })))).toEqual([]);
    expect(validateLayout(withEls(line({ lineStyle: "dashed" })))).toEqual([]);
    // y de horizontal / x de vertical podem ser qualquer valor de 0..100 (só o eixo da linha soma o comprimento)
    expect(validateLayout(withEls(line({ y: 100, length: 30 })))).toEqual([]);
    expect(validateLayout(withEls(line({ orientation: "vertical", x: 80, y: 0, length: 30 })))).toEqual([]);
  });

  it("'não cabe': horizontal x+length>100 e vertical y+length>100 (mensagem indica o elemento)", () => {
    const horizontal = validateLayout(withEls(line({ id: "l1", x: 80, length: 30 })));
    expect(horizontal).toHaveLength(1);
    expect(horizontal[0]).toMatchObject({ elementId: "l1" });
    expect(horizontal[0]!.message).toBe("Linha 4: a linha precisa caber dentro da página (comprimento de pelo menos 1%).");
    const vertical = validateLayout(withEls(line({ id: "v1", orientation: "vertical", x: 10, y: 80, length: 30 })));
    expect(vertical).toHaveLength(1);
    expect(vertical[0]).toMatchObject({ elementId: "v1" });
    expect(vertical[0]!.message).toMatch(/^Linha 4: a linha precisa caber dentro da página/);
    // fora das faixas de posição/comprimento
    for (const bad of [{ x: -1 }, { y: 101 }, { length: 0.5 }, { length: 101 }, { x: Number.NaN }, { length: Number.NaN }]) {
      expect(messages(withEls(line(bad))).join(" ")).toMatch(/a linha precisa caber dentro da página/);
    }
  });

  it("espessura fora de 0,5..10 pt, cor, estilo e orientação inválidos", () => {
    for (const thickness of [0.4, 0, 10.5, -1, Number.NaN]) {
      const issues = validateLayout(withEls(line({ id: "l1", thickness })));
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ elementId: "l1" });
      expect(issues[0]!.message).toBe("Linha 4: a espessura da linha precisa ficar entre 0.5 e 10 pt.");
    }
    expect(messages(withEls(line({ color: "#fff" })))[0]).toMatch(/^Linha 4: a cor da linha precisa estar no formato #RRGGBB/);
    expect(messages(withEls(line({ lineStyle: "wavy" as never })))[0]).toMatch(/estilo da linha inválido/);
    expect(messages(withEls(line({ orientation: "diagonal" as never })))[0]).toMatch(/orientação da linha inválida/);
  });
});

describe("linha: formato do fio (toWireLayout)", () => {
  it("só as chaves do contrato, cor em maiúsculo, sem sobras da caixa de seleção", () => {
    const dirty = { ...line({ id: "l-1", color: "#1f2937", thickness: 2.5, lineStyle: "dashed" }), lixo: true, w: 9, h: 9, selecionado: 1 } as unknown as LineEl;
    const wire = toWireLayout(withEls(dirty));
    const out = wire.elements.at(-1)!;
    expect(Object.keys(out).sort()).toEqual(["color", "id", "length", "lineStyle", "orientation", "thickness", "type", "x", "y"]);
    expect(out).toEqual({
      id: "l-1",
      type: "line",
      x: 35,
      y: 75,
      length: 30,
      orientation: "horizontal",
      color: "#1F2937",
      thickness: 2.5,
      lineStyle: "dashed",
    });
    const nan = toWireLayout(withEls(line({ thickness: Number.NaN }))).elements.at(-1) as LineEl;
    expect(nan.thickness).toBe(1);
  });
});

describe("Bloco de assinatura (atalho: linha + texto)", () => {
  it("insere DOIS elementos independentes de uma vez, com ids novos e únicos, logo abaixo um do outro", () => {
    for (const orientation of ["landscape", "portrait"] as const) {
      const base = blankLayout(orientation);
      const result = addSignatureBlock(base)!;
      expect(result.layout.elements).toHaveLength(base.elements.length + 2);
      expect(result.layout.elements.slice(0, base.elements.length)).toEqual(base.elements); // nada do que existia mudou
      const [ln, tx] = result.layout.elements.slice(-2) as [LineEl, TextEl];
      expect([ln.id, tx.id]).toEqual([result.lineId, result.textId]);
      expect(new Set(result.layout.elements.map((e) => e.id)).size).toBe(result.layout.elements.length);
      expect(ELEMENT_ID.test(ln.id) && ELEMENT_ID.test(tx.id)).toBe(true);
      expect(ln).toMatchObject({ type: "line", orientation: "horizontal", length: 30, thickness: 1, lineStyle: "solid" });
      expect(isDarkEnoughForQr(ln.color)).toBe(true);
      expect(tx).toMatchObject({
        type: "text",
        text: "Assinatura",
        fontKey: "helvetica",
        size: 12,
        align: "center",
        vAlign: "top",
        h: 5,
        bold: false,
        italic: false,
        uppercase: false,
      });
      expect(isDarkEnoughForQr(tx.color)).toBe(true);
      // mesma largura e mesmo x da linha; a caixa do texto começa logo abaixo dela
      expect(tx.x).toBe(ln.x);
      expect(tx.w).toBe(ln.length);
      expect(tx.y).toBeCloseTo(ln.y + SIGNATURE_BLOCK.gap, 5);
      expect(tx.y + tx.h).toBeLessThanOrEqual(100);
      expect(ln.x + ln.length).toBeLessThanOrEqual(100);
      // válido e sem passar por cima do QR nem dos outros elementos
      expect(validateLayout(result.layout)).toEqual([]);
      const blockBox: Box = { x: ln.x, y: ln.y, w: ln.length, h: SIGNATURE_BLOCK.gap + SIGNATURE_BLOCK.textHeight };
      for (const other of base.elements) expect(overlaps(blockBox, elementBox(other, orientation))).toBe(false);
      // rodapé (parte de baixo da folha)
      expect(ln.y).toBeGreaterThanOrEqual(60);
    }
    // posição determinística no modelo em branco (acima da linha de verificação, longe do QR)
    expect(addSignatureBlock(blankLayout())!.layout.elements.at(-2)).toMatchObject({ x: 35, y: 80 });
  });

  it("vai para outra área livre quando o rodapé está ocupado e nunca falha por falta de espaço", () => {
    const strip = { x: 0, y: 78, w: 100, h: 20 };
    const busy = withEls({ ...defaultElement("rect", "landscape", "rodape"), ...strip } as CertificateElement);
    const placed = addSignatureBlock(busy)!;
    const [ln, tx] = placed.layout.elements.slice(-2) as [LineEl, TextEl];
    const blockBox: Box = { x: ln.x, y: ln.y, w: ln.length, h: tx.y + tx.h - ln.y };
    for (const other of busy.elements) expect(overlaps(blockBox, elementBox(other, "landscape"))).toBe(false);
    // folha toda coberta por faixas (nenhuma é "decoração"): ainda insere, no ponto de menor sobreposição
    const strips = [0, 25, 50, 75].map((y, i) => ({ ...defaultElement("rect", "landscape", `faixa-${String(i)}`), x: 0, y, w: 100, h: 25 }) as CertificateElement);
    const crowded = addSignatureBlock(withEls(...strips))!;
    expect(crowded.layout.elements).toHaveLength(blankLayout().elements.length + 4 + 2);
    expect(validateLayout(crowded.layout)).toEqual([]);
  });

  it("respeita o limite de 40 elementos (usa 2): sem espaço devolve null e o motivo em português", () => {
    let layout = blankLayout();
    while (layout.elements.length < 38) layout = addDefaultElement(layout, "rect")!.layout;
    expect(whyCannotAddSignatureBlock(layout)).toBeNull();
    const fits = addSignatureBlock(layout)!;
    expect(fits.layout.elements).toHaveLength(40);
    expect(validateLayout(fits.layout)).toEqual([]);
    layout = addDefaultElement(layout, "rect")!.layout; // 39
    expect(addSignatureBlock(layout)).toBeNull();
    expect(whyCannotAddSignatureBlock(layout)).toBe("O bloco de assinatura usa 2 elementos e o modelo já tem 39 de 40.");
    expect(layout.elements).toHaveLength(39);
  });

  it("ids continuam únicos mesmo com o sorteio devolvendo sempre o mesmo valor", () => {
    const result = addSignatureBlock(blankLayout(), () => 0.123456)!;
    expect(result.lineId).not.toBe(result.textId);
    expect(new Set(result.layout.elements.map((e) => e.id)).size).toBe(result.layout.elements.length);
    expect(ELEMENT_ID.test(result.textId)).toBe(true);
  });
});
