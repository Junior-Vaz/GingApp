import { describe, expect, it } from "vitest";
import {
  chartBars,
  civilDay,
  evolutionLabel,
  evolutionLongLabel,
  formatPercent,
  goalView,
  rarityText,
  statementDateLabel,
  statementSeasonOptions,
  streakExample,
  type EvolutionPoint,
  type MonthGoal,
} from "@/lib/ranking-student";

/** Regras puras do Ginga Rank do aluno (meta do mês, gráfico, raridade, extrato, exemplo da sequência). */

const goal = (over: Partial<MonthGoal> = {}): MonthGoal => ({
  season: "2026-11",
  lessonsPlanned: 12,
  lessonsDone: 5,
  present: 8,
  neededForBonus: 10,
  remainingForBonus: 2,
  canStillReach: true,
  bonusPoints: 50,
  hasGoal: true,
  league: { current: { code: "AZUL", name: "Roda", color: "#3B82F6" }, next: null, pointsToNext: 0, progressPct: 100 },
  ...over,
});

describe("meta do mês: estados", () => {
  it("sem aulas planejadas = sem meta", () => {
    expect(goalView(goal({ hasGoal: false, lessonsPlanned: 0, neededForBonus: 0, remainingForBonus: 0 })).state).toBe("none");
  });

  it("a caminho: anel = presenças ÷ aulas e a marca do bônus fica em necessárias ÷ aulas", () => {
    const view = goalView(goal());
    expect(view.state).toBe("onTrack");
    expect(view.ratio).toBeCloseTo(8 / 12);
    expect(view.markRatio).toBeCloseTo(10 / 12);
  });

  it("bônus garantido quando não falta presença", () => {
    expect(goalView(goal({ present: 10, remainingForBonus: 0 })).state).toBe("reached");
  });

  it("já não dá para alcançar (canStillReach=false) vira o estado gentil", () => {
    expect(goalView(goal({ present: 3, remainingForBonus: 7, canStillReach: false })).state).toBe("unreachable");
  });

  it("o anel nunca passa de 100%", () => {
    expect(goalView(goal({ present: 20, remainingForBonus: 0 })).ratio).toBe(1);
  });
});

describe("gráfico de evolução", () => {
  const points = (values: number[], keyOf = (i: number) => `2026-09-${String(7 + i * 7).padStart(2, "0")}`): EvolutionPoint[] =>
    values.map((value, i) => ({ key: keyOf(i), points: value, cumulative: 0, lessons: 0 }));

  it("escala pelo maior valor; barra zerada continua visível como 'chão'; só a última é a atual", () => {
    const bars = chartBars(points([0, 20, 40]), "WEEK", { width: 300, height: 100 });
    expect(bars).toHaveLength(3);
    expect(bars[2]!.height).toBeCloseTo(100);
    expect(bars[1]!.height).toBeCloseTo(50);
    expect(bars[0]!.height).toBe(3);
    expect(bars.map((b) => b.isLast)).toEqual([false, false, true]);
  });

  it("todas as barras cabem na largura e a última sempre tem rótulo", () => {
    const bars = chartBars(points(Array.from({ length: 12 }, (_, i) => i)), "WEEK", { width: 320, height: 100 });
    const lastEdge = bars[11]!.x + bars[11]!.width;
    expect(lastEdge).toBeLessThanOrEqual(320.001);
    expect(bars[11]!.showLabel).toBe(true);
    // com 12 barras os rótulos alternam (não encavalam): a vizinha da última fica sem rótulo
    expect(bars[10]!.showLabel).toBe(false);
    expect(bars[9]!.showLabel).toBe(true);
  });

  it("tudo zerado não quebra a escala", () => {
    const bars = chartBars(points([0, 0, 0, 0]), "WEEK", { width: 200, height: 80 });
    expect(bars.every((b) => b.height === 3)).toBe(true);
  });

  it("lista vazia = nenhuma barra", () => {
    expect(chartBars([], "MONTH", { width: 200, height: 80 })).toEqual([]);
  });

  it("rótulos curtos: semana dd/MM e mês abreviado", () => {
    expect(evolutionLabel("2026-10-27", "WEEK")).toBe("27/10");
    expect(evolutionLabel("2026-10", "MONTH")).toBe("out");
    expect(evolutionLongLabel("2026-10-27", "WEEK")).toBe("semana de 27/10");
    expect(evolutionLongLabel("2026-10", "MONTH")).toBe("outubro de 2026");
  });
});

