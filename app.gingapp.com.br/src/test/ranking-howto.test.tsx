import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RankingPage } from "@/components/gingapp/ranking";
import type { RankingRules } from "@/lib/ranking-student";
import { RULES, byText, callsTo, cleanup, click, json, mockApi, mount, prepare, q, qa, textOf } from "./ranking-student-fixtures";

/**
 * "Como funciona?": TODO número do texto vem de GET /ranking/rules. Troca-se o mock e o texto muda; o app não tem número fixo.
 */

const norm = (text: string) => text.replace(/\s+/g, " ").trim();
/** Texto de uma linha com um espaço entre as células/blocos (o visual separa por layout, não por espaço). */
const cells = (el: Element) => [...el.children].map((child) => norm(child.textContent ?? "")).filter(Boolean).join(" ");
const section = (id: string) => q(`[data-testid="how-${id}"]`)!;
const trigger = (id: string) => section(id).querySelector<HTMLButtonElement>("button[aria-expanded]")!;

async function openHow() {
  await click(byText("button", "Como funciona?"));
}
async function expand(id: string) {
  if (trigger(id).getAttribute("aria-expanded") !== "true") await click(trigger(id));
}

beforeEach(prepare);
afterEach(cleanup);

describe("Como funciona? - carregamento", () => {
  it("só pede /ranking/rules ao abrir a folha, e uma vez", async () => {
    mockApi();
    await mount(<RankingPage />);
    expect(callsTo("/ranking/rules")).toHaveLength(0);
    await openHow();
    expect(callsTo("/ranking/rules")).toHaveLength(1);
    expect(q('[role="dialog"]')!.textContent).toContain("Como funciona o Ginga Rank");
    await click(q('[role="dialog"] button.absolute, [role="dialog"] button[class*="absolute"]'));
    await openHow();
    expect(callsTo("/ranking/rules")).toHaveLength(1); // regras ficam em cache (staleTime longo)
  });

  it("carregando: esqueleto; erro: mensagem e Tentar de novo", async () => {
    mockApi({ routes: { "/ranking/rules": () => new Promise(() => {}) } });
    await mount(<RankingPage />);
    await openHow();
    expect(q('[data-testid="how-loading"]')).not.toBeNull();
    cleanup();

    prepare();
    let first = true;
    mockApi({
      routes: {
        "/ranking/rules": () => {
          if (first) {
            first = false;
            return json(500, { message: "Regras fora do ar" });
          }
          return RULES;
        },
      },
    });
    await mount(<RankingPage />);
    await openHow();
    expect(q('[data-testid="how-error"]')!.textContent).toContain("Regras fora do ar");
    expect(q('[data-testid="how-rules"]')).toBeNull(); // nunca mostra texto com número inventado
    await click(byText('[data-testid="how-error"] button', "Tentar de novo"));
    expect(q('[data-testid="how-rules"]')).not.toBeNull();
  });
});

