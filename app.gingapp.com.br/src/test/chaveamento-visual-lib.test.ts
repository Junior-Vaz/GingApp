import { describe, expect, it } from "vitest";
import { computeBracketLayout, roundLabel, type BracketLayout } from "@/lib/chaveamento/bracket-layout";
import { focusPageIndices, planBracketPages } from "@/lib/chaveamento/bracket-pages";
import { colorForId, groupHue, initialsBackground, ringColorForGroup } from "@/lib/chaveamento/colors";
import { CONFETTI_COLORS, createBurst, createRain, MAX_PARTICLES, mulberry32, stepParticles } from "@/lib/chaveamento/confetti";
import { formatLabel, matchStageLabel } from "@/lib/chaveamento/describe";
import { advanceIntro, EMPTY_INTRO, enqueueIntros, INTRO_MS } from "@/lib/chaveamento/intro-queue";
import { itemsPerPage, paginate } from "@/lib/chaveamento/paginate";
import { currentStageLabel, nextQueueRanks, qualifiedIds, selectPodium } from "@/lib/chaveamento/selectors";
import { diffSnapshots, type IntroEvent } from "@/lib/chaveamento/snapshot-diff";
import { buildKnockout, category, comp, match, snapshot } from "./chaveamento-fixtures";

/** Testes pesados (N de 2 a 128): timeouts generosos, instáveis sob a carga do gate completo. */
const LONG = 120_000;

/* ------------------------------------------------ nomes de rodada ------------------------------------------------ */

describe("chaveamento visual: nomes de rodada em português", () => {
  it("Final, Semifinais, Quartas, Oitavas, 16/32 avos e 1ª rodada nas chaves enormes", () => {
    expect(roundLabel(5, 5)).toBe("Final");
    expect(roundLabel(4, 5)).toBe("Semifinais");
    expect(roundLabel(3, 5)).toBe("Quartas de final");
    expect(roundLabel(2, 5)).toBe("Oitavas de final");
    expect(roundLabel(1, 5)).toBe("16 avos de final");
    expect(roundLabel(1, 6)).toBe("1ª rodada");
    expect(roundLabel(2, 6)).toBe("16 avos de final");
    expect(roundLabel(2, 7)).toBe("32 avos de final");
    expect(roundLabel(1, 7)).toBe("1ª rodada");
  });

  it("fase da luta: 3º lugar, grupo + rodada, mata-mata; formato da categoria", () => {
    expect(matchStageLabel({ stage: "THIRD_PLACE", round: 3, groupIndex: null }, 3)).toBe("Disputa de 3º lugar");
    expect(matchStageLabel({ stage: "GROUP", round: 2, groupIndex: 1 }, 1)).toBe("Grupo B · Rodada 2");
    expect(matchStageLabel({ stage: "GROUP", round: 3, groupIndex: null }, 1)).toBe("Rodada 3");
    expect(matchStageLabel({ stage: "MAIN", round: 2, groupIndex: null }, 3)).toBe("Semifinais");
    expect(formatLabel("SINGLE_ELIMINATION")).toBe("Eliminatória");
    expect(formatLabel("ROUND_ROBIN")).toBe("Todos contra todos");
    expect(formatLabel("GROUPS_KNOCKOUT")).toBe("Grupos + mata-mata");
  });

  it("rodada em andamento no cabeçalho: ao vivo > próxima pronta; encerrada; sem lutas", () => {
    const { competitors, matches } = buildKnockout(8, { thirdPlace: true });
    const base = category(1, { competitors, matches });
    expect(currentStageLabel(base)).toBe("Quartas de final"); // 1ª rodada pronta
    const live = { ...base, matches: matches.map((m) => (m.round === 2 && m.position === 0 ? { ...m, status: "LIVE" as const, slotAId: 1, slotBId: 2 } : m)) };
    expect(currentStageLabel(live)).toBe("Semifinais");
    expect(currentStageLabel({ ...base, status: "FINISHED" })).toBe("Encerrada");
    expect(currentStageLabel(category(2))).toBeNull();
  });
});