describe("raridade e percentuais", () => {
  it("null (grupo pequeno) não mostra nada", () => {
    expect(rarityText(null)).toBeNull();
  });
  it("raro = 'só X% do grupo tem'; comum = 'X% do grupo tem'", () => {
    expect(rarityText(4)).toBe("só 4% do grupo tem");
    expect(rarityText(4.5)).toBe("só 4,5% do grupo tem");
    expect(rarityText(62.5)).toBe("62,5% do grupo tem");
    expect(rarityText(0)).toBe("só 0% do grupo tem");
  });
  it("formatPercent usa uma casa só quando precisa", () => {
    expect(formatPercent(12)).toBe("12%");
    expect(formatPercent(12.34)).toBe("12,3%");
  });
});

describe("extrato: datas e temporadas", () => {
  const now = new Date(2026, 10, 4, 12, 0, 0); // 04/11/2026 (hora local)

  it("hoje, ontem e data curta", () => {
    expect(statementDateLabel(new Date(2026, 10, 4, 8, 0).toISOString(), now)).toBe("Hoje");
    expect(statementDateLabel(new Date(2026, 10, 3, 20, 0).toISOString(), now)).toBe("Ontem");
    expect(statementDateLabel(new Date(2026, 9, 21, 10, 0).toISOString(), now)).toBe("21/10");
    expect(statementDateLabel(new Date(2025, 11, 5, 10, 0).toISOString(), now)).toBe("05/12/25");
  });

  it("data 'só dia' (meia-noite UTC) mantém o mesmo dia civil", () => {
    expect(statementDateLabel("2026-10-21T00:00:00.000Z", now)).toBe("21/10");
  });

  it("filtro de temporada = Todas + as temporadas do aluno", () => {
    expect(statementSeasonOptions([{ season: "2026-11", points: 1 }, { season: "2026-10", points: 2 }])).toEqual(["ALL", "2026-11", "2026-10"]);
    expect(statementSeasonOptions([])).toEqual(["ALL"]);
  });

  it("dia civil do servidor vira data local sem deslocar de dia", () => {
    const day = civilDay("2026-11-04");
    expect([day.getFullYear(), day.getMonth(), day.getDate()]).toEqual([2026, 10, 4]);
  });
});

describe("exemplo da sequência semanal (calculado das constantes)", () => {
  it("5 por semana até 25: 2ª=5, 3ª=10 ... teto na 6ª semana", () => {
    const { steps, capWeek } = streakExample({ streakStep: 5, streakMax: 25 });
    expect(steps).toEqual([
      { week: 2, bonus: 5 },
      { week: 3, bonus: 10 },
      { week: 4, bonus: 15 },
      { week: 5, bonus: 20 },
      { week: 6, bonus: 25 },
    ]);
    expect(capWeek).toBe(6);
  });

  it("outras constantes mudam o exemplo (nada fixo)", () => {
    const { steps, capWeek } = streakExample({ streakStep: 10, streakMax: 30 });
    expect(steps.map((s) => s.bonus)).toEqual([10, 20, 30]);
    expect(capWeek).toBe(4);
  });

  it("teto que não é múltiplo do passo respeita o teto", () => {
    const { steps } = streakExample({ streakStep: 10, streakMax: 25 });
    expect(steps.at(-1)).toEqual({ week: 4, bonus: 25 });
  });
});