describe("Como funciona? - conteúdo vindo de /ranking/rules", () => {
  it("como ganhar pontos (tabela) e limite diário", async () => {
    mockApi();
    await mount(<RankingPage />);
    await openHow();
    const rows = qa('[data-testid="how-points"] table tbody tr').map(cells);
    expect(rows).toEqual([
      "Ir à aula +10 por aula",
      "Semanas seguidas treinando +5 a mais a cada semana seguida, até +25",
      "Evento do grupo +30",
      "Roda +25",
      "Mês consistente +50",
      "Nova graduação +100 × o nível da corda",
      "Certificado +20",
      "Check-in diário +1",
      "Semana em dia no check-in +5",
    ]);
    expect(norm(textOf('[data-testid="how-daily-limit"]'))).toBe("Limite do dia: no máximo 3 aulas por dia rendem ponto.");
    expect(textOf('[data-testid="how-points"]')).toContain("Mensalidade e pagamentos nunca dão ponto");
  });

  it("sequência semanal: exemplo numérico calculado das constantes", async () => {
    mockApi();
    await mount(<RankingPage />);
    await openHow();
    await expand("streak");
    const lines = qa('[data-testid="how-streak-example"] li').map((li) => norm(li.textContent ?? ""));
    expect(lines).toEqual([
      "2ª semana seguida: +5",
      "3ª semana seguida: +10",
      "4ª semana seguida: +15",
      "5ª semana seguida: +20",
      "6ª semana seguida: +25",
    ]);
    expect(norm(textOf('[data-testid="how-streak"]'))).toContain("A partir da 6ª semana seguida o bônus fica no teto de +25 por semana.");
  });

  it("mês consistente: percentual e mínimo de aulas vêm das constantes", async () => {
    mockApi();
    await mount(<RankingPage />);
    await openHow();
    await expand("month");
    const text = norm(textOf('[data-testid="how-month-text"]'));
    expect(text).toContain("pelo menos 80% das aulas");
    expect(text).toContain("pelo menos 4 aulas com chamada");
    expect(text).toContain("+50");
    expect(textOf('[data-testid="how-month"]')).toContain("concedido quando o mês fecha");
  });

  it("check-in diário: vale pouco, treino vale mais, meta semanal e teto do mês", async () => {
    mockApi();
    await mount(<RankingPage />);
    await openHow();
    await expand("daily");
    const text = norm(textOf('[data-testid="how-daily"]'));
    expect(text).toContain("Vale 1 ponto");
    expect(text).toContain("treinar vale muito mais (uma aula vale +10)");
    expect(text).toContain("com 5 ou mais dias de check-in na semana você ganha +5 quando a semana fecha");
    expect(text).toContain("só os primeiros 20 dias");
    expect(text).toContain("Faltar um dia não tira nada");
  });

  it("ligas (cores e mínimos), categorias, faixas etárias e temporadas", async () => {
    mockApi();
    await mount(<RankingPage />);
    await openHow();
    await expand("leagues");
    await expand("categories");
    await expand("bands");
    await expand("seasons");
    const leagues = qa('[data-testid="how-leagues"] li');
    expect(leagues.map(cells)).toEqual([
      "Semente ponto de partida",
      "Broto a partir de 300 pontos",
      "Ginga a partir de 900 pontos",
      "Roda a partir de 2.000 pontos",
    ]);
    expect(leagues[1]!.style.getPropertyValue("--lg")).toBe("#22C55E");
    expect(qa('[data-testid="how-categories"] li').map((li) => norm(li.textContent ?? ""))).toEqual(RULES.categories.map((c) => `${c.label}: ${c.description}`));
    expect(qa('[data-testid="how-bands"] li').map((li) => li.textContent)).toEqual(["Kids (até 12 anos)", "Juvenil (13 a 17)", "Adulto (18+)"]);
    const seasons = norm(textOf('[data-testid="how-seasons-text"]'));
    expect(seasons).toContain("A temporada é mensal");
    expect(seasons).toContain("horário de Brasília");
  });

  it("conquistas (níveis contados das regras e raridade) e privacidade", async () => {
    mockApi();
    await mount(<RankingPage />);
    await openHow();
    await expand("achievements");
    await expand("privacy");
    expect(norm(textOf('[data-testid="how-ach-text"]'))).toBe("Existem 4 conquistas: 2 de bronze, 1 de prata e 1 de ouro. O nível mostra o quanto cada uma é difícil, e vem escrito junto com a medalha.");
    expect(textOf('[data-testid="how-achievements"]')).toContain("quantos por cento do grupo");
    const privacy = norm(textOf('[data-testid="how-privacy"]'));
    expect(privacy).toContain("todos os alunos ativos");
    expect(privacy).toContain("só aparece se quiser");
    expect(privacy).toContain("apelido");
    expect(privacy).toContain("autorização do responsável");
  });

  it("perguntas frequentes", async () => {
    mockApi();
    await mount(<RankingPage />);
    await openHow();
    const questions = ["faq-fee", "faq-absence", "faq-missing", "faq-season", "faq-checkin"].map((id) => norm(trigger(id).textContent ?? ""));
    expect(questions).toEqual([
      "Pagar a mensalidade dá ponto?",
      "Se eu faltar, perco ponto?",
      "Por que meu ponto não apareceu?",
      "O que é temporada?",
      "Quanto vale o check-in diário?",
    ]);
    await expand("faq-fee");
    expect(textOf('[data-testid="how-faq-fee"]')).toContain("Não. Pagamento e mensalidade nunca dão ponto");
    await expand("faq-absence");
    expect(textOf('[data-testid="how-faq-absence"]')).toContain("Falta não tira ponto");
    await expand("faq-missing");
    expect(textOf('[data-testid="how-faq-missing"]')).toContain("presença está registrada na chamada");
    await expand("faq-season");
    expect(textOf('[data-testid="how-faq-season"]')).toContain("a temporada é mensal");
    await expand("faq-checkin");
    expect(norm(textOf('[data-testid="how-faq-checkin"]'))).toContain("1 ponto por dia");
    expect(norm(textOf('[data-testid="how-faq-checkin"]'))).toContain("uma aula vale +10");
  });

  it("acordeão acessível: gatilhos são botões com aria-expanded e o clique alterna", async () => {
    mockApi();
    await mount(<RankingPage />);
    await openHow();
    expect(trigger("points").getAttribute("aria-expanded")).toBe("true"); // aberto por padrão
    expect(trigger("streak").getAttribute("aria-expanded")).toBe("false");
    await click(trigger("streak"));
    expect(trigger("streak").getAttribute("aria-expanded")).toBe("true");
    await click(trigger("streak"));
    expect(trigger("streak").getAttribute("aria-expanded")).toBe("false");
  });
});