/* ------------------------------------------------ cores do grupo ------------------------------------------------ */

describe("chaveamento visual: anel e iniciais na cor do grupo", () => {
  it("matiz estável por nome de grupo, fora do vermelho/laranja/dourado; sem grupo = neutro", () => {
    expect(groupHue("Ginga Sul")).toBe(groupHue("  ginga sul "));
    const hues = ["A", "Berimbau Dourado", "Maré Viva", "Axé Nagô", "Roda de Ouro", "Cordão da Lua", "Pé de Dendê"].map((g) => groupHue(g)!);
    for (const h of hues) {
      expect(h).toBeGreaterThanOrEqual(120);
      expect(h).toBeLessThan(330);
    }
    expect(new Set(hues).size).toBeGreaterThan(3);
    expect(groupHue(null)).toBeNull();
    expect(groupHue("   ")).toBeNull();
    expect(ringColorForGroup(null)).toBe("oklch(.72 .03 250)");
    expect(ringColorForGroup("Ginga Sul")).toContain(`${groupHue("Ginga Sul")}`);
    expect(initialsBackground(3, null)).toBe(colorForId(3));
    expect(initialsBackground(3, "Ginga Sul")).toContain("linear-gradient");
  });
});

/* ------------------------------------------------ diferença de snapshots: aberturas "VS" ------------------------------------------------ */

const fight = (rev: number, status: "READY" | "LIVE", extra: { mat?: string | null } = {}) =>
  snapshot(rev, [
    category(1, {
      name: "Adulto até 70 kg",
      competitors: [comp(1, { name: "Ana", group: "Ginga Sul", graduation: "Azul" }), comp(2, { name: "Bia" }), comp(3), comp(4)],
      matches: [
        match(10, { key: "MAIN-1-0", round: 1, position: 0, slotAId: 1, slotBId: 2, nextMatchId: 12, nextSlot: "A", status }),
        match(11, { key: "MAIN-1-1", round: 1, position: 1, slotAId: 3, slotBId: 4, nextMatchId: 12, nextSlot: "B", status: "READY" }),
        match(12, { key: "MAIN-2-0", round: 2, position: 0 }),
      ],
      ...(extra.mat !== undefined ? {} : {}),
    }),
  ]);

describe("chaveamento visual: abertura VS nasce só da diferença entre snapshots", () => {
  it("o primeiro snapshot NUNCA gera abertura, mesmo com luta já ao vivo", () => {
    const diff = diffSnapshots(null, fight(1, "LIVE"));
    expect(diff.initial).toBe(true);
    expect(diff.intros).toEqual([]);
  });

  it("READY -> LIVE gera a abertura com os dois atletas, a fase e o tatame; LIVE -> LIVE e snapshot antigo não", () => {
    const live = { ...fight(2, "LIVE") };
    live.categories[0]!.matches[0] = { ...live.categories[0]!.matches[0]!, mat: "3" };
    const diff = diffSnapshots(fight(1, "READY"), live);
    expect(diff.intros).toHaveLength(1);
    const intro = diff.intros[0]!;
    expect(intro).toMatchObject({ categoryId: 1, categoryName: "Adulto até 70 kg", matchId: 10, stageLabel: "Semifinais", mat: "3" });
    expect(intro.a?.name).toBe("Ana");
    expect(intro.a?.group).toBe("Ginga Sul");
    expect(intro.b?.name).toBe("Bia");
    expect(diffSnapshots(live, { ...live, revision: 3 }).intros).toEqual([]);
    expect(diffSnapshots(fight(5, "READY"), fight(4, "LIVE")).intros).toEqual([]); // revisão antiga: ignorada
  });

  it("luta de folga e luta nova que já nasce ao vivo não geram abertura", () => {
    const before = fight(1, "READY");
    const bye = fight(2, "LIVE");
    bye.categories[0]!.matches[0] = { ...bye.categories[0]!.matches[0]!, isBye: true };
    expect(diffSnapshots(before, bye).intros).toEqual([]);
    const born = snapshot(2, [category(1, { competitors: [comp(1), comp(2)], matches: [match(99, { slotAId: 1, slotBId: 2, status: "LIVE" })] })]);
    expect(diffSnapshots(snapshot(1, [category(1)]), born).intros).toEqual([]);
  });
});

