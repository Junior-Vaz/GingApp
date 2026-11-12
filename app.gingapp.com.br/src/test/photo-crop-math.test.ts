import { describe, expect, it } from "vitest";
import {
  QUALITY_STEPS,
  SQUARE_DIMENSIONS,
  WIDE_DIMENSIONS,
  ZOOM_MAX,
  ZOOM_MIN,
  buildDrawPlan,
  buildLadder,
  clampPan,
  clampZoom,
  coverScale,
  coverSquare,
  cropRect,
  fitWithin,
  fromNormalized,
  imageBox,
  imageToScreen,
  initialView,
  maxPan,
  normalizeView,
  panBy,
  screenToImage,
  toNormalized,
  zoomAt,
  type Size,
  type ViewState,
} from "@/lib/photo/crop-math";

/** Gerador pseudoaleatório determinístico (mulberry32): os testes de propriedade são reproduzíveis. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EPS = 1e-6;
const CASES = 600;

interface Scenario {
  image: Size;
  viewport: number;
  view: ViewState;
}

function scenarios(seed: number, count = CASES): Scenario[] {
  const rand = rng(seed);
  const between = (min: number, max: number) => min + rand() * (max - min);
  const out: Scenario[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      image: { width: Math.round(between(1, 9000)), height: Math.round(between(1, 9000)) },
      viewport: between(40, 700),
      // valores fora da faixa e até absurdos: o recorte tem de aguentar qualquer entrada
      view: { zoom: between(-2, 9), panX: between(-5000, 5000), panY: between(-5000, 5000) },
    });
  }
  return out;
}

describe("crop-math: zoom", () => {
  it("clampZoom fica sempre em [1, 4], inclusive com NaN/Infinity", () => {
    for (const value of [-5, 0, 0.99, 1, 2.5, 4, 4.01, 100, Number.NaN, Infinity, -Infinity]) {
      const zoom = clampZoom(value);
      expect(zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(zoom).toBeLessThanOrEqual(ZOOM_MAX);
    }
    expect(clampZoom(Number.NaN)).toBe(ZOOM_MIN);
    expect(clampZoom(Infinity)).toBe(ZOOM_MAX);
    expect(clampZoom(2.5)).toBe(2.5);
  });

  it("zoomAt respeita os limites de zoom em qualquer cenário", () => {
    for (const { image, viewport, view } of scenarios(1)) {
      const next = zoomAt(view, view.zoom * 3, { x: 17, y: -9 }, image, viewport);
      expect(next.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(next.zoom).toBeLessThanOrEqual(ZOOM_MAX);
    }
  });

  it("zoomAt mantém fixo o ponto da imagem sob a âncora (quando nenhum limite atua)", () => {
    // Imagem grande e zoom no meio da faixa: o clamp do pan não interfere.
    const image = { width: 4000, height: 3000 };
    const viewport = 300;
    const view: ViewState = { zoom: 2, panX: 10, panY: -20 };
    const anchor = { x: 40, y: 25 }; // relativo ao centro
    const before = screenToImage(
      { x: anchor.x + viewport / 2, y: anchor.y + viewport / 2 },
      view,
      image,
      viewport,
    );
    const next = zoomAt(view, 2.8, anchor, image, viewport);
    const after = screenToImage(
      { x: anchor.x + viewport / 2, y: anchor.y + viewport / 2 },
      next,
      image,
      viewport,
    );
    expect(after.x).toBeCloseTo(before.x, 4);
    expect(after.y).toBeCloseTo(before.y, 4);
  });
});

describe("crop-math: pan", () => {
  it("clampPan nunca deixa a janela vazia: a imagem sempre cobre a janela", () => {
    for (const { image, viewport, view } of scenarios(2)) {
      const v = normalizeView(view, image, viewport);
      const box = imageBox(v, image, viewport);
      // bordas da imagem não podem entrar na janela [0, viewport]
      expect(box.left).toBeLessThanOrEqual(EPS);
      expect(box.top).toBeLessThanOrEqual(EPS);
      expect(box.left + box.width).toBeGreaterThanOrEqual(viewport - EPS * Math.max(1, viewport));
      expect(box.top + box.height).toBeGreaterThanOrEqual(viewport - EPS * Math.max(1, viewport));
    }
  });

  it("clampPan é idempotente e fica dentro de ±maxPan", () => {
    for (const { image, viewport, view } of scenarios(3)) {
      const zoom = clampZoom(view.zoom);
      const once = clampPan({ x: view.panX, y: view.panY }, image, viewport, zoom);
      const twice = clampPan(once, image, viewport, zoom);
      const limit = maxPan(image, viewport, zoom);
      expect(twice.x).toBeCloseTo(once.x, 9);
      expect(twice.y).toBeCloseTo(once.y, 9);
      expect(Math.abs(once.x)).toBeLessThanOrEqual(limit.x + EPS);
      expect(Math.abs(once.y)).toBeLessThanOrEqual(limit.y + EPS);
    }
  });

  it("com zoom 1 a imagem quadrada não anda (pan zero); a retangular só anda no lado maior", () => {
    expect(maxPan({ width: 1000, height: 1000 }, 300, 1)).toEqual({ x: 0, y: 0 });
    const wide = maxPan({ width: 2000, height: 1000 }, 300, 1);
    expect(wide.x).toBeCloseTo(150, 6);
    expect(wide.y).toBe(0);
    const tall = maxPan({ width: 1000, height: 2000 }, 300, 1);
    expect(tall.x).toBe(0);
    expect(tall.y).toBeCloseTo(150, 6);
  });

  it("panBy arrastado para longe fica preso na borda (e NaN vira zero)", () => {
    const image = { width: 4000, height: 3000 };
    const far = panBy(initialView(), 99999, -99999, image, 280);
    const limit = maxPan(image, 280, 1);
    expect(far.panX).toBeCloseTo(limit.x, 6);
    expect(far.panY).toBeCloseTo(-limit.y, 6);
    const nan = panBy(initialView(), Number.NaN, Number.NaN, image, 280);
    expect(nan.panX).toBe(0);
    expect(nan.panY).toBe(0);
  });
});

describe("crop-math: retângulo de recorte (cover)", () => {
  it("é sempre QUADRADO, positivo e totalmente DENTRO da imagem", () => {
    for (const { image, viewport, view } of scenarios(4, 1500)) {
      const rect = cropRect(view, image, viewport);
      expect(rect.size).toBeGreaterThan(0);
      expect(rect.x).toBeGreaterThanOrEqual(-EPS);
      expect(rect.y).toBeGreaterThanOrEqual(-EPS);
      expect(rect.x + rect.size).toBeLessThanOrEqual(image.width + EPS * image.width);
      expect(rect.y + rect.size).toBeLessThanOrEqual(image.height + EPS * image.height);
      expect(rect.size).toBeLessThanOrEqual(Math.min(image.width, image.height) + EPS);
    }
  });

  it("zoom 1 sem pan = quadrado central de lado min(w, h); zoom máximo divide o lado por 4", () => {
    const image = { width: 4000, height: 3000 };
    const full = cropRect(initialView(), image, 280);
    expect(full.size).toBeCloseTo(3000, 6);
    expect(full.x).toBeCloseTo(500, 6);
    expect(full.y).toBeCloseTo(0, 6);
    const zoomed = cropRect({ zoom: ZOOM_MAX, panX: 0, panY: 0 }, image, 280);
    expect(zoomed.size).toBeCloseTo(750, 6);
    expect(zoomed.x).toBeCloseTo(2000 - 375, 6);
    expect(zoomed.y).toBeCloseTo(1500 - 375, 6);
  });

  it("arrastar a imagem para a direita mostra a esquerda dela (e vice-versa)", () => {
    const image = { width: 4000, height: 3000 };
    const right = cropRect(panBy(initialView(), 9999, 0, image, 280), image, 280);
    const left = cropRect(panBy(initialView(), -9999, 0, image, 280), image, 280);
    expect(right.x).toBeCloseTo(0, 6);
    expect(left.x).toBeCloseTo(1000, 6); // 4000 - 3000
  });

  it("o retângulo corresponde ao que a tela mostra: cantos da janela mapeiam para os cantos do recorte", () => {
    for (const { image, viewport, view } of scenarios(5, 300)) {
      const v = normalizeView(view, image, viewport);
      const rect = cropRect(v, image, viewport);
      const topLeft = screenToImage({ x: 0, y: 0 }, v, image, viewport);
      const bottomRight = screenToImage({ x: viewport, y: viewport }, v, image, viewport);
      const tol = 1e-6 * Math.max(image.width, image.height);
      expect(topLeft.x).toBeCloseTo(rect.x, 3);
      expect(topLeft.y).toBeCloseTo(rect.y, 3);
      expect(bottomRight.x - topLeft.x).toBeCloseTo(rect.size, 3);
      expect(Math.abs(bottomRight.y - topLeft.y - rect.size)).toBeLessThanOrEqual(tol + 1e-3);
    }
  });

  it("screenToImage e imageToScreen são inversas", () => {
    for (const { image, viewport, view } of scenarios(6, 300)) {
      const v = normalizeView(view, image, viewport);
      const point = { x: viewport * 0.37, y: viewport * 0.81 };
      const back = imageToScreen(screenToImage(point, v, image, viewport), v, image, viewport);
      expect(back.x).toBeCloseTo(point.x, 4);
      expect(back.y).toBeCloseTo(point.y, 4);
    }
  });

  it("coverScale faz o lado menor ocupar a janela inteira", () => {
    expect(coverScale({ width: 4000, height: 3000 }, 300) * 3000).toBeCloseTo(300, 9);
    expect(coverScale({ width: 500, height: 900 }, 250) * 500).toBeCloseTo(250, 9);
  });

  it("coverSquare centraliza o quadrado de lado min(w, h)", () => {
    expect(coverSquare({ width: 4000, height: 3000 })).toEqual({ x: 500, y: 0, size: 3000 });
    expect(coverSquare({ width: 600, height: 900 })).toEqual({ x: 0, y: 150, size: 600 });
  });
});

describe("crop-math: recorte normalizado", () => {
  it("ida e volta preserva o retângulo e funciona em OUTRA escala de decodificação", () => {
    const rect = { x: 500, y: 100, size: 2000 };
    const norm = toNormalized(rect, { width: 4000, height: 3000 });
    expect(norm).toEqual({ x: 0.125, y: 100 / 3000, width: 0.5, height: 2000 / 3000 });
    const half = fromNormalized(norm, { width: 2000, height: 1500 });
    expect(half).toEqual({ x: 250, y: 50, size: 1000 });
  });

  it("fromNormalized sempre devolve um quadrado dentro da imagem, mesmo com lixo na entrada", () => {
    const rand = rng(7);
    for (let i = 0; i < CASES; i++) {
      const image = { width: Math.round(1 + rand() * 6000), height: Math.round(1 + rand() * 6000) };
      const crop = { x: rand() * 3 - 1, y: rand() * 3 - 1, width: rand() * 3, height: rand() * 3 };
      const rect = fromNormalized(crop, image);
      expect(rect.size).toBeGreaterThanOrEqual(1);
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.size).toBeLessThanOrEqual(image.width);
      expect(rect.y + rect.size).toBeLessThanOrEqual(image.height);
    }
    expect(
      fromNormalized(
        { x: Number.NaN, y: Number.NaN, width: Number.NaN, height: Number.NaN },
        { width: 10, height: 10 },
      ).size,
    ).toBe(10);
  });
});

describe("crop-math: escada de qualidade e dimensão", () => {
  it("square: 800 -> 600 -> 480, cada uma com qualidade 0,9 -> 0,5 (qualidade desce ANTES da dimensão)", () => {
    const ladder = buildLadder("square", 4000);
    expect(ladder).toHaveLength(SQUARE_DIMENSIONS.length * QUALITY_STEPS.length);
    expect(ladder[0]).toEqual({ quality: 0.9, dimension: 800 });
    expect(ladder[4]).toEqual({ quality: 0.5, dimension: 800 });
    expect(ladder[5]).toEqual({ quality: 0.9, dimension: 600 });
    expect(ladder.at(-1)).toEqual({ quality: 0.5, dimension: 480 });
  });

  it("wide: lado maior parte de 1600", () => {
    const ladder = buildLadder("wide", 5000);
    expect(ladder[0]).toEqual({ quality: 0.9, dimension: 1600 });
    expect(new Set(ladder.map((s) => s.dimension))).toEqual(new Set(WIDE_DIMENSIONS));
  });

  it("propriedade: nunca amplia, dimensão e qualidade nunca sobem, sem repetir passos", () => {
    const rand = rng(8);
    for (let i = 0; i < CASES; i++) {
      const side = Math.round(1 + rand() * 6000);
      for (const shape of ["square", "wide"] as const) {
        const ladder = buildLadder(shape, side);
        expect(ladder.length).toBeGreaterThan(0);
        const keys = new Set<string>();
        ladder.forEach((step, index) => {
          expect(step.dimension).toBeLessThanOrEqual(side);
          expect(step.dimension).toBeGreaterThanOrEqual(1);
          expect(step.quality).toBeGreaterThanOrEqual(0.5);
          expect(step.quality).toBeLessThanOrEqual(0.9);
          keys.add(`${step.dimension}@${step.quality}`);
          const prev = ladder[index - 1];
          if (prev) {
            expect(step.dimension).toBeLessThanOrEqual(prev.dimension);
            if (step.dimension === prev.dimension) expect(step.quality).toBeLessThan(prev.quality);
          }
        });
        expect(keys.size).toBe(ladder.length);
      }
    }
  });

  it("origem pequena não é ampliada (500 px => 500 e 480)", () => {
    expect(new Set(buildLadder("square", 500).map((s) => s.dimension))).toEqual(
      new Set([500, 480]),
    );
    expect(new Set(buildLadder("square", 100).map((s) => s.dimension))).toEqual(new Set([100]));
  });

  it("fitWithin reduz o lado maior a no máximo maxSide, preserva proporção e nunca amplia", () => {
    expect(fitWithin({ width: 4000, height: 2000 }, 1600)).toEqual({ width: 1600, height: 800 });
    expect(fitWithin({ width: 500, height: 300 }, 1600)).toEqual({ width: 500, height: 300 });
    const rand = rng(9);
    for (let i = 0; i < CASES; i++) {
      const image = { width: Math.round(1 + rand() * 9000), height: Math.round(1 + rand() * 9000) };
      const out = fitWithin(image, 1600);
      expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(1600);
      expect(out.width).toBeLessThanOrEqual(image.width);
      expect(out.height).toBeLessThanOrEqual(image.height);
      expect(out.width).toBeGreaterThanOrEqual(1);
      expect(out.height).toBeGreaterThanOrEqual(1);
    }
  });

  it("buildDrawPlan: square = recorte -> lado x lado; wide = imagem inteira reduzida", () => {
    const square = buildDrawPlan("square", { width: 4000, height: 3000 }, 800);
    expect(square).toEqual({ sx: 500, sy: 0, sw: 3000, sh: 3000, dw: 800, dh: 800 });
    const withCrop = buildDrawPlan("square", { width: 4000, height: 3000 }, 600, {
      x: 10,
      y: 20,
      size: 1000,
    });
    expect(withCrop).toEqual({ sx: 10, sy: 20, sw: 1000, sh: 1000, dw: 600, dh: 600 });
    const wide = buildDrawPlan("wide", { width: 4000, height: 2000 }, 1600);
    expect(wide).toEqual({ sx: 0, sy: 0, sw: 4000, sh: 2000, dw: 1600, dh: 800 });
  });
});
