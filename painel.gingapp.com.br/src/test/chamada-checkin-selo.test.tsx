import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clearSession, loginAs } from "./login-as";
import { FrequenciaPage } from "@/modules/frequencia/frequencia-page";
import { QuickAttendance } from "@/modules/frequencia/chamada-rapida";
import { checkinSourceLabel, markAll, setPresence, toRows, type RosterEntry } from "@/modules/frequencia/roster";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

const roster: RosterEntry[] = [
  { studentId: 11, studentName: "Ana", present: true, justification: null, checkinSource: "GEO" },
  { studentId: 12, studentName: "Beto", present: true, justification: null, checkinSource: "QR" },
  { studentId: 13, studentName: "Caio", present: true, justification: null, checkinSource: null },
  { studentId: 14, studentName: "Duda", present: null, justification: null },
];

function stubApi() {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      const path = input.replace(/^.*\/api/, "").split("?")[0]!;
      if (method === "GET" && path === "/lessons")
        return Promise.resolve(
          json(
            200,
            [{ id: 1, classId: 1, unitId: null, teacherUserId: null, date: "2026-03-10T00:00:00.000Z", startTime: "18:00", endTime: "19:00", notes: null, status: "ACTIVE" }],
            { "X-Total-Count": "1" },
          ),
        );
      if (method === "GET" && path === "/classes") return Promise.resolve(json(200, [{ id: 1, name: "Infantil" }], { "X-Total-Count": "1" }));
      if (method === "GET" && path === "/attendance/quick-sessions")
        return Promise.resolve(
          json(200, [{ lessonId: 1, classId: 1, className: "Infantil", classPhoto: null, startTime: "18:00", endTime: "19:00", unitName: "Sede", status: "ONGOING", studentsCount: 4, markedCount: 3 }]),
        );
      if (method === "GET" && path === "/attendance/lessons/1") return Promise.resolve(json(200, roster));
      return Promise.resolve(json(404, { message: `sem rota ${method} ${path}` }));
    }),
  );
}

const wrap = (ui: React.ReactNode) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

beforeEach(() => {
  loginAs("MESTRE");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 2, 10, 18, 30, 0));
  stubApi();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSession();
});

describe("selo de check-in (roster)", () => {
  it("rótulos: GEO = 'Check-in por GPS', QR = 'Check-in por QR', nulo/ausente = nada", () => {
    expect(checkinSourceLabel("GEO")).toBe("Check-in por GPS");
    expect(checkinSourceLabel("QR")).toBe("Check-in por QR");
    expect(checkinSourceLabel(null)).toBeNull();
    expect(checkinSourceLabel(undefined)).toBeNull();
  });

  it("toRows carrega a origem (ausente vira null) e mudar a marcação à mão tira o selo", () => {
    const rows = toRows(roster);
    expect(rows.map((r) => r.checkinSource)).toEqual(["GEO", "QR", null, null]);
    expect(setPresence(rows, 11, true)[0]!.checkinSource).toBe("GEO"); // mesma marcação: mantém
    expect(setPresence(rows, 11, false)[0]!.checkinSource).toBeNull(); // professor mudou: some
    expect(markAll(rows, false).map((r) => r.checkinSource)).toEqual([null, null, null, null]);
    expect(markAll(rows, true, true)[0]!.checkinSource).toBe("GEO"); // quem já tinha decisão não é tocado
  });
});

describe("selo de check-in na tela de Frequência", () => {
  it("mostra 'Check-in por GPS' e 'Check-in por QR' só nas linhas de origem; manual e sem chamada ficam sem selo", async () => {
    wrap(<FrequenciaPage />);
    const select = await screen.findByLabelText("Aula");
    await waitFor(() => expect(within(select).getAllByRole("option").length).toBeGreaterThan(1));
    fireEvent.change(select, { target: { value: "1" } });
    await screen.findByLabelText("Presença de Ana");
    const badges = screen.getAllByTestId("checkin-source");
    expect(badges.map((b) => b.textContent)).toEqual(["Check-in por GPS", "Check-in por QR"]);
    expect(screen.getByText("Ana").closest("td")).toContainElement(badges[0]!);
    expect(screen.getByText("Beto").closest("td")).toContainElement(badges[1]!);
    expect(screen.getByText("Caio").closest("td")).not.toContainElement(badges[0]!);

    // professor muda a marcação da Ana à mão: o selo dela some
    fireEvent.click(screen.getByLabelText("Presença de Ana"));
    await waitFor(() => expect(screen.getAllByTestId("checkin-source")).toHaveLength(1));
    expect(screen.getByTestId("checkin-source")).toHaveTextContent("Check-in por QR");
  });
});

describe("selo de check-in na chamada rápida", () => {
  it("mostra o selo nas linhas de quem fez check-in", async () => {
    wrap(<QuickAttendance />);
    fireEvent.click(await screen.findByRole("button", { name: /Chamada rápida/ }));
    const rows = await screen.findAllByTestId("quick-student-row");
    expect(rows).toHaveLength(4);
    expect(within(rows[0]!).getByTestId("checkin-source")).toHaveTextContent("Check-in por GPS");
    expect(within(rows[1]!).getByTestId("checkin-source")).toHaveTextContent("Check-in por QR");
    expect(within(rows[2]!).queryByTestId("checkin-source")).not.toBeInTheDocument();
    expect(within(rows[3]!).queryByTestId("checkin-source")).not.toBeInTheDocument();
  });
});
