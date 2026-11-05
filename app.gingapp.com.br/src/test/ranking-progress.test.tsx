import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RankingPage } from "@/components/gingapp/ranking";
import type { MonthGoal } from "@/lib/ranking-student";
import {
  DAILY,
  EVOLUTION_WEEK,
  GOAL,
  ST,
  byText,
  calls,
  callsTo,
  cleanup,
  click,
  json,
  mockApi,
  mount,
  prepare,
  q,
  qa,
  selectValue,
  settle,
  statement,
  stmtItem,
  textOf,
} from "./ranking-student-fixtures";

/**
 * Ginga Rank - "Meu progresso" (docs/CONTRATO_RANK_ALUNO.md): navegação da tela, check-in de hoje, meta do mês, próxima liga, sequência,
 * gráfico de evolução e extrato. O backend é mockado via fetch com os formatos do contrato.
 */

const norm = (text: string) => text.replace(/\s+/g, " ").trim();

async function openProgress() {
  await click(byText('button[role="tab"]', "Meu progresso"));
}

beforeEach(prepare);
afterEach(cleanup);

describe("navegação da tela Ranking", () => {
  it("abas Classificação / Meu progresso / Conquistas e o botão 'Como funciona?' no topo; a classificação continua a padrão", async () => {
    mockApi();
    await mount(<RankingPage />);
    const tabs = qa('button[role="tab"]').map((t) => t.textContent?.trim());
    expect(tabs).toEqual(["Classificação", "Meu progresso", "Conquistas"]);
    expect(q('button[role="tab"][aria-selected="true"]')!.textContent).toContain("Classificação");
    expect(byText("button", "Como funciona?")).toBeDefined();
    expect(q('[data-testid="rk-progress"]')).not.toBeNull(); // card "Seu progresso" da classificação, intacto
    expect(q('[data-testid="rk-progress-view"]')).toBeNull();
  });

  it("trocar de aba mostra a área certa, sem pedir de novo a classificação", async () => {
    mockApi();
    await mount(<RankingPage />);
    const before = callsTo("/ranking/students").length;
    await openProgress();
    expect(q('[data-testid="rk-progress-view"]')).not.toBeNull();
    expect(q(".rk-filters")).toBeNull();
    await click(byText('button[role="tab"]', "Conquistas"));
    expect(q('[data-testid="rk-achievements"]')).not.toBeNull();
    expect(q('[data-testid="rk-progress-view"]')).toBeNull();
    expect(callsTo("/ranking/students").length).toBe(before);
    await click(byText('button[role="tab"]', "Classificação"));
    expect(q(".rk-filters")).not.toBeNull();
    expect(q('[role="tabpanel"]')!.getAttribute("aria-labelledby")).toBe("rk-tab-ranking");
  });

  it("setas do teclado percorrem as abas", async () => {
    mockApi();
    await mount(<RankingPage />);
    const list = q('[role="tablist"]')!;
    act(() => list.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    await settle();
    expect(q('button[role="tab"][aria-selected="true"]')!.textContent).toContain("Meu progresso");
  });
});

describe("requisições do aluno (formato do contrato)", () => {
  it("cada rota leva ?studentId= do aluno ativo e os parâmetros do contrato", async () => {
    mockApi();
    await mount(<RankingPage />);
    await openProgress();
    const only = (path: string, method = "GET") => callsTo(path, method).at(-1)!.url.searchParams;

    const points = only("/ranking/me/points");
    expect(points.get("season")).toBe("ALL");
    expect(points.get("limit")).toBe("20");
    expect(points.get("offset")).toBe("0");
    expect(points.get("studentId")).toBe("11");

    const evolution = only("/ranking/me/evolution");
    expect(evolution.get("granularity")).toBe("WEEK");
    expect(evolution.get("count")).toBe("12");
    expect(evolution.get("studentId")).toBe("11");

    expect(only("/ranking/me/goal").get("studentId")).toBe("11");
    expect(only("/ranking/me/daily-checkin").get("studentId")).toBe("11");
    // achievements é pedido pela vitrine em destaque
    expect(only("/ranking/me/achievements").get("studentId")).toBe("11");
  });

  it("dependente selecionado: tudo segue o aluno ativo (studentId do dependente)", async () => {
    mockApi({ students: [ST(11, null, "Bruno"), ST(12, 1, "Alice")] });
    await mount(<RankingPage />);
    await openProgress();
    for (const path of ["/ranking/me/points", "/ranking/me/evolution", "/ranking/me/goal", "/ranking/me/daily-checkin", "/ranking/me/achievements"]) {
      const sent = callsTo(path);
      expect(sent.length, path).toBeGreaterThan(0);
      expect(sent.every((c) => c.url.searchParams.get("studentId") === "12"), path).toBe(true);
    }
  });

  it("sem aluno ligado: mensagem e nenhuma requisição do aluno", async () => {
    mockApi({ students: [] });
    await mount(<RankingPage />);
    await openProgress();
    expect(q('[data-testid="rkp-no-student"]')).not.toBeNull();
    expect(calls.filter((c) => c.path.startsWith("/ranking/me/"))).toEqual([]);
  });
});

describe("check-in de hoje", () => {
  it("pendente: botão grande, 7 bolinhas dos últimos 7 dias e '3 de 5 dias nesta semana'", async () => {
    mockApi();
    await mount(<RankingPage />);
    await openProgress();
    const card = q('[data-testid="rk-daily"]')!;
    const button = byText("button", "Salve! Check-in de hoje")!;
    expect(button).toBeDefined();
    expect(card.contains(button)).toBe(true);
    const dots = qa('[data-testid="rkp-dot"]');
    expect(dots).toHaveLength(7);
    expect(dots.filter((d) => d.dataset["done"] === "true")).toHaveLength(3);
    expect(dots.at(-1)!.getAttribute("aria-current")).toBe("date");
    expect(norm(textOf('[data-testid="rkp-week"]'))).toBe("3 de 5 dias nesta semana");
    expect(card.textContent).not.toMatch(/perdeu|perder|quebr/i); // sem culpa
  });

  it("toque envia POST sem corpo, mostra '+1 ponto' (estado concluído) e refaz as consultas do rank", async () => {
    mockApi();
    await mount(<RankingPage />);
    await openProgress();
    const before = {
      me: callsTo("/ranking/me").length,
      points: callsTo("/ranking/me/points").length,
      goal: callsTo("/ranking/me/goal").length,
      evolution: callsTo("/ranking/me/evolution").length,
      achievements: callsTo("/ranking/me/achievements").length,
    };
    await click(byText("button", "Salve! Check-in de hoje"));
    const posts = callsTo("/ranking/me/daily-checkin", "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toBeNull();
    expect(posts[0]!.url.searchParams.get("studentId")).toBe("11");
    expect(byText("button", "Salve! Check-in de hoje")).toBeUndefined();
    expect(q('[data-testid="rkp-daily-done"]')).not.toBeNull();
    expect(textOf('[data-testid="rkp-daily-result"]')).toBe("+1 ponto");
    expect(norm(textOf('[data-testid="rkp-week"]'))).toBe("4 de 5 dias nesta semana");
    expect(callsTo("/ranking/me").length).toBeGreaterThan(before.me);
    expect(callsTo("/ranking/me/points").length).toBeGreaterThan(before.points);
    expect(callsTo("/ranking/me/goal").length).toBeGreaterThan(before.goal);
    expect(callsTo("/ranking/me/evolution").length).toBeGreaterThan(before.evolution);
    expect(callsTo("/ranking/me/achievements").length).toBeGreaterThan(before.achievements);
    // o estado do dia vem da resposta do POST: não há nova leitura do GET só para isso
    expect(callsTo("/ranking/me/daily-checkin", "GET")).toHaveLength(1);
  });

  it("já feito hoje (ao abrir): estado concluído, sem botão e sem POST", async () => {
    mockApi({ routes: { "GET /ranking/me/daily-checkin": () => ({ ...DAILY, checkedInToday: true, weekDays: 4 }) } });
    await mount(<RankingPage />);
    await openProgress();
    expect(byText("button", "Salve! Check-in de hoje")).toBeUndefined();
    expect(textOf('[data-testid="rkp-daily-done"]')).toContain("Check-in de hoje feito!");
    expect(textOf('[data-testid="rkp-daily-result"]')).toBe("Hoje já valeu!");
    expect(callsTo("/ranking/me/daily-checkin", "POST")).toHaveLength(0);
  });

  it("sem ponto novo (teto do mês): 'hoje já valeu', sem culpa", async () => {
    mockApi({ routes: { "POST /ranking/me/daily-checkin": () => ({ ...DAILY, checkedInToday: true, monthDays: 21, alreadyCheckedIn: false, pointsToday: 0 }) } });
    await mount(<RankingPage />);
    await openProgress();
    await click(byText("button", "Salve! Check-in de hoje"));
    expect(textOf('[data-testid="rkp-daily-result"]')).toContain("Hoje já valeu!");
    expect(textOf('[data-testid="rkp-daily-result"]')).not.toContain("+0");
  });

  it("já tinha feito (resposta alreadyCheckedIn): mensagem própria", async () => {
    mockApi({ routes: { "POST /ranking/me/daily-checkin": () => ({ ...DAILY, checkedInToday: true, alreadyCheckedIn: true, pointsToday: 0 }) } });
    await mount(<RankingPage />);
    await openProgress();
    await click(byText("button", "Salve! Check-in de hoje"));
    expect(textOf('[data-testid="rkp-daily-result"]')).toContain("já tinha feito");
  });

  it("meta da semana batida: avisa que o bônus entra quando a semana fecha", async () => {
    mockApi({ routes: { "GET /ranking/me/daily-checkin": () => ({ ...DAILY, weekDays: 5, weekDone: true }) } });
    await mount(<RankingPage />);
    await openProgress();
    expect(textOf('[data-testid="rkp-week-done"]')).toContain("quando a semana fecha");
  });

  it("erro no POST (429): mensagem gentil e o botão continua disponível", async () => {
    mockApi({ routes: { "POST /ranking/me/daily-checkin": () => json(429, { message: "Too Many Requests" }) } });
    await mount(<RankingPage />);
    await openProgress();
    await click(byText("button", "Salve! Check-in de hoje"));
    expect(textOf('[data-testid="rkp-daily-error"]')).toContain("Muitos toques");
    expect(byText("button", "Salve! Check-in de hoje")).toBeDefined();
  });

  it("erro ao carregar o estado: 'Tentar de novo' refaz a consulta", async () => {
    let first = true;
    mockApi({
      routes: {
        "GET /ranking/me/daily-checkin": () => {
          if (first) {
            first = false;
            return json(500, { message: "Falha no check-in" });
          }
          return DAILY;
        },
      },
    });
    await mount(<RankingPage />);
    await openProgress();
    const card = q('[data-testid="rk-daily"]')!;
    expect(card.querySelector('[role="alert"]')!.textContent).toContain("Falha no check-in");
    await click(byText('[data-testid="rk-daily"] button', "Tentar de novo"));
    expect(byText("button", "Salve! Check-in de hoje")).toBeDefined();
  });

  it("carregando: esqueleto", async () => {
    mockApi({ routes: { "GET /ranking/me/daily-checkin": () => new Promise(() => {}) } });
    await mount(<RankingPage />);
    await openProgress();
    expect(q('[data-testid="rk-daily"] [data-testid="rkp-skeleton"]')).not.toBeNull();
  });

  it("reduzir movimento: conclui sem a animação de 'pop'", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    mockApi();
    await mount(<RankingPage />);
    await openProgress();
    await click(byText("button", "Salve! Check-in de hoje"));
    expect(q('[data-testid="rkp-daily-done"]')!.className).not.toContain("is-pop");
  });

  it("com movimento normal o concluído ganha a animação de 'pop'", async () => {
    mockApi();
    await mount(<RankingPage />);
    await openProgress();
    await click(byText("button", "Salve! Check-in de hoje"));
    expect(q('[data-testid="rkp-daily-done"]')!.className).toContain("is-pop");
  });
});

describe("meta do mês e próxima liga", () => {
  const withGoal = (over: Partial<MonthGoal>) => ({ "/ranking/me/goal": () => ({ ...GOAL, ...over }) });

  it("'8 de 12 aulas · faltam 2 para o bônus de +50', anel acessível e a nota do mês fechado", async () => {
    mockApi();
    await mount(<RankingPage />);
    await openProgress();
    expect(norm(textOf('[data-testid="rkp-goal-headline"]'))).toBe("8 de 12 aulas · faltam 2 para o bônus de +50");
    const svg = q('[data-testid="rk-goal"] svg[role="img"]')!;
    expect(svg.getAttribute("aria-label")).toBe("8 de 12 aulas no mês. Faltam 2 presenças para o bônus.");
    expect(textOf('[data-testid="rk-goal"]')).toContain("O bônus é concedido quando o mês fecha");
    expect(q('[data-testid="rkp-goal-gentle"]')).toBeNull();
  });

  it("falta 1 (singular)", async () => {
    mockApi({ routes: withGoal({ present: 9, remainingForBonus: 1 }) });
    await mount(<RankingPage />);
    await openProgress();
    expect(norm(textOf('[data-testid="rkp-goal-headline"]'))).toBe("9 de 12 aulas · falta 1 para o bônus de +50");
  });

  it("bônus garantido", async () => {
    mockApi({ routes: withGoal({ present: 10, remainingForBonus: 0 }) });
    await mount(<RankingPage />);
    await openProgress();
    expect(q('[data-testid="rkp-goal-body"]')!.getAttribute("data-state")).toBe("reached");
    expect(norm(textOf('[data-testid="rkp-goal-headline"]'))).toContain("bônus de +50 garantido");
  });

  it("sem meta no mês: mensagem própria", async () => {
    mockApi({ routes: withGoal({ hasGoal: false, lessonsPlanned: 0, neededForBonus: 0, remainingForBonus: 0, present: 0 }) });
    await mount(<RankingPage />);
    await openProgress();
    expect(q('[data-testid="rkp-goal-body"]')!.getAttribute("data-state")).toBe("none");
    expect(textOf('[data-testid="rkp-goal-headline"]')).toBe("Sem meta este mês");
  });

  it("canStillReach=false: mensagem gentil, sem culpa", async () => {
    mockApi({ routes: withGoal({ present: 3, remainingForBonus: 7, canStillReach: false }) });
    await mount(<RankingPage />);
    await openProgress();
    const gentle = textOf('[data-testid="rkp-goal-gentle"]');
    expect(gentle).toContain("cada aula continua valendo pontos");
    expect(gentle).not.toMatch(/perdeu|falhou|fracass/i);
  });

  it("erro da meta: mensagem + Tentar de novo", async () => {
    let first = true;
    mockApi({
      routes: {
        "/ranking/me/goal": () => {
          if (first) {
            first = false;
            return json(500, { message: "Meta fora do ar" });
          }
          return GOAL;
        },
      },
    });
    await mount(<RankingPage />);
    await openProgress();
    expect(q('[data-testid="rk-goal"] [role="alert"]')!.textContent).toContain("Meta fora do ar");
    await click(byText('[data-testid="rk-goal"] button', "Tentar de novo"));
    expect(q('[data-testid="rkp-goal-body"]')).not.toBeNull();
  });

  it("próxima liga: pontos que faltam, barra com o percentual e cor da liga", async () => {
    mockApi();
    await mount(<RankingPage />);
    await openProgress();
    const card = q('[data-testid="rk-league"]')!;
    expect(norm(card.textContent ?? "")).toContain("faltam 220 pontos para AXÉ");
    expect(card.querySelector('[role="progressbar"]')!.getAttribute("aria-valuenow")).toBe("69");
    expect((card.querySelector(".rkp-league-body") as HTMLElement).style.getPropertyValue("--lg")).toBe("#3B82F6");
  });

  it("liga máxima: sem barra", async () => {
    mockApi({
      routes: withGoal({ league: { current: { code: "PRETA", name: "Lenda", color: "#111827" }, next: null, pointsToNext: 0, progressPct: 100 } }),
    });
    await mount(<RankingPage />);
    await openProgress();
    expect(textOf('[data-testid="rk-league"]')).toContain("liga máxima");
    expect(q('[data-testid="rk-league"] [role="progressbar"]')).toBeNull();
  });
});

describe("sequência atual e melhor", () => {
  it("mostra as duas, vindas da evolução", async () => {
    mockApi();
    await mount(<RankingPage />);
    await openProgress();
    expect(textOf('[data-testid="rkp-streak-current"]')).toContain("7");
    expect(textOf('[data-testid="rkp-streak-current"]')).toContain("semanas seguidas");
    expect(textOf('[data-testid="rkp-streak-best"]')).toContain("9");
  });
});

describe("gráfico de evolução", () => {
  it("12 barras, a última destacada, tabela alternativa para leitor de tela e resumo", async () => {
    mockApi();
    await mount(<RankingPage />);
    await openProgress();
    const bars = qa('[data-testid="rkp-bar"]');
    expect(bars).toHaveLength(12);
    expect(bars.filter((b) => b.dataset["last"] === "true")).toHaveLength(1);
    expect(bars.at(-1)!.dataset["last"]).toBe("true");
    expect(bars.at(-1)!.querySelector("rect")!.getAttribute("class")).toContain("is-last");
    const svg = q('[data-testid="rkp-chart"] svg')!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(qa('[data-testid="rkp-chart"] table tbody tr')).toHaveLength(12);
    expect(q('[data-testid="rkp-chart"] table caption')!.textContent).toContain("Pontos por semana");
    expect(norm(textOf('[data-testid="rkp-chart-sum"]'))).toContain("Esta semana: 40 pts");
    expect(norm(textOf('[data-testid="rkp-chart-sum"]'))).toContain("melhor semana: 30 pts");
    // a altura da maior barra é a maior de todas
    const heights = bars.map((b) => Number(b.querySelector("rect")!.getAttribute("height")));
    expect(Math.max(...heights)).toBe(heights.at(-1));
  });

  it("alternância Semanas/Meses pede granularity=MONTH e redesenha com rótulos de mês", async () => {
    mockApi();
    await mount(<RankingPage />);
    await openProgress();
    const radios = qa('[role="radiogroup"][aria-label="Período do gráfico"] [role="radio"]');
    expect(radios.map((r) => r.textContent)).toEqual(["Semanas", "Meses"]);
    expect(radios[0]!.getAttribute("aria-checked")).toBe("true");
    await click(radios[1]);
    const last = callsTo("/ranking/me/evolution").at(-1)!.url.searchParams;
    expect(last.get("granularity")).toBe("MONTH");
    expect(last.get("count")).toBe("12");
    expect(qa('[role="radiogroup"][aria-label="Período do gráfico"] [role="radio"]')[1]!.getAttribute("aria-checked")).toBe("true");
    expect(q('[data-testid="rkp-chart"] table caption')!.textContent).toContain("Pontos por mês");
    const labels = qa('[data-testid="rkp-chart"] svg text.rkp-bar-label').map((t) => t.textContent);
    expect(labels.at(-1)).toBe("dez");
    expect(norm(textOf('[data-testid="rkp-chart-sum"]'))).toContain("Este mês: 90 pts");
  });

  it("sem pontos no período: mensagem em vez do gráfico", async () => {
    mockApi({
      routes: {
        "/ranking/me/evolution": () => ({ ...EVOLUTION_WEEK, points: EVOLUTION_WEEK.points.map((p) => ({ ...p, points: 0 })), bestWeek: null }),
      },
    });
    await mount(<RankingPage />);
    await openProgress();
    expect(q('[data-testid="rkp-evo-empty"]')).not.toBeNull();
    expect(q('[data-testid="rkp-bar"]')).toBeNull();
  });

  it("erro: Tentar de novo", async () => {
    let first = true;
    mockApi({
      routes: {
        "/ranking/me/evolution": () => {
          if (first) {
            first = false;
            return json(500, { message: "Evolução fora do ar" });
          }
          return EVOLUTION_WEEK;
        },
      },
    });
    await mount(<RankingPage />);
    await openProgress();
    expect(q('[data-testid="rk-evolution"] [role="alert"]')!.textContent).toContain("Evolução fora do ar");
    await click(byText('[data-testid="rk-evolution"] button', "Tentar de novo"));
    expect(q('[data-testid="rkp-chart"]')).not.toBeNull();
  });
});

describe("extrato: Como ganhei meus pontos", () => {
  it("itens com ícone por tipo, label do servidor, +pontos e data; total de todos os tempos", async () => {
    mockApi();
    await mount(<RankingPage />);
    await openProgress();
    const items = qa('[data-testid="rkp-stmt-item"]');
    expect(items).toHaveLength(2);
    expect(items[0]!.dataset["type"]).toBe("CLASS_ATTENDANCE");
    expect(items[0]!.textContent).toContain("Aula: Turma 1");
    expect(items[0]!.textContent).toContain("+10");
    expect(items[1]!.textContent).toContain("Check-in do dia 02/11");
    expect(items[1]!.textContent).toContain("+1");
    expect(items[0]!.querySelector(".rkp-stmt-icon svg")).not.toBeNull();
    expect(items[0]!.querySelector("time")!.getAttribute("title")).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(norm(textOf('[data-testid="rkp-stmt-total"]'))).toBe("Total de todos os tempos: 6.420 pts");
  });

  it("filtro de temporada: Todos os tempos + as temporadas do aluno; escolher uma pede season=YYYY-MM e mostra o total dela", async () => {
    mockApi();
    await mount(<RankingPage />);
    await openProgress();
    const select = q<HTMLSelectElement>('select[aria-label="Filtrar extrato por temporada"]')!;
    expect([...select.options].map((o) => o.textContent)).toEqual(["Todos os tempos", "Novembro de 2026", "Outubro de 2026"]);
    await selectValue(select, "2026-10");
    const last = callsTo("/ranking/me/points").at(-1)!.url.searchParams;
    expect(last.get("season")).toBe("2026-10");
    expect(last.get("offset")).toBe("0");
    expect(norm(textOf('[data-testid="rkp-stmt-total"]'))).toBe("Total em Outubro de 2026: 420 pts");
  });

  it("'Ver mais' pede a próxima página (offset) e acrescenta os itens", async () => {
    const all = Array.from({ length: 25 }, (_, i) => stmtItem(i + 1));
    mockApi({
      routes: {
        "/ranking/me/points": (url) => {
          const offset = Number(url.searchParams.get("offset"));
          const limit = Number(url.searchParams.get("limit"));
          return statement(all.slice(offset, offset + limit), { total: 25 });
        },
      },
    });
    await mount(<RankingPage />);
    await openProgress();
    expect(qa('[data-testid="rkp-stmt-item"]')).toHaveLength(20);
    expect(textOf('[data-testid="rk-statement"]')).toContain("Mostrando 20 de 25");
    await click(byText("button", "Ver mais"));
    expect(callsTo("/ranking/me/points").at(-1)!.url.searchParams.get("offset")).toBe("20");
    expect(qa('[data-testid="rkp-stmt-item"]')).toHaveLength(25);
    expect(byText("button", "Ver mais")).toBeUndefined();
  });

  it("vazio: mensagem amigável", async () => {
    mockApi({ routes: { "/ranking/me/points": () => statement([], { seasonTotals: [], allTimePoints: 0 }) } });
    await mount(<RankingPage />);
    await openProgress();
    expect(textOf('[data-testid="rkp-stmt-empty"]')).toContain("Ainda sem pontos");
    expect(q('[data-testid="rkp-stmt-list"]')).toBeNull();
  });

  it("erro: mensagem do servidor e Tentar de novo", async () => {
    let first = true;
    mockApi({
      routes: {
        "/ranking/me/points": () => {
          if (first) {
            first = false;
            return json(500, { message: "Extrato indisponível" });
          }
          return statement([stmtItem(1)]);
        },
      },
    });
    await mount(<RankingPage />);
    await openProgress();
    expect(q('[data-testid="rk-statement"] [role="alert"]')!.textContent).toContain("Extrato indisponível");
    await click(byText('[data-testid="rk-statement"] button', "Tentar de novo"));
    expect(qa('[data-testid="rkp-stmt-item"]')).toHaveLength(1);
  });

  it("vitrine escolhida aparece em destaque no topo de Meu progresso", async () => {
    mockApi();
    await mount(<RankingPage />);
    await openProgress();
    const card = q('[data-testid="rkp-showcase-card"]')!;
    expect(card.textContent).toContain("25 aulas");
    expect(card.textContent).toContain("Bronze");
  });
});
