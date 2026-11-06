import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TRANSPARENCY_MAX_MONTHS,
  barFillPct,
  coverageSentence,
  formatBRL,
  monthLabel,
  monthShortLabel,
  parseTransparency,
  sharePct,
} from "@/lib/transparency";

/**
 * Parser/formatação da página pública de transparência (docs/CONTRATO_TRANSPARENCIA.md, seções 4 e 6).
 * CONTRACT_EXAMPLE = exemplo da seção 4 do contrato (campos opcionais preenchidos). A conferência com o JSON REAL do backend
 * (GET /transparency capturado do e2e) é do coordenador: troque/adicione a fixture real em `REAL_TRANSPARENCY` quando existir.
 */
const CONTRACT_EXAMPLE = {
  generatedAt: "2026-11-07T12:00:00.000Z",
  entityName: "Associação X",
  introText: "A plataforma é gratuita e mostramos todo mês quanto ela custa.",
  surplusText: "O que sobrar fica na reserva para os meses mais caros.",
  monthlyGoalCents: 300000,
  reserveCents: 123400,
  months: [
    {
      month: "2026-10",
      publishedAt: "2026-11-02T10:00:00.000Z",
      note: "Mês tranquilo.",
      revenueCents: 280000,
      expenseCents: 250000,
      balanceCents: 30000,
      revenueBySource: [{ category: "PATROCINIO", label: "Patrocínios", cents: 280000 }],
      expensesByCategory: [
        { category: "HOSPEDAGEM", label: "Hospedagem e servidores", cents: 150000 },
        { category: "MAPAS", label: "Mapas", cents: 60000 },
        { category: "EMAIL", label: "E-mail", cents: 40000 },
      ],
      activeStudents: 1200,
      activeGroups: 30,
      costPerActiveStudentCents: 208,
      goalCents: 300000,
      goalCoveragePct: 93,
    },
  ],
};

const monthOf = (month: string, extra: Record<string, unknown> = {}) => ({
  ...CONTRACT_EXAMPLE.months[0],
  month,
  ...extra,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseTransparency: resposta no formato do contrato", () => {
  it("aceita o exemplo da seção 4 sem adaptação", () => {
    const report = parseTransparency(CONTRACT_EXAMPLE)!;
    expect(report).not.toBeNull();
    expect(report).toMatchObject({
      generatedAt: "2026-11-07T12:00:00.000Z",
      entityName: "Associação X",
      introText: "A plataforma é gratuita e mostramos todo mês quanto ela custa.",
      surplusText: "O que sobrar fica na reserva para os meses mais caros.",
      monthlyGoalCents: 300000,
      reserveCents: 123400,
    });
    expect(report.months).toHaveLength(1);
    expect(report.months[0]).toEqual({
      month: "2026-10",
      note: "Mês tranquilo.",
      revenueCents: 280000,
      expenseCents: 250000,
      balanceCents: 30000,
      revenueBySource: [{ category: "PATROCINIO", label: "Patrocínios", cents: 280000 }],
      expensesByCategory: [
        { category: "HOSPEDAGEM", label: "Hospedagem e servidores", cents: 150000 },
        { category: "MAPAS", label: "Mapas", cents: 60000 },
        { category: "EMAIL", label: "E-mail", cents: 40000 },
      ],
      activeStudents: 1200,
      activeGroups: 30,
      costPerActiveStudentCents: 208,
      goalCents: 300000,
      goalCoveragePct: 93,
    });
  });

  it("estado vazio: months [] e textos nulos continuam sendo uma resposta válida (nunca erro)", () => {
    const report = parseTransparency({
      generatedAt: "2026-11-07T12:00:00.000Z",
      entityName: null,
      introText: null,
      surplusText: null,
      monthlyGoalCents: 0,
      reserveCents: 0,
      months: [],
    })!;
    expect(report.months).toEqual([]);
    expect(report).toMatchObject({ entityName: null, introText: null, surplusText: null, reserveCents: 0 });
  });

  it("custo por aluno null (0 alunos ativos) fica null e não vira 0", () => {
    const [m] = parseTransparency({ ...CONTRACT_EXAMPLE, months: [monthOf("2026-10", { activeStudents: 0, costPerActiveStudentCents: null })] })!.months;
    expect(m!.costPerActiveStudentCents).toBeNull();
    // mesmo que o servidor mandasse um número com 0 alunos, a tela não mostra custo
    const [m2] = parseTransparency({ ...CONTRACT_EXAMPLE, months: [monthOf("2026-10", { activeStudents: 0, costPerActiveStudentCents: 5 })] })!.months;
    expect(m2!.costPerActiveStudentCents).toBeNull();
  });

  it("meta null/0: goalCoveragePct null; cobertura > 100 é mantida com o número real", () => {
    const [noGoal] = parseTransparency({ ...CONTRACT_EXAMPLE, months: [monthOf("2026-10", { goalCents: 0, goalCoveragePct: null })] })!.months;
    expect(noGoal).toMatchObject({ goalCents: 0, goalCoveragePct: null });
    const [over] = parseTransparency({ ...CONTRACT_EXAMPLE, months: [monthOf("2026-10", { revenueCents: 360000, goalCoveragePct: 120 })] })!.months;
    expect(over!.goalCoveragePct).toBe(120);
  });

  it("reserva negativa é aceita; ausente/inválida = null (a tela esconde o bloco)", () => {
    expect(parseTransparency({ ...CONTRACT_EXAMPLE, reserveCents: -15000 })!.reserveCents).toBe(-15000);
    expect(parseTransparency({ ...CONTRACT_EXAMPLE, reserveCents: "12" })!.reserveCents).toBeNull();
    const { reserveCents: _omit, ...without } = CONTRACT_EXAMPLE;
    void _omit;
    expect(parseTransparency(without)!.reserveCents).toBeNull();
  });

  it("saldo é sempre receita - despesa (um valor incoerente do servidor não chega à tela)", () => {
    const [m] = parseTransparency({ ...CONTRACT_EXAMPLE, months: [monthOf("2026-10", { balanceCents: 999 })] })!.months;
    expect(m!.balanceCents).toBe(30000);
  });
});