describe("chaveamento visual: fila de aberturas (a mais recente vence, as velhas caem)", () => {
  const ev = (matchId: number): IntroEvent => ({ categoryId: 1, categoryName: "C", matchId, key: `k${matchId}`, stage: "MAIN", round: 1, stageLabel: "Final", mat: null, a: null, b: null });

  it("vazio recebe a mais recente de várias; durante uma na tela só UMA espera (a mais nova)", () => {
    expect(INTRO_MS).toBeGreaterThanOrEqual(3000);
    expect(INTRO_MS).toBeLessThanOrEqual(4000);
    expect(enqueueIntros(EMPTY_INTRO, [])).toBe(EMPTY_INTRO);
    const s1 = enqueueIntros(EMPTY_INTRO, [ev(1), ev(2), ev(3)]);
    expect(s1).toEqual({ current: ev(3), pending: null });
    const s2 = enqueueIntros(s1, [ev(4)]);
    expect(s2).toEqual({ current: ev(3), pending: ev(4) });
    const s3 = enqueueIntros(s2, [ev(5), ev(6)]); // 4 é descartada
    expect(s3).toEqual({ current: ev(3), pending: ev(6) });
    expect(advanceIntro(s3)).toEqual({ current: ev(6), pending: null });
    expect(advanceIntro(advanceIntro(s3))).toEqual(EMPTY_INTRO);
  });
});

/* ------------------------------------------------ pódio / classificados / fila ------------------------------------------------ */

describe("chaveamento visual: seletores do pódio, classificados e fila", () => {
  it("pódio com 1º/2º/3º e com DOIS terceiros; entradas sem atleta são ignoradas", () => {
    const base = category(1, { competitors: [comp(1), comp(2), comp(3), comp(4)] });
    const one = selectPodium({ ...base, podium: [{ place: 1, competitorId: 1 }, { place: 2, competitorId: 2 }, { place: 3, competitorId: 3 }] });
    expect(one.champion?.id).toBe(1);
    expect(one.second?.id).toBe(2);
    expect(one.thirds.map((c) => c.id)).toEqual([3]);
    const two = selectPodium({ ...base, podium: [{ place: 1, competitorId: 1 }, { place: 2, competitorId: 2 }, { place: 3, competitorId: 3 }, { place: 3, competitorId: 4 }] });
    expect(two.thirds.map((c) => c.id)).toEqual([3, 4]);
    const ghost = selectPodium({ ...base, podium: [{ place: 1, competitorId: 999 }] });
    expect(ghost).toEqual({ champion: null, second: null, thirds: [] });
  });

  it("classificados = quem já está na 1ª rodada do mata-mata dos grupos; vazio antes do sorteio e em outros formatos", () => {
    const groupsOnly = category(1, { format: "GROUPS_KNOCKOUT", matches: [match(1, { stage: "GROUP", groupIndex: 0, slotAId: 1, slotBId: 2 })] });
    expect(qualifiedIds(groupsOnly).size).toBe(0);
    const withKo = category(1, { format: "GROUPS_KNOCKOUT", matches: [match(1, { stage: "GROUP", groupIndex: 0, slotAId: 1, slotBId: 2 }), match(2, { stage: "MAIN", round: 1, slotAId: 1, slotBId: 4 })] });
    expect([...qualifiedIds(withKo)].sort()).toEqual([1, 4]);
    expect(qualifiedIds({ ...withKo, format: "SINGLE_ELIMINATION" }).size).toBe(0);
  });

  it("posição na fila de chamada da categoria (PRÓXIMA = 1)", () => {
    const s = snapshot(1, [
      category(1, {
        competitors: [comp(1), comp(2), comp(3), comp(4)],
        matches: [match(1, { status: "READY", slotAId: 1, slotBId: 2, queueOrder: 2 }), match(2, { status: "READY", slotAId: 3, slotBId: 4, queueOrder: 1 })],
      }),
      category(2, { competitors: [comp(5), comp(6)], matches: [match(3, { status: "READY", slotAId: 5, slotBId: 6, queueOrder: 3 })] }),
    ]);
    expect([...nextQueueRanks(s, 1)]).toEqual([[2, 1], [1, 2]]);
    expect([...nextQueueRanks(s, 2)]).toEqual([[3, 3]]);
  });
});

