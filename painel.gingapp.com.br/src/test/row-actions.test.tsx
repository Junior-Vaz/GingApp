import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Pencil, Trash2, KeyRound } from "lucide-react";
import { z } from "zod";
import { FormDialog } from "@/components/painel/form-dialog";
import { RowActions } from "@/components/painel/row-actions";
import { clickMenuAction, expectMenuAction } from "./row-menu";

afterEach(() => cleanup());

describe("RowActions (coluna Ações compacta)", () => {
  const make = (onEdit = vi.fn(), onDelete = vi.fn()) =>
    render(
      <RowActions
        subject="Ana"
        actions={[
          { key: "edit", label: "Editar", icon: Pencil, primary: true, onSelect: onEdit },
          { key: "pw", label: "Redefinir senha", ariaLabel: "Redefinir senha de Ana", icon: KeyRound, onSelect: vi.fn() },
          false,
          { key: "del", label: "Inativar", icon: Trash2, destructive: true, onSelect: onDelete },
        ]}
      />,
    );

  it("principais viram botões de ícone (title + aria-label) numa linha só; o resto vai para o menu '⋯'", async () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const { container } = make(onEdit, onDelete);
    expect(container.firstElementChild).toHaveClass("flex-nowrap");
    const edit = screen.getByRole("button", { name: "Editar" });
    expect(edit).toHaveAttribute("title", "Editar");
    expect(edit.textContent).toBe(""); // só o ícone
    fireEvent.click(edit);
    expect(onEdit).toHaveBeenCalledTimes(1);
    // nenhuma ação sumiu: as secundárias estão no menu
    expect(screen.queryByRole("button", { name: "Inativar" })).toBeNull();
    await expectMenuAction("Redefinir senha de Ana");
    await clickMenuAction("Inativar");
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("sem ações secundárias não há menu '⋯'", () => {
    render(<RowActions actions={[{ key: "edit", label: "Editar", icon: Pencil, primary: true, onSelect: vi.fn() }]} />);
    expect(screen.queryByRole("button", { name: /Mais ações/ })).toBeNull();
  });
});

describe("Diálogos", () => {
  it("o botão de fechar usa o rótulo 'Fechar' (pt-BR), no Dialog e no Sheet", () => {
    const dialog = render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>D</DialogTitle>
          <DialogDescription>d</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByRole("button", { name: "Fechar" })).toBeInTheDocument();
    expect(screen.queryByText("Close")).toBeNull();
    dialog.unmount();
    render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>S</SheetTitle>
          <SheetDescription>s</SheetDescription>
        </SheetContent>
      </Sheet>,
    );
    expect(screen.getByRole("button", { name: "Fechar" })).toBeInTheDocument();
    expect(screen.queryByText("Close")).toBeNull();
  });

  it("FormDialog: só o corpo rola; Cancelar/Salvar ficam num rodapé fora da área de rolagem", () => {
    const schema = z.object({ name: z.string() });
    render(
      <FormDialog
        open
        onOpenChange={() => undefined}
        title="Novo nível"
        schema={schema}
        defaultValues={{ name: "" }}
        onSubmit={() => undefined}
      >
        {() => <p data-testid="corpo">Campos</p>}
      </FormDialog>,
    );
    const body = screen.getByTestId("corpo").parentElement!;
    expect(body).toHaveClass("overflow-y-auto");
    const save = screen.getByRole("button", { name: "Salvar" });
    expect(body.contains(save)).toBe(false);
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveClass("overflow-hidden");
  });
});