describe("parseTransparency: descarta lixo", () => {
  it("corpo que não é objeto = null", () => {
    for (const bad of [null, undefined, "x", 42, [], true]) expect(parseTransparency(bad)).toBeNull();
  });

  it("meses inválidos saem; repetidos viram um; ordena do mais recente para o mais antigo", () => {
    const report = parseTransparency({
      ...CONTRACT_EXAMPLE,
      months: [
        monthOf("2026-08"),
        monthOf("2026-13"), // mês 13
        monthOf("26-10"),
        monthOf("2026-10"),
        monthOf("2026-10", { revenueCents: 1 }), // repetido: fica o primeiro
        monthOf("2026-09", { revenueCents: 280000.5 }), // float: sai
        monthOf("2026-07", { expenseCents: "250000" }), // string: sai
        monthOf("2026-06", { revenueCents: -1 }), // negativo: sai
        null,
        "2026-05",
        monthOf("2026-11"),
      ],
    })!;
    expect(report.months.map((m) => m.month)).toEqual(["2026-11", "2026-10", "2026-08"]);
    expect(report.months[1]!.revenueCents).toBe(280000);
  });

  it("no máximo 12 meses, os mais recentes", () => {
    // 15 meses distintos (2025-01 .. 2026-03), em ordem crescente: o parser ordena e corta nos 12 mais recentes.
    const distinct = Array.from({ length: 15 }, (_, i) => monthOf(`${2025 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`));
    const report = parseTransparency({ ...CONTRACT_EXAMPLE, months: distinct })!;
    expect(report.months).toHaveLength(TRANSPARENCY_MAX_MONTHS);
    expect(report.months[0]!.month).toBe("2026-03");
    expect(report.months[11]!.month).toBe("2025-04");
  });

  it("categorias: só valor inteiro > 0, rótulo ausente cai no código, ordem por valor desc", () => {
    const [m] = parseTransparency({
      ...CONTRACT_EXAMPLE,
      months: [
        monthOf("2026-10", {
          expensesByCategory: [
            { category: "MAPAS", label: "Mapas", cents: 100 },
            { category: "ZERO", label: "Zero", cents: 0 },
            { category: "NEG", label: "Neg", cents: -5 },
            { category: "FLOAT", label: "Float", cents: 1.5 },
            { category: "STR", label: "Str", cents: "10" },
            { label: "Sem código", cents: 10 },
            "lixo",
            { category: "EMAIL", cents: 900 },
          ],
          revenueBySource: "não é lista",
        }),
      ],
    })!.months;
    expect(m!.expensesByCategory).toEqual([
      { category: "EMAIL", label: "EMAIL", cents: 900 },
      { category: "MAPAS", label: "Mapas", cents: 100 },
    ]);
    expect(m!.revenueBySource).toEqual([]);
  });

  it("textos vazios/espaços/tipos errados viram null; não inventa campos que o contrato proíbe", () => {
    const report = parseTransparency({
      ...CONTRACT_EXAMPLE,
      entityName: "   ",
      introText: 7,
      surplusText: "",
      months: [monthOf("2026-10", { note: "  ", description: "Pix do João Silva", id: 77 })],
    })!;
    expect(report).toMatchObject({ entityName: null, introText: null, surplusText: null });
    expect(report.months[0]!.note).toBeNull();
    expect(JSON.stringify(report)).not.toMatch(/Pix do João|"id"|description/);
  });
});

