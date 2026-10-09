import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StudentPicker } from "@/components/painel/student-picker";
import { UnitPicker } from "@/components/painel/unit-picker";

// Regressão achada no e2e real: Enter na caixa de busca de um seletor, dentro de um <form>,
// submetia o formulário inteiro e gravava o registro SEM aluno/unidade (Financeiro, Turmas...).

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "X-Total-Count": String(Array.isArray(body) ? body.length : 0) } });

function setup(ui: React.ReactElement) {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json([]))));
  const submit = vi.fn((e: React.FormEvent) => e.preventDefault());
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <form onSubmit={submit}>{ui}</form>
    </QueryClientProvider>,
  );
  return submit;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Enter na busca do seletor não submete o formulário", () => {
  it("StudentPicker (modo formulário)", () => {
    setup(<StudentPicker value={null} onChange={() => {}} />);
    const input = screen.getByPlaceholderText("Digite o nome do aluno…");
    // fireEvent devolve false quando o handler chamou preventDefault (cancela o submit implícito)
    expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(false);
  });

  it("StudentPicker (modo filtro)", () => {
    setup(<StudentPicker mode="filter" value={null} onChange={() => {}} />);
    expect(fireEvent.keyDown(screen.getByLabelText("Buscar aluno"), { key: "Enter" })).toBe(false);
  });

  it("UnitPicker (modo formulário)", () => {
    setup(<UnitPicker value={null} onChange={() => {}} />);
    const input = screen.getByPlaceholderText("Digite o nome da unidade…");
    expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(false);
  });

  it("UnitPicker (modo filtro)", () => {
    setup(<UnitPicker mode="filter" value={null} onChange={() => {}} />);
    expect(fireEvent.keyDown(screen.getByLabelText("Buscar unidade"), { key: "Enter" })).toBe(false);
  });

  it("outras teclas continuam livres (digitar não é bloqueado)", () => {
    setup(<StudentPicker value={null} onChange={() => {}} />);
    const input = screen.getByPlaceholderText("Digite o nome do aluno…");
    expect(fireEvent.keyDown(input, { key: "a" })).toBe(true);
    expect(fireEvent.keyDown(input, { key: "ArrowDown" })).toBe(true);
  });
});
