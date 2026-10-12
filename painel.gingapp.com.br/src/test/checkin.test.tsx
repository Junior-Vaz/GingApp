import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CheckinQrPage } from "@/modules/checkin/checkin-page";
import type { CheckinKind } from "@/modules/checkin/checkin-api";
import { clearSession, loginAs } from "./login-as";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const QR = "data:image/png;base64,iVBORw0KGgo=";
const EVENT_TOKEN = {
  kind: "EVENT", id: 7, title: "Batizado 2026", date: "2026-11-20T22:00:00.000Z",
  token: "K7P4QX", qrDataUrl: QR, opensAt: "2026-11-20T20:00:00.000Z", closesAt: "2026-11-21T04:00:00.000Z",
};
const LESSON_TOKEN = {
  kind: "LESSON", id: 5, title: "Turma Infantil", date: "2026-10-12T00:00:00.000Z", startTime: "19:00", endTime: "20:00",
  token: "Z9M2LA", qrDataUrl: QR, opensAt: "2026-10-12T21:00:00.000Z", closesAt: "2026-10-13T05:00:00.000Z",
};

let paths: string[];
let overrides: Record<string, () => Response>;

function renderQr(kind: CheckinKind, id: number) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CheckinQrPage kind={kind} id={id} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  loginAs("MESTRE");
  paths = [];
  overrides = {};
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string) => {
      const path = input.replace(/^https?:\/\/[^/]+\/api/, "");
      paths.push(path);
      const override = overrides[path];
      if (override) return Promise.resolve(override());
      if (path === "/events/7/checkin-token") return Promise.resolve(json(200, EVENT_TOKEN));
      if (path === "/attendance/lessons/5/checkin-token") return Promise.resolve(json(200, LESSON_TOKEN));
      return Promise.resolve(json(404, { message: "Rota não mockada." }));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearSession();
});

describe("CheckinQrPage", () => {
  it("evento: chama /events/:id/checkin-token e mostra título, QR, código curto e janela", async () => {
    renderQr("evento", 7);
    expect(screen.getByTestId("checkin-loading")).toBeInTheDocument();
    expect(await screen.findByTestId("checkin-title")).toHaveTextContent("Batizado 2026");
    expect(paths).toEqual(["/events/7/checkin-token"]);
    expect(screen.getByAltText("QR Code de check-in")).toHaveAttribute("src", QR);
    expect(screen.getByTestId("checkin-code")).toHaveTextContent("K7P4QX");
    expect(screen.getByTestId("checkin-when")).toHaveTextContent("20/11/2026");
    expect(screen.getByTestId("checkin-window")).toHaveTextContent(/Check-in aberto de 20\/11\/2026 \d{2}:\d{2} até 2\d\/11\/2026 \d{2}:\d{2}/);
  });

  it("aula: chama /attendance/lessons/:id/checkin-token e mostra turma, dia e horário; Imprimir chama window.print", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    renderQr("aula", 5);
    expect(await screen.findByTestId("checkin-title")).toHaveTextContent("Turma Infantil");
    expect(paths).toEqual(["/attendance/lessons/5/checkin-token"]);
    expect(screen.getByTestId("checkin-when")).toHaveTextContent("12/10/2026 · 19:00 às 20:00");
    expect(screen.getByTestId("checkin-code")).toHaveTextContent("Z9M2LA");
    fireEvent.click(screen.getByRole("button", { name: /Imprimir/ }));
    expect(print).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /Tela cheia/ })).toBeInTheDocument();
  });

  it("erro do backend mostra a mensagem e permite tentar de novo", async () => {
    overrides["/events/7/checkin-token"] = () => json(403, { message: "Sem permissão para gerar o QR." });
    renderQr("evento", 7);
    expect(await screen.findByText("Sem permissão para gerar o QR.")).toBeInTheDocument();
    delete overrides["/events/7/checkin-token"];
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await waitFor(() => expect(screen.getByTestId("checkin-code")).toHaveTextContent("K7P4QX"));
  });
});