/* ------------------------------------------------ chave grande: páginas (geometria pura) ------------------------------------------------ */

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function assertNoOverlap(layout: BracketLayout, label: string): void {
  for (let i = 0; i < layout.cards.length; i += 1) {
    for (let j = i + 1; j < layout.cards.length; j += 1) {
      expect(overlaps(layout.cards[i]!, layout.cards[j]!), `${label}: cartões ${layout.cards[i]!.matchId} e ${layout.cards[j]!.matchId}`).toBe(false);
    }
  }
}

describe("chaveamento visual: chave grande paginada em vez de encolhida", () => {
  const AREA = { width: 1870, height: 600 };
  const OPTIONS = { minScale: 0.95, maxScale: 2.2 };

  it("N = 2..128: nenhuma página tem cartões sobrepostos, todas as lutas aparecem, e a letra nunca cai abaixo do mínimo legível", () => {
    for (let n = 2; n <= 128; n += 1) {
      const { matches } = buildKnockout(n, { thirdPlace: true });
      const plan = planBracketPages(matches, AREA, OPTIONS);
      const seen = new Set<number>();
      for (const page of plan.pages) {
        assertNoOverlap(page.layout, `n=${n} ${page.id}`);
        for (const id of page.matchIds) seen.add(id);
        expect(page.layout.cards.length, `n=${n}`).toBe(page.matchIds.length);
      }
      expect([...seen].sort((a, b) => a - b), `n=${n}: toda luta aparece em alguma página`).toEqual(matches.map((m) => m.id).sort((a, b) => a - b));
      expect(plan.pages.map((p) => p.index), `n=${n}`).toEqual(plan.pages.map((_, i) => i));
      for (const p of plan.pages) expect(p.count).toBe(plan.pages.length);
      // o ponto do trabalho: nunca mais a escala 0,15 de antes
      expect(Math.min(...plan.scales), `n=${n}: escala mínima`).toBeGreaterThanOrEqual(OPTIONS.minScale);
    }
  }, LONG);

  it("chave pequena cabe inteira numa página só; chave grande é dividida e termina na 'Fase final' com a disputa de 3º lugar", () => {
    const small = planBracketPages(buildKnockout(8, { thirdPlace: true }).matches, AREA, OPTIONS);
    expect(small.paged).toBe(false);
    expect(small.window).toBeNull();
    expect(small.pages).toHaveLength(1);
    expect(small.pages[0]!.kind).toBe("whole");

    const { matches } = buildKnockout(64, { thirdPlace: true });
    const big = planBracketPages(matches, AREA, OPTIONS);
    expect(big.paged).toBe(true);
    expect(big.pages.length).toBeGreaterThan(2);
    const last = big.pages[big.pages.length - 1]!;
    expect(last.kind).toBe("final");
    expect(last.label).toBe("Fase final");
    expect(last.layout.third).not.toBeNull();
    expect(last.layout.columns.some((c) => c.label === "Final")).toBe(true);
    // nomes de coluna usam a chave INTEIRA como referência (a raiz de uma subárvore nunca vira "Final")
    for (const page of big.pages.slice(0, -1)) expect(page.layout.columns.some((c) => c.label === "Final")).toBe(false);
    expect(computeBracketLayout(matches).columns[0]!.label).toBe("1ª rodada");
  });

  it("16 atletas: metades superior/inferior + fase final; área desconhecida ou chave de 2 rodadas = inteira", () => {
    const { matches } = buildKnockout(16, { thirdPlace: true });
    const plan = planBracketPages(matches, AREA, OPTIONS);
    expect(plan.pages.map((p) => p.label)).toEqual(["Parte superior", "Parte inferior", "Fase final"]);
    expect(planBracketPages(matches, { width: 0, height: 0 }, OPTIONS).paged).toBe(false);
    expect(planBracketPages(buildKnockout(4).matches, { width: 100, height: 50 }, OPTIONS).paged).toBe(false);
  });

  it("foco no 'zoom automático': páginas com luta ao vivo (sem nenhuma ao vivo = todas); luta repetida conta na 1ª página", () => {
    const { matches } = buildKnockout(16, { thirdPlace: true });
    const plan = planBracketPages(matches, AREA, OPTIONS);
    expect(focusPageIndices(plan.pages, new Set())).toEqual([0, 1, 2]);
    const inLower = plan.pages[1]!.matchIds.find((id) => !plan.pages[0]!.matchIds.includes(id) && !plan.pages[2]!.matchIds.includes(id))!;
    expect(focusPageIndices(plan.pages, new Set([inLower]))).toEqual([1]);
    const finalId = matches.find((m) => m.stage === "MAIN" && m.round === 4)!.id;
    expect(focusPageIndices(plan.pages, new Set([finalId]))).toEqual([2]);
    const semi = matches.find((m) => m.stage === "MAIN" && m.round === 3 && m.position === 0)!.id; // raiz da metade de cima e 1ª coluna da fase final
    expect(focusPageIndices(plan.pages, new Set([semi]))).toEqual([0]);
    expect(focusPageIndices(plan.pages, new Set([inLower, finalId]))).toEqual([1, 2]);
    expect(focusPageIndices(plan.pages, new Set([987654]))).toEqual([0, 1, 2]);
  });
});

