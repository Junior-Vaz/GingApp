import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect } from "vitest";

/**
 * Ações secundárias das tabelas ficam no menu "⋯" (DropdownMenu do Radix). No jsdom o menu abre por TECLADO (Enter no
 * gatilho); o clique do mouse não dispara o pointerdown que o Radix espera. Procura o item em todos os menus da tela
 * (ou só nos de `scope`, ex.: uma linha) e devolve o primeiro que casa, deixando esse menu aberto; `null` se nenhum casar.
 */
export function queryMenuAction(name: string | RegExp, scope?: HTMLElement): HTMLElement | null {
  const triggers = within(scope ?? document.body).queryAllByRole("button", { name: /^Mais ações/ });
  for (const trigger of triggers) {
    if (trigger.getAttribute("aria-expanded") !== "true") fireEvent.keyDown(trigger, { key: "Enter" });
    const item = screen.queryByRole("menuitem", { name });
    if (item) return item;
    fireEvent.keyDown(trigger, { key: "Enter" }); // fecha e tenta o próximo
  }
  return null;
}

/**
 * Espera a ação existir em algum menu "⋯". A verificação acontece DENTRO do waitFor: devolver o elemento e checar depois
 * não vale, porque o foco que volta aos gatilhos de outras linhas (setTimeout) fecha o menu aberto e solta o item do DOM.
 */
export async function expectMenuAction(name: string | RegExp, scope?: HTMLElement): Promise<void> {
  await waitFor(() => {
    const item = queryMenuAction(name, scope);
    if (!item) throw new Error(`Ação "${String(name)}" não encontrada em nenhum menu "Mais ações".`);
    expect(item).toBeInTheDocument();
  });
}

/**
 * Espera o item aparecer e o CLICA no mesmo instante em que o acha. É preciso ser síncrono: abrir e fechar menus de
 * outras linhas devolve o foco ao gatilho delas num setTimeout, e isso (focus-outside) fecharia o menu que acabamos de abrir.
 */
export async function clickMenuAction(name: string | RegExp, scope?: HTMLElement): Promise<void> {
  await waitFor(() => {
    const item = queryMenuAction(name, scope);
    if (!item) throw new Error(`Ação "${String(name)}" não encontrada em nenhum menu "Mais ações".`);
    fireEvent.click(item);
  });
}
