import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

import { RankingPage } from "@/components/gingapp/ranking";
import { ProfileShowcase } from "@/components/gingapp/ranking-achievements";
import type { AchievementsResponse } from "@/lib/ranking-student";
import {
  ACHIEVEMENTS,
  baseMe,
  byText,
  callsTo,
  cleanup,
  click,
  json,
  mockApi,
  mount,
  prepare,
  q,
  qa,
  textOf,
} from "./ranking-student-fixtures";

/** Ginga Rank - Conquistas: grade completa, níveis, raridade, detalhe, vitrine (até 3) e vitrine no perfil. */

const norm = (text: string) => text.replace(/\s+/g, " ").trim();
const card = (code: string) => q(`[data-testid="rkp-ach"][data-code="${code}"]`)!;

async function openAchievements() {
  await click(byText('button[role="tab"]', "Conquistas"));
}

beforeEach(() => {
  prepare();
  toastMock.success.mockClear();
});
afterEach(cleanup);

describe("grade de conquistas", () => {
  it("mostra TODAS (ganhas e bloqueadas), agrupadas por família, com o contador 'N de M'", async () => {
    mockApi();
    await mount(<RankingPage />);
    await openAchievements();
    expect(qa('[data-testid="rkp-ach"]')).toHaveLength(7);
    expect(qa('[data-testid="rkp-family"]').map((s) => s.querySelector("h3")!.textContent)).toEqual([
      "Presença",
      "Sequência",
      "Check-in diário",
      "Mês",
    ]);
    expect(norm(textOf('[data-testid="rkp-ach-count"]'))).toBe("4 de 7 conquistas");
    expect(qa('[data-testid="rkp-ach"][data-earned="true"]')).toHaveLength(4);
    expect(qa('[data-testid="rkp-ach"][data-earned="false"]')).toHaveLength(3);
    expect(callsTo("/ranking/me/achievements").at(-1)!.url.searchParams.get("studentId")).toBe("11");
  });

  it("nível por escrito (Bronze/Prata/Ouro) e ícone lucide por conquista - sem emoji", async () => {
    mockApi();
    await mount(<RankingPage />);
    await openAchievements();
    expect(card("AULAS_25").textContent).toContain("Bronze");
    expect(card("CENTURION").textContent).toContain("Prata");
    expect(card("AULAS_250").textContent).toContain("Ouro");
    for (const item of qa('[data-testid="rkp-ach"]')) expect(item.querySelector(".rkp-medal svg"), item.dataset["code"]).not.toBeNull();
    expect(q('[data-testid="rk-achievements"]')!.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
    // a cor do nível vem por classe, o rótulo por texto, e o leitor de tela ouve o nível
    expect(card("AULAS_25").querySelector(".rkp-medal")!.className).toContain("is-bronze");
    expect(card("CENTURION").querySelector(".rkp-medal")!.className).toContain("is-silver");
    expect(card("AULAS_250").querySelector(".rkp-medal")!.className).toContain("is-gold");
    expect(card("CENTURION").getAttribute("aria-label")).toContain("medalha de prata");
  });

  it("ganha = 'Conquistada'; bloqueada = esmaecida com barra current/target", async () => {
    mockApi();
    await mount(<RankingPage />);
    await openAchievements();
    expect(card("AULAS_25").textContent).toContain("Conquistada");
    expect(card("AULAS_25").querySelector('[role="progressbar"]')).toBeNull();
    const locked = card("CENTURION");
    expect(locked.className).toContain("is-locked");
    const bar = locked.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute("aria-valuenow")).toBe("62");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
    expect(locked.textContent).toContain("62/100");
    // sem progresso contável (Mês perfeito): nenhuma barra
    expect(card("PERFECT_MONTH").querySelector('[role="progressbar"]')).toBeNull();
  });

  it("raridade: 'só X% do grupo tem' e, com null, nada é mostrado", async () => {
    mockApi();
    await mount(<RankingPage />);
    await openAchievements();
    expect(card("CENTURION").querySelector('[data-testid="rkp-rarity"]')!.textContent).toBe("só 4% do grupo tem");
    expect(card("AULAS_25").querySelector('[data-testid="rkp-rarity"]')!.textContent).toBe("62,5% do grupo tem");
    expect(card("AULAS_250").querySelector('[data-testid="rkp-rarity"]')).toBeNull();
    expect(card("AULAS_250").textContent).not.toContain("do grupo");
  });

  it("detalhe ao tocar: bloqueada mostra como conquistar, progresso e raridade; ganha mostra a data", async () => {
    mockApi();
    await mount(<RankingPage />);
    await openAchievements();
    await click(card("CENTURION"));
    const dialog = q('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Centurião");
    expect(dialog.textContent).toContain("Ainda não conquistada");
    expect(dialog.textContent).toContain("Como conquistar: Descrição de CENTURION.");
    expect(dialog.textContent).toContain("Prata");
    expect(dialog.querySelector('[role="progressbar"]')!.getAttribute("aria-valuenow")).toBe("62");
    expect(textOf('[data-testid="rkp-dialog-rarity"]')).toBe("só 4% do grupo tem");
    await click(q('[role="dialog"] button'));
    await click(card("AULAS_25"));
    expect(q('[role="dialog"]')!.textContent).toContain("Conquistada em 10/03/2026");
  });

  it("carregando: esqueleto; erro: Tentar de novo", async () => {
    mockApi({ routes: { "/ranking/me/achievements": () => new Promise(() => {}) } });
    await mount(<RankingPage />);
    await openAchievements();
    expect(q('[data-testid="rkp-ach-loading"]')).not.toBeNull();
    cleanup();

    prepare();
    let first = true;
    mockApi({
      routes: {
        "/ranking/me/achievements": () => {
          if (first) {
            first = false;
            return json(500, { message: "Conquistas fora do ar" });
          }
          return ACHIEVEMENTS;
        },
      },
    });
    await mount(<RankingPage />);
    await openAchievements();
    expect(q('[data-testid="rkp-ach-error"] [role="alert"]')!.textContent).toContain("Conquistas fora do ar");
    await click(byText("button", "Tentar de novo"));
    expect(qa('[data-testid="rkp-ach"]')).toHaveLength(7);
  });
});

describe("vitrine (até 3)", () => {
  /** Backend com estado: o PUT grava a vitrine e o GET seguinte já devolve o novo valor. */
  function stateful(over: { putStatus?: number; putBody?: unknown } = {}) {
    let showcase = [...ACHIEVEMENTS.showcase];
    const put: Record<string, unknown>[] = [];
    mockApi({
      routes: {
        "/ranking/me/achievements": (): AchievementsResponse => ({ ...ACHIEVEMENTS, showcase }),
        "PUT /ranking/me/settings": (_url, call) => {
          const body = JSON.parse(call.body ?? "{}") as { showcase?: string[] };
          put.push(body);
          if (over.putStatus) return json(over.putStatus, over.putBody);
          showcase = body.showcase ?? showcase;
          return baseMe().settings;
        },
      },
    });
    return { put };
  }

  it("a vitrine salva aparece em destaque no topo de Conquistas", async () => {
    stateful();
    await mount(<RankingPage />);
    await openAchievements();
    const items = qa('[data-testid="rkp-showcase-item"]');
    expect(items.map((i) => i.dataset["code"])).toEqual(["AULAS_25"]);
    expect(byText("button", "Editar vitrine")).toBeDefined();
  });

  it("escolher até 3 ganhas: o 4º e as bloqueadas ficam desabilitados; salvar envia PUT {showcase} e mostra a nova vitrine", async () => {
    const { put } = stateful();
    await mount(<RankingPage />);
    await openAchievements();
    await click(byText("button", "Editar vitrine"));
    expect(textOf('[data-testid="rkp-showcase-count"]')).toBe("1 de 3");
    expect(card("AULAS_25").getAttribute("aria-pressed")).toBe("true");
    // bloqueadas não podem entrar
    expect((card("CENTURION") as HTMLButtonElement).disabled).toBe(true);
    await click(card("SEQ_4W"));
    await click(card("SEQ_8W"));
    expect(textOf('[data-testid="rkp-showcase-count"]')).toBe("3 de 3");
    // lotou: a 4ª ganha não entra
    expect((card("DAILY_7") as HTMLButtonElement).disabled).toBe(true);
    // tirar uma libera
    await click(card("SEQ_4W"));
    expect(textOf('[data-testid="rkp-showcase-count"]')).toBe("2 de 3");
    expect((card("DAILY_7") as HTMLButtonElement).disabled).toBe(false);
    await click(card("DAILY_7"));
    await click(byText("button", "Salvar vitrine"));

    expect(put).toEqual([{ showcase: ["AULAS_25", "SEQ_8W", "DAILY_7"] }]);
    const call = callsTo("/ranking/me/settings", "PUT")[0]!;
    expect(call.url.searchParams.get("studentId")).toBe("11");
    expect(toastMock.success).toHaveBeenCalledWith("Vitrine salva!");
    expect(q('[data-testid="rkp-showcase-edit"]')).toBeNull(); // saiu do modo de escolha
    expect(qa('[data-testid="rkp-showcase-item"]').map((i) => i.dataset["code"])).toEqual(["AULAS_25", "SEQ_8W", "DAILY_7"]);
  });

  it("salvar refaz as consultas do rank (achievements e me)", async () => {
    stateful();
    await mount(<RankingPage />);
    await openAchievements();
    const before = callsTo("/ranking/me/achievements").length;
    await click(byText("button", "Editar vitrine"));
    await click(card("SEQ_4W"));
    await click(byText("button", "Salvar vitrine"));
    expect(callsTo("/ranking/me/achievements").length).toBeGreaterThan(before);
  });

  it("cancelar descarta a escolha e não envia nada", async () => {
    const { put } = stateful();
    await mount(<RankingPage />);
    await openAchievements();
    await click(byText("button", "Editar vitrine"));
    await click(card("SEQ_4W"));
    await click(byText("button", "Cancelar"));
    expect(put).toEqual([]);
    expect(qa('[data-testid="rkp-showcase-item"]').map((i) => i.dataset["code"])).toEqual(["AULAS_25"]);
  });

  it("limpar a vitrine envia lista vazia", async () => {
    const { put } = stateful();
    await mount(<RankingPage />);
    await openAchievements();
    await click(byText("button", "Editar vitrine"));
    await click(card("AULAS_25"));
    await click(byText("button", "Salvar vitrine"));
    expect(put).toEqual([{ showcase: [] }]);
    expect(q('[data-testid="rkp-showcase-empty"]')).not.toBeNull();
  });

  it("400 ACHIEVEMENT_NOT_EARNED: mensagem clara e continua escolhendo", async () => {
    stateful({ putStatus: 400, putBody: { statusCode: 400, code: "ACHIEVEMENT_NOT_EARNED", message: "bad" } });
    await mount(<RankingPage />);
    await openAchievements();
    await click(byText("button", "Editar vitrine"));
    await click(card("SEQ_4W"));
    await click(byText("button", "Salvar vitrine"));
    expect(textOf('[data-testid="rkp-showcase-error"]')).toContain("conquistas que você já ganhou");
    expect(q('[data-testid="rkp-showcase-edit"]')).not.toBeNull();
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it("vitrine vazia: convite a escolher; sem nenhuma ganha o botão fica desabilitado", async () => {
    mockApi({ routes: { "/ranking/me/achievements": () => ({ ...ACHIEVEMENTS, showcase: [] }) } });
    await mount(<RankingPage />);
    await openAchievements();
    expect(textOf('[data-testid="rkp-showcase-empty"]')).toContain("Escolha até 3");
    expect(byText("button", "Escolher vitrine")).toBeDefined();
    cleanup();

    prepare();
    mockApi({
      routes: {
        "/ranking/me/achievements": () => ({
          items: ACHIEVEMENTS.items.map((i) => ({ ...i, earned: false, earnedAt: null })),
          showcase: [],
          earnedCount: 0,
          totalCount: 7,
        }),
      },
    });
    await mount(<RankingPage />);
    await openAchievements();
    expect(textOf('[data-testid="rkp-showcase-empty"]')).toContain("Ganhe sua primeira conquista");
    expect((byText("button", "Escolher vitrine") as HTMLButtonElement).disabled).toBe(true);
  });

  it("a vitrine também aparece em destaque no topo de Meu progresso", async () => {
    stateful();
    await mount(<RankingPage />);
    await click(byText('button[role="tab"]', "Meu progresso"));
    expect(textOf('[data-testid="rkp-showcase-card"]')).toContain("25 aulas");
  });
});

describe("vitrine no perfil do aluno", () => {
  it("mostra 'Minhas conquistas' com a vitrine e um atalho para o ranking", async () => {
    mockApi();
    await mount(<ProfileShowcase />);
    const section = q('[data-testid="profile-showcase"]')!;
    expect(section.textContent).toContain("Minhas conquistas");
    expect(section.textContent).toContain("25 aulas");
    expect(section.querySelector('a[href="/ranking"]')).not.toBeNull();
    expect(callsTo("/ranking/me/achievements").at(-1)!.url.searchParams.get("studentId")).toBe("11");
  });

  it("some sem vitrine, com erro e sem aluno (nada de mensagem de erro no perfil; sem aluno nem consulta)", async () => {
    mockApi({ routes: { "/ranking/me/achievements": () => ({ ...ACHIEVEMENTS, showcase: [] }) } });
    await mount(<ProfileShowcase />);
    expect(q('[data-testid="profile-showcase"]')).toBeNull();
    cleanup();

    prepare();
    mockApi({ routes: { "/ranking/me/achievements": () => json(500, { message: "x" }) } });
    await mount(<ProfileShowcase />);
    expect(q('[data-testid="profile-showcase"]')).toBeNull();
    cleanup();

    prepare();
    mockApi({ students: [] });
    await mount(<ProfileShowcase />);
    expect(q('[data-testid="profile-showcase"]')).toBeNull();
    expect(callsTo("/ranking/me/achievements")).toHaveLength(0);
  });
});
