import { describe, expect, it } from "vitest";
import { CARD_W, layoutBracket, overlaps, roundLabel, type BracketLayout } from "@/modules/chaveamento/bracket-layout";
import type { OperatorMatch } from "@/modules/chaveamento/types";
import { buildBracket } from "./chaveamento-fixtures";
import {
  REAL_OPERATOR_GROUPS_FINISHED,
  REAL_OPERATOR_SINGLE_FINISHED,
  REAL_OPERATOR_SINGLE_RUNNING,
} from "./real-contract-chaveamento";

function allPositioned(layout: BracketLayout) {
  return [...layout.nodes, ...(layout.third ? [layout.third] : [])];
}

function expectSound(layout: BracketLayout, matches: readonly OperatorMatch[]) {
  const wanted = matches.filter((m) => m.stage !== "GROUP");
  const placed = allPositioned(layout);
  // todas as lutas do mata-mata foram posicionadas, uma vez cada
  expect(placed.map((p) => p.match.id).sort((a, b) => a - b)).toEqual(wanted.map((m) => m.id).sort((a, b) => a - b));
  // nenhuma sobreposição
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      expect(overlaps(placed[i]!, placed[j]!), `${placed[i]!.match.key} x ${placed[j]!.match.key}`).toBe(false);
    }
  }
  // tudo dentro da área do SVG
  for (const p of placed) {
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.x + CARD_W).toBeLessThanOrEqual(layout.width);
    expect(p.y).toBeGreaterThanOrEqual(0);
  }
  // conectores: um por luta com `nextMatchId` (dentro do mata-mata) e ligando exatamente origem -> próxima, no lado certo
  const main = matches.filter((m) => m.stage === "MAIN");
  const expectedEdges = main.filter((m) => m.nextMatchId !== null && main.some((n) => n.id === m.nextMatchId));
  expect(layout.edges).toHaveLength(expectedEdges.length);
  for (const m of expectedEdges) {
    const edge = layout.edges.find((e) => e.fromId === m.id);
    expect(edge, `conector de ${m.key}`).toBeDefined();
    expect(edge!.toId).toBe(m.nextMatchId);
    expect(edge!.slot).toBe(m.nextSlot);
    const from = placed.find((p) => p.match.id === m.id)!;
    const to = placed.find((p) => p.match.id === m.nextMatchId)!;
    expect(edge!.d.startsWith(`M ${String(from.x + CARD_W)} `)).toBe(true);
    expect(edge!.d.endsWith(`H ${String(to.x)}`)).toBe(true);
    expect(to.x).toBeGreaterThan(from.x);
  }
}

describe("chaveamento: geometria da chave (SVG)", () => {
  it.each([2, 4, 8, 16, 32, 64])("chave de %i atletas: tudo posicionado, sem sobreposição, conectores certos", (size) => {
    for (const third of [false, true]) {
      const matches = buildBracket(size, third && size >= 4);
      expectSound(layoutBracket(matches), matches);
    }
  });

  it("a luta da rodada seguinte fica centrada entre as duas que a alimentam", () => {
    const matches = buildBracket(8);
    const layout = layoutBracket(matches);
    const y = (id: number) => layout.nodes.find((n) => n.match.id === id)!.y;
    const quarterA = matches.find((m) => m.round === 1 && m.position === 0)!;
    const quarterB = matches.find((m) => m.round === 1 && m.position === 1)!;
    const semi = matches.find((m) => m.round === 2 && m.position === 0)!;
    expect(y(semi.id)).toBe((y(quarterA.id) + y(quarterB.id)) / 2);
  });

  it("o 3º lugar fica separado, abaixo de toda a chave, e sem conector", () => {
    const matches = buildBracket(8, true);
    const layout = layoutBracket(matches);
    const bottom = Math.max(...layout.nodes.map((n) => n.y));
    expect(layout.third).not.toBeNull();
    expect(layout.third!.y).toBeGreaterThan(bottom);
    expect(layout.edges.some((e) => e.fromId === layout.third!.match.id || e.toId === layout.third!.match.id)).toBe(false);
  });

  it("rodadas: uma coluna por rodada, com os nomes certos", () => {
    const layout = layoutBracket(buildBracket(16));
    expect(layout.columns.map((c) => c.label)).toEqual(["Oitavas de final", "Quartas de final", "Semifinal", "Final"]);
    expect(roundLabel(1, 6)).toBe("Rodada 1");
    expect(new Set(layout.columns.map((c) => c.x)).size).toBe(layout.columns.length);
  });

  it("sem lutas de mata-mata não há nada para desenhar", () => {
    const layout = layoutBracket([]);
    expect(layout.nodes).toEqual([]);
    expect(layout.third).toBeNull();
    expect(layout.edges).toEqual([]);
  });

  it("chaves REAIS do backend (com folgas e 3º lugar): tudo posicionado e conectado", () => {
    for (const sample of [REAL_OPERATOR_SINGLE_RUNNING, REAL_OPERATOR_SINGLE_FINISHED, REAL_OPERATOR_GROUPS_FINISHED]) {
      expectSound(layoutBracket(sample.matches), sample.matches);
    }
  });
});
