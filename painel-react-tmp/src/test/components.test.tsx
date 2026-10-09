import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { z } from "zod";
import { DataTable, type Column } from "@/components/painel/data-table";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { FormDialog } from "@/components/painel/form-dialog";
import { StatCard } from "@/components/painel/stat-card";
import { EmConstrucao } from "@/components/painel/em-construcao";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";

interface Row {
  id: number;
  name: string;
  age: number;
}
const rows: Row[] = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, name: `Aluno ${String(i + 1).padStart(2, "0")}`, age: 20 + (i % 7) }));
rows.push({ id: 99, name: "José Álvaro", age: 40 });
const columns: Column<Row>[] = [
  { id: "name", header: "Nome", sortValue: (r) => r.name },
  { id: "age", header: "Idade", sortValue: (r) => r.age },
];
const names = () => screen.getAllByRole("row").slice(1).map((r) => r.textContent ?? "");

describe("DataTable", () => {
  it("pagina no cliente (10 por página)", () => {
    render(<DataTable columns={columns} data={rows} getRowId={(r) => r.id} searchText={(r) => r.name} />);
    expect(names()).toHaveLength(10);
    expect(screen.getByTestId("table-count")).toHaveTextContent("26 registros");
    fireEvent.click(screen.getByLabelText("Próxima página"));
    expect(screen.getByText("Página 2 de 3")).toBeInTheDocument();
    expect(names()[0]).toContain("Aluno 11");
  });

  it("busca ignorando acentos/caixa e mostra vazio sem resultado", () => {
    render(<DataTable columns={columns} data={rows} getRowId={(r) => r.id} searchText={(r) => r.name} />);
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "jose alvaro" } });
    expect(names()).toEqual(["José Álvaro40"]);
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "zzz" } });
    expect(screen.getByTestId("table-empty")).toHaveTextContent("Nenhum resultado");
  });

  it("ordena asc, desc e volta ao original ao clicar no cabeçalho", () => {
    render(<DataTable columns={columns} data={rows} getRowId={(r) => r.id} pageSize={50} />);
    const header = screen.getByRole("button", { name: "Idade" });
    fireEvent.click(header);
    expect(names()[0]).toContain("20");
    fireEvent.click(header);
    expect(names()[0]).toContain("José Álvaro40");
    fireEvent.click(header);
    expect(names()[0]).toContain("Aluno 01");
  });

  it("estados loading, vazio e erro (com retry)", () => {
    const retry = vi.fn();
    const { rerender } = render(<DataTable columns={columns} data={undefined} isLoading getRowId={(r) => r.id} />);
    expect(screen.getAllByTestId("table-loading").length).toBeGreaterThan(0);
    rerender(<DataTable columns={columns} data={[]} getRowId={(r) => r.id} emptyMessage="Sem alunos." />);
    expect(screen.getByTestId("table-empty")).toHaveTextContent("Sem alunos.");
    rerender(<DataTable columns={columns} data={undefined} error={new Error("Falhou")} onRetry={retry} getRowId={(r) => r.id} />);
    expect(screen.getByTestId("table-error")).toHaveTextContent("Falhou");
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe("ConfirmDialog", () => {
  it("só chama onConfirm ao confirmar e fecha quando resolve", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    render(<ConfirmDialog open onOpenChange={onOpenChange} title="Excluir aluno?" description="Não dá para desfazer." confirmLabel="Excluir" onConfirm={onConfirm} />);
    expect(screen.getByText("Excluir aluno?")).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("se onConfirm falha, permanece aberto", async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error("x"));
    const onOpenChange = vi.fn();
    render(<ConfirmDialog open onOpenChange={onOpenChange} title="T" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("button", { name: "Confirmar" })).not.toBeDisabled());
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

describe("FormDialog", () => {
  const schema = z.object({ name: z.string().min(3, "Mínimo 3 letras.") });
  type Values = z.infer<typeof schema>;

  function setup(onSubmit: (v: Values) => void | Promise<unknown>) {
    const onOpenChange = vi.fn();
    render(
      <FormDialog<Values> open onOpenChange={onOpenChange} title="Novo aluno" schema={schema} defaultValues={{ name: "" }} onSubmit={onSubmit}>
        {(form) => (
          <FormField control={form.control} name="name" render={({ field }) => (
            <FormItem>
              <FormLabel>Nome</FormLabel>
              <FormControl><Input {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        )}
      </FormDialog>,
    );
    return onOpenChange;
  }

  it("valida com zod e não envia dados inválidos", async () => {
    const onSubmit = vi.fn();
    setup(onSubmit);
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "ab" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText("Mínimo 3 letras.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("envia valores válidos e fecha", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = setup(onSubmit);
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Ana" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ name: "Ana" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});

describe("StatCard / EmConstrucao", () => {
  it("StatCard mostra label, valor e dica", () => {
    render(<StatCard label="Alunos ativos" value={12} hint="+3 nos últimos 30 dias" />);
    expect(screen.getByText("Alunos ativos")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("+3 nos últimos 30 dias")).toBeInTheDocument();
  });

  it("EmConstrucao usa o título do módulo", () => {
    render(<EmConstrucao title="Turmas" />);
    expect(screen.getByTestId("em-construcao")).toHaveTextContent("Em construção");
    expect(screen.getByRole("heading", { name: "Turmas" })).toBeInTheDocument();
  });
});