describe("monthLabel: por cálculo, sem Date", () => {
  it("os 12 meses por extenso em pt-BR", () => {
    const expected = [
      "janeiro",
      "fevereiro",
      "março",
      "abril",
      "maio",
      "junho",
      "julho",
      "agosto",
      "setembro",
      "outubro",
      "novembro",
      "dezembro",
    ];
    expected.forEach((name, i) => {
      expect(monthLabel(`2026-${String(i + 1).padStart(2, "0")}`)).toBe(`${name} de 2026`);
    });
    expect(monthLabel("2026-10")).toBe("outubro de 2026");
    expect(monthShortLabel("2026-10")).toBe("out/2026");
  });

  it("formato inválido volta como veio", () => {
    expect(monthLabel("2026-13")).toBe("2026-13");
    expect(monthLabel("outubro")).toBe("outubro");
  });

  it("não usa Date: com Date quebrado o resultado é o mesmo", () => {
    const RealDate = Date;
    class Boom {
      constructor() {
        throw new Error("Date não pode ser usado para o mês por extenso");
      }
      static now(): number {
        throw new Error("Date.now proibido");
      }
    }
    vi.stubGlobal("Date", Boom);
    try {
      expect(monthLabel("2026-10")).toBe("outubro de 2026");
      expect(monthLabel("2026-01")).toBe("janeiro de 2026");
      expect(monthShortLabel("2026-12")).toBe("dez/2026");
    } finally {
      vi.stubGlobal("Date", RealDate);
    }
  });

  it("fuso do aparelho diferente não muda o mês (UTC-12 e UTC+14)", () => {
    const original = process.env["TZ"];
    try {
      for (const tz of ["Pacific/Kiritimati", "Etc/GMT+12", "America/Sao_Paulo", "UTC"]) {
        process.env["TZ"] = tz;
        expect(monthLabel("2026-10")).toBe("outubro de 2026");
        expect(monthLabel("2026-01")).toBe("janeiro de 2026");
        expect(monthLabel("2026-12")).toBe("dezembro de 2026");
      }
    } finally {
      if (original === undefined) delete process.env["TZ"];
      else process.env["TZ"] = original;
    }
  });
});

describe("formatação e percentuais", () => {
  const plain = (text: string) => text.replace(/\u00a0/g, " ");

  it("BRL em pt-BR a partir de centavos inteiros", () => {
    expect(plain(formatBRL(280000))).toBe("R$ 2.800,00");
    expect(plain(formatBRL(208))).toBe("R$ 2,08");
    expect(plain(formatBRL(0))).toBe("R$ 0,00");
    expect(plain(formatBRL(1))).toBe("R$ 0,01");
    expect(plain(formatBRL(-15000))).toBe("-R$ 150,00");
    expect(plain(formatBRL(100000000000))).toBe("R$ 1.000.000.000,00");
  });

  it("barFillPct: > 100 = barra cheia; null/negativo/NaN = 0", () => {
    expect(barFillPct(93)).toBe(93);
    expect(barFillPct(100)).toBe(100);
    expect(barFillPct(120)).toBe(100);
    expect(barFillPct(5000)).toBe(100);
    expect(barFillPct(0)).toBe(0);
    expect(barFillPct(null)).toBe(0);
    expect(barFillPct(-3)).toBe(0);
    expect(barFillPct(Number.NaN)).toBe(0);
  });

  it("sharePct: participação inteira; total 0 não divide", () => {
    expect(sharePct(150000, 250000)).toBe(60);
    expect(sharePct(1, 3)).toBe(33);
    expect(sharePct(5, 0)).toBe(0);
    expect(sharePct(0, 100)).toBe(0);
  });

  it("coverageSentence: texto equivalente para cada situação", () => {
    expect(plain(coverageSentence(93, 300000))).toBe("A receita cobriu 93% da meta de R$ 3.000,00.");
    expect(plain(coverageSentence(100, 300000))).toBe("A receita cobriu 100% da meta de R$ 3.000,00.");
    expect(plain(coverageSentence(120, 300000))).toBe("A receita foi de 120% da meta de R$ 3.000,00: passou da meta.");
    expect(coverageSentence(null, 0)).toBe("Este mês não teve meta definida.");
  });
});
