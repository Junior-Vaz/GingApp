import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DataTable, SERVER_LIST_LIMIT, type Column } from "@/components/painel/data-table";
import { verificationUrl, passportUrl } from "@/lib/format";
import { classToCreatePayload, classToPayload, emptyClassForm } from "@/modules/turmas/schema";

// Bugs achados no e2e contra a API real que os testes com fetch mockado nao pegaram.

describe("turmas: POST nao envia status (CreateClassDto nao tem; forbidNonWhitelisted => 400)", () => {
  const values = { ...emptyClassForm, name: "Turma Teste" };

  it("payload de criacao omite status", () => {
    expect(classToCreatePayload(values)).not.toHaveProperty("status");
    expect(classToCreatePayload(values)).toMatchObject({ name: "Turma Teste" });
  });

  it("payload de edicao continua com status", () => {
    expect(classToPayload(values)).toHaveProperty("status", "ACTIVE");
  });
});

describe("QR/links publicos apontam para o app do aluno, nao para a origem do painel", () => {
  it("verificationUrl e passportUrl usam VITE_APP_URL (fallback do app em dev)", () => {
    const origin = window.location.origin;
    expect(verificationUrl("abc")).toBe("http://localhost:4173/verificar/abc");
    expect(passportUrl("xyz")).toBe("http://localhost:4173/verificar-passaporte/xyz");
    expect(verificationUrl("abc").startsWith(origin)).toBe(false);
  });
});

describe("DataTable avisa quando a lista bate no teto do servidor", () => {
  interface Row {
    id: number;
    name: string;
  }
  const columns: Column<Row>[] = [{ id: "name", header: "Nome", cell: (r) => r.name }];
  const make = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `Item ${i + 1}` }));

  it(`mostra aviso com ${SERVER_LIST_LIMIT} registros`, () => {
    render(<DataTable columns={columns} data={make(SERVER_LIST_LIMIT)} getRowId={(r) => r.id} />);
    expect(screen.getByTestId("table-limit-warning")).toBeInTheDocument();
  });

  it("nao mostra aviso abaixo do teto", () => {
    render(<DataTable columns={columns} data={make(SERVER_LIST_LIMIT - 1)} getRowId={(r) => r.id} />);
    expect(screen.queryByTestId("table-limit-warning")).not.toBeInTheDocument();
  });

  it("serverLimit=0 desliga o aviso", () => {
    render(<DataTable columns={columns} data={make(SERVER_LIST_LIMIT)} getRowId={(r) => r.id} serverLimit={0} />);
    expect(screen.queryByTestId("table-limit-warning")).not.toBeInTheDocument();
  });
});
