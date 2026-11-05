import { describe, expect, it } from "vitest";
import {
  chartBars,
  goalView,
  isDailyStatus,
  rarityText,
  statementSeasonOptions,
  streakExample,
  type DailyCheckinStatus,
  type EvolutionPoint,
  type MonthGoal,
  type RankingRules,
} from "@/lib/ranking-student";
import { REAL_RANKING_STUDENT as real } from "./real-contract-ranking-student";

/** Conformidade com o backend REAL: respostas capturadas de ranking-student.service.ts passam pelas funções do app sem adaptação. */
describe("Ginga Rank do aluno: respostas reais do backend", () => {
  it("check-in diário (GET e POST) é reconhecido pelo guarda de formato do app", () => {
    expect(isDailyStatus(real["dailyGet"])).toBe(true);
    expect(isDailyStatus(real["dailyPostFirst"])).toBe(true);
    expect(isDailyStatus(real["dailyPostAgain"])).toBe(true);
    const first = real["dailyPostFirst"] as DailyCheckinStatus & { alreadyCheckedIn: boolean; pointsToday: number };
    expect(first.alreadyCheckedIn).toBe(false);
    expect(first.pointsToday).toBe(1);
    const again = real["dailyPostAgain"] as DailyCheckinStatus & { alreadyCheckedIn: boolean; pointsToday: number };
    expect(again.alreadyCheckedIn).toBe(true);
    expect(again.pointsToday).toBe(0);
    expect(real["dailyGet"].last7).toHaveLength(7);
  });

  it("meta do mês e evolução alimentam os cálculos de tela", () => {
    const view = goalView(real["goal"] as MonthGoal);
    expect(view).toBeTruthy();
    const bars = chartBars(real["evolution"].points as EvolutionPoint[], "MONTH", { width: 300, height: 100 });
    expect(bars).toHaveLength((real["evolution"].points as unknown[]).length);
    expect(real["goal"].league.next.minPoints).toBeGreaterThan(real["goal"].league.progressPct);
  });

  it("extrato: itens com os campos do contrato e temporadas utilizáveis no filtro", () => {
    for (const item of [real["points"].item, real["points"].item2]) {
      expect(typeof item.id).toBe("number");
      expect(typeof item.type).toBe("string");
      expect(typeof item.points).toBe("number");
      expect(typeof item.label).toBe("string");
      expect(item.season).toMatch(/^\d{4}-\d{2}$/);
    }
    expect(Array.isArray(statementSeasonOptions(real["points"].seasonTotals))).toBe(true);
  });

  it("conquistas: ganha, bloqueada com progresso e raridade nula (grupo pequeno)", () => {
    const { earned, locked, rarityNull } = real["achievements"];
    expect(earned.earned).toBe(true);
    expect(typeof earned.earnedAt).toBe("string");
    expect(locked.earned).toBe(false);
    expect(locked.progress.current).toBeLessThan(locked.progress.target);
    expect(rarityText(rarityNull.rarityPct)).toBeNull();
    expect(typeof rarityText(earned.rarityPct)).toBe("string");
    expect(Array.isArray(real["achievements"].showcase)).toBe(true);
    expect(real["achievements"].totalCount).toBeGreaterThan(real["achievements"].earnedCount);
  });

  it("regras: números vêm do servidor e o exemplo de sequência usa as constantes reais", () => {
    const rules = real["rules"] as RankingRules;
    expect(rules.points.dailyCheckin).toBe(1);
    expect(rules.limits.dailyWeekTarget).toBe(5);
    const example = streakExample(rules.points);
    expect(example.steps.length).toBeGreaterThan(1);
  });

  it("configurações com vitrine e o erro de conquista não ganha", () => {
    expect(real["settings"].showcase).toEqual(["PERFECT_MONTH", "COMEBACK"]);
    expect(real["settingsNotEarned"].code).toBe("ACHIEVEMENT_NOT_EARNED");
  });
});
