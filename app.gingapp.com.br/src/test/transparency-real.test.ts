import { describe, expect, it } from "vitest";
import { barFillPct, formatBRL, monthLabel, parseTransparency } from "@/lib/transparency";
import { REAL_PUBLIC } from "./real-contract-transparency";

/** Conformidade com o backend REAL: GET /transparency capturado do e2e (2 meses publicados) passa no parser sem adaptação. */
describe("transparência: resposta real do backend", () => {
  const report = parseTransparency(REAL_PUBLIC);

  it("aceita o corpo real inteiro (nenhum mês descartado)", () => {
    expect(report).not.toBeNull();
    expect(report?.months.map((m) => m.month)).toEqual(["2026-10", "2026-09"]);
    expect(report?.entityName).toBe("Associação Ginga Aberta");
    expect(report?.monthlyGoalCents).toBe(300000);
    expect(report?.reserveCents).toBe(180000);
  });

  it("números do mês mais recente batem com o servidor", () => {
    const [oct] = report?.months ?? [];
    expect(oct).toMatchObject({
      revenueCents: 280000,
      expenseCents: 250000,
      balanceCents: 30000,
      activeStudents: 35,
      activeGroups: 4,
      costPerActiveStudentCents: 7143,
      goalCents: 300000,
      goalCoveragePct: 93,
    });
    expect(oct?.revenueBySource.map((c) => [c.category, c.label, c.cents])).toEqual([
      ["PATROCINIO", "Patrocínios", 230000],
      ["APOIO", "Apoio de usuários", 50000],
    ]);
    expect(oct?.expensesByCategory.map((c) => c.category)).toEqual(["HOSPEDAGEM", "PESSOAS_SUPORTE", "EMAIL"]);
  });

  it("formatação em português a partir dos números reais", () => {
    const [oct] = report?.months ?? [];
    expect(monthLabel(oct!.month)).toBe("outubro de 2026");
    expect(formatBRL(oct!.costPerActiveStudentCents!).replace(/\s/g, " ")).toBe("R$ 71,43");
    expect(barFillPct(oct!.goalCoveragePct)).toBe(93);
  });

  it("o corpo público real não carrega campos privados", () => {
    const text = JSON.stringify(REAL_PUBLIC);
    for (const forbidden of ["description", "createdByUserId", "occurredOn", "entries"]) expect(text).not.toContain(`"${forbidden}"`);
  });
});