describe("Como funciona? - nada de número fixo no app", () => {
  const OTHER: RankingRules = {
    ...RULES,
    points: {
      classAttendance: 20,
      streakStep: 10,
      streakMax: 30,
      eventAttendance: 45,
      rodaParticipation: 35,
      monthlyConsistency: 80,
      graduationPerLevel: 150,
      certificate: 12,
      dailyCheckin: 2,
      dailyWeekBonus: 8,
    },
    limits: { maxClassPointsPerDay: 2, consistencyMinRate: 0.9, consistencyMinLessons: 6, dailyWeekTarget: 4, dailyMonthCapDays: 15 },
    leagues: [
      { code: "CRUA", name: "Semente", color: "#E5E5E5", minPoints: 0 },
      { code: "VERDE", name: "Broto", color: "#22C55E", minPoints: 500 },
    ],
    seasons: { lengthLabel: "semanal", timezone: "America/Sao_Paulo" },
  };

  it("trocando o mock das regras, os textos mudam junto", async () => {
    mockApi({ routes: { "/ranking/rules": () => OTHER } });
    await mount(<RankingPage />);
    await openHow();
    await expand("streak");
    await expand("month");
    await expand("daily");
    await expand("leagues");
    await expand("seasons");

    const rows = qa('[data-testid="how-points"] table tbody tr').map(cells);
    expect(rows[0]).toBe("Ir à aula +20 por aula");
    expect(rows[1]).toBe("Semanas seguidas treinando +10 a mais a cada semana seguida, até +30");
    expect(rows[4]).toBe("Mês consistente +80");
    expect(norm(textOf('[data-testid="how-daily-limit"]'))).toContain("no máximo 2 aulas por dia");

    expect(qa('[data-testid="how-streak-example"] li').map((li) => norm(li.textContent ?? ""))).toEqual([
      "2ª semana seguida: +10",
      "3ª semana seguida: +20",
      "4ª semana seguida: +30",
    ]);
    const month = norm(textOf('[data-testid="how-month-text"]'));
    expect(month).toContain("pelo menos 90% das aulas");
    expect(month).toContain("pelo menos 6 aulas com chamada");
    expect(month).toContain("+80");

    const daily = norm(textOf('[data-testid="how-daily"]'));
    expect(daily).toContain("Vale 2 pontos");
    expect(daily).toContain("uma aula vale +20");
    expect(daily).toContain("com 4 ou mais dias");
    expect(daily).toContain("+8 quando a semana fecha");
    expect(daily).toContain("primeiros 15 dias");

    expect(qa('[data-testid="how-leagues"] li')).toHaveLength(2);
    expect(norm(textOf('[data-testid="how-leagues"]'))).toContain("a partir de 500 pontos");
    expect(norm(textOf('[data-testid="how-seasons-text"]'))).toContain("A temporada é semanal");

    // nenhum número da outra configuração sobrou nos textos
    const all = norm(textOf('[data-testid="how-rules"]'));
    expect(all).not.toContain("80%");
    expect(all).not.toContain("até +25");
    expect(all).not.toContain("300 pontos");
  });
});
