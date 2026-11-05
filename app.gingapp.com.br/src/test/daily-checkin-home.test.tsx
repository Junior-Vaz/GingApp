import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({ children, to, ...rest }: { children?: ReactNode; to?: string } & Record<string, unknown>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

import { DailyCheckinHomeRow } from "@/components/gingapp/daily-checkin-home";
import { HomePage } from "@/components/gingapp/home";
import { DailyCheckinCard } from "@/components/gingapp/ranking-progress";
import { DAILY, ST, byText, calls, callsTo, cleanup, click, json, mockApi, mount, prepare, q, qa, textOf } from "./ranking-student-fixtures";

/**
 * Linha fina "Check-in de hoje" da Home: só com Ranking acessível, aluno ativo e check-in pendente; sem aluno não consulta;
 * usa a MESMA chave de query do cartão de Meu progresso.
 */

const norm = (text: string) => text.replace(/\s+/g, " ").trim();
const row = () => q('[data-testid="daily-checkin-home-row"]');

beforeEach(prepare);
afterEach(cleanup);

describe("linha do check-in diário na Home", () => {
  it("pendente: uma linha com texto curto e botão; o toque envia POST sem corpo e vira a confirmação", async () => {
    mockApi();
    await mount(<DailyCheckinHomeRow />);
    expect(row()).not.toBeNull();
    expect(norm(row()!.textContent ?? "")).toContain("Check-in de hoje");
    expect(norm(row()!.textContent ?? "")).toContain("3 de 5 dias nesta semana");
    const button = byText("button", "Salve!")!;
    expect(button).toBeDefined();
    expect(callsTo("/ranking/me/daily-checkin", "GET")[0]!.url.searchParams.get("studentId")).toBe("11");

    await click(button);
    const posts = callsTo("/ranking/me/daily-checkin", "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toBeNull();
    expect(posts[0]!.url.searchParams.get("studentId")).toBe("11");
    expect(row()).toBeNull();
    expect(norm(textOf('[data-testid="daily-checkin-home-done"]'))).toBe("Check-in feito! +1 ponto");
  });

  it("já feito hoje: nenhuma linha", async () => {
    mockApi({ routes: { "GET /ranking/me/daily-checkin": () => ({ ...DAILY, checkedInToday: true }) } });
    await mount(<DailyCheckinHomeRow />);
    expect(row()).toBeNull();
    expect(q('[data-testid="daily-checkin-home-done"]')).toBeNull();
    expect(callsTo("/ranking/me/daily-checkin", "POST")).toHaveLength(0);
  });

  it("sem aluno ligado: nenhuma requisição e nenhuma linha", async () => {
    mockApi({ students: [] });
    await mount(<DailyCheckinHomeRow />);
    expect(row()).toBeNull();
    expect(calls.filter((c) => c.path.startsWith("/ranking"))).toEqual([]);
  });

  it("Ranking inacessível (403/404) ou resposta fora do formato: nenhuma linha, nenhuma mensagem", async () => {
    mockApi({ routes: { "GET /ranking/me/daily-checkin": () => json(403, { message: "Sem acesso" }) } });
    await mount(<DailyCheckinHomeRow />);
    expect(row()).toBeNull();
    expect(q('[role="alert"]')).toBeNull();
    cleanup();

    prepare();
    mockApi({ routes: { "GET /ranking/me/daily-checkin": () => [] } });
    await mount(<DailyCheckinHomeRow />);
    expect(row()).toBeNull();
  });

  it("carregando: nada na tela", async () => {
    mockApi({ routes: { "GET /ranking/me/daily-checkin": () => new Promise(() => {}) } });
    await mount(<DailyCheckinHomeRow />);
    expect(row()).toBeNull();
  });

  it("erro no toque: mensagem curta e o botão continua", async () => {
    mockApi({ routes: { "POST /ranking/me/daily-checkin": () => json(429, { message: "Too Many Requests" }) } });
    await mount(<DailyCheckinHomeRow />);
    await click(byText("button", "Salve!"));
    expect(textOf('[data-testid="daily-checkin-home-error"]')).toContain("Muitos toques");
    expect(byText("button", "Salve!")).toBeDefined();
  });

  it("botão com altura mínima de 44 px (min-h-11)", async () => {
    mockApi();
    await mount(<DailyCheckinHomeRow />);
    expect(byText("button", "Salve!")!.className).toContain("min-h-11");
  });

  it("mesma chave de query do cartão de Meu progresso: um único GET para os dois e o toque atualiza ambos", async () => {
    mockApi();
    await mount(
      <>
        <DailyCheckinHomeRow />
        <DailyCheckinCard />
      </>,
    );
    expect(callsTo("/ranking/me/daily-checkin", "GET")).toHaveLength(1);
    expect(row()).not.toBeNull();
    expect(byText("button", "Salve! Check-in de hoje")).toBeDefined();
    await click(byText("button", "Salve!"));
    expect(callsTo("/ranking/me/daily-checkin", "POST")).toHaveLength(1);
    expect(byText("button", "Salve! Check-in de hoje")).toBeUndefined(); // o cartão também virou "concluído"
    expect(q('[data-testid="rkp-daily-done"]')).not.toBeNull();
  });

  it("dependente selecionado: a consulta e o POST levam o studentId do aluno ativo", async () => {
    mockApi({ students: [ST(11, null, "Bruno"), ST(12, 1, "Alice")] });
    await mount(<DailyCheckinHomeRow />);
    expect(callsTo("/ranking/me/daily-checkin", "GET").every((c) => c.url.searchParams.get("studentId") === "12")).toBe(true);
    await click(byText("button", "Salve!"));
    expect(callsTo("/ranking/me/daily-checkin", "POST")[0]!.url.searchParams.get("studentId")).toBe("12");
  });
});

describe("Home", () => {
  it("a linha aparece na Home só quando pendente, fora do bloco de cartões do topo", async () => {
    mockApi({
      routes: {
        "/students/me": () => [ST(11, 1, "Camila Souza")],
        "/organizations": () => [],
        "/passport/me": () => json(404, { message: "sem passaporte" }),
      },
    });
    await mount(<HomePage />);
    const homeRow = row();
    expect(homeRow).not.toBeNull();
    // não empilha com o convite de instalar/avisos nem com o check-in por localização: vem depois da prévia do Grupo e antes de "Minha evolução"
    const evolution = q('section[aria-label="Minha evolução"]')!;
    expect(homeRow!.compareDocumentPosition(evolution) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(q('[data-testid="geo-checkin-home-card"]')).toBeNull();
    expect(qa('[data-testid="daily-checkin-home-row"]')).toHaveLength(1);
    cleanup();

    prepare();
    mockApi({ routes: { "GET /ranking/me/daily-checkin": () => ({ ...DAILY, checkedInToday: true }), "/passport/me": () => json(404, {}) } });
    await mount(<HomePage />);
    expect(row()).toBeNull();
  });

  it("Home sem aluno ligado não chama o check-in diário", async () => {
    mockApi({ students: [], routes: { "/passport/me": () => json(404, {}) } });
    await mount(<HomePage />);
    expect(row()).toBeNull();
    expect(callsTo("/ranking/me/daily-checkin")).toHaveLength(0);
  });
});