/* ------------------------------------------------ paginação genérica ------------------------------------------------ */

describe("chaveamento visual: paginação de grupos e rodadas", () => {
  it("quantos itens cabem (colunas x linhas, nunca menos de 1) e a divisão em páginas", () => {
    expect(itemsPerPage({ width: 1000, height: 600 }, { minWidth: 450, height: 250 }, 20)).toEqual({ columns: 2, rows: 2, perPage: 4 });
    expect(itemsPerPage({ width: 100, height: 100 }, { minWidth: 450, height: 250 })).toEqual({ columns: 1, rows: 1, perPage: 1 });
    expect(itemsPerPage({ width: 0, height: 0 }, { minWidth: 450, height: 250 }).perPage).toBe(1);
    expect(paginate([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(paginate([], 3)).toEqual([]);
    expect(paginate([1, 2], 0)).toEqual([[1], [2]]);
  });
});

/* ------------------------------------------------ confete (motor puro) ------------------------------------------------ */

describe("chaveamento visual: motor do confete", () => {
  it("determinístico por semente, no máximo 150 partículas e só as cores ouro/verde/branco", () => {
    const a = createBurst(mulberry32(7), 1920, 1080, 90);
    const b = createBurst(mulberry32(7), 1920, 1080, 90);
    expect(a).toEqual(b);
    expect(createBurst(mulberry32(1), 1920, 1080, 1000)).toHaveLength(MAX_PARTICLES);
    expect(createRain(mulberry32(1), 1920, 1000)).toHaveLength(MAX_PARTICLES);
    expect(MAX_PARTICLES).toBeLessThanOrEqual(150);
    expect(createBurst(mulberry32(1), 100, 100, -5)).toEqual([]);
    for (const p of a) expect(CONFETTI_COLORS).toContain(p.color);
  });

  it("as partículas caem, saem da tela ou morrem e a lista esvazia (sem vazamento)", () => {
    const list = createBurst(mulberry32(3), 1920, 1080, 120);
    let alive = list.length;
    for (let i = 0; i < 400 && alive > 0; i += 1) alive = stepParticles(list, 1 / 60, 1080);
    expect(alive).toBe(0);
    expect(list).toHaveLength(0);
    const one = createRain(mulberry32(3), 1920, 1);
    const y0 = one[0]!.y;
    stepParticles(one, 0.05, 1080);
    expect(one[0]!.y).toBeGreaterThan(y0);
  });
});
