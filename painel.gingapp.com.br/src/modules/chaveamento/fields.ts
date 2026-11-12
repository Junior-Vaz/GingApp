import type { FocusEvent } from "react";

/** Folga para o teclado virtual abrir (a viewport encolhe) antes de centralizar o campo focado. */
const KEYBOARD_DELAY_MS = 300;

/** Mantém o campo focado visível com o teclado virtual aberto (rola o painel/folha até ele). */
export function scrollFieldIntoView(event: FocusEvent<HTMLElement>): void {
  const el = event.currentTarget;
  window.setTimeout(() => el.scrollIntoView?.({ block: "center", behavior: "smooth" }), KEYBOARD_DELAY_MS);
}

/**
 * Atributos dos campos NUMÉRICOS (placar, semente, tatame, ordem): teclado numérico, tecla "OK" no lugar do "Enter", sem
 * preenchimento automático e o campo sempre visível acima do teclado. A fonte de 16 px (sem zoom do iOS) vem do CSS.
 */
export const numericField = {
  inputMode: "numeric",
  pattern: "[0-9]*",
  enterKeyHint: "done",
  autoComplete: "off",
  onFocus: (event: FocusEvent<HTMLInputElement>) => {
    event.currentTarget.select();
    scrollFieldIntoView(event);
  },
} as const;

/**
 * Rodapé de diálogo que NÃO rola para fora: os botões de confirmar/cancelar ficam sempre à vista, mesmo com o teclado
 * aberto, em 320 px ou no celular deitado (o conteúdo rola por trás), lado a lado para ocupar pouca altura. O `bottom`
 * negativo cancela o padding do DialogContent (1rem no celular + área segura; 1,5rem a partir de `sm`), senão o
 * sticky pararia 1 rem acima da borda e deixaria o conteúdo aparecer por baixo.
 */
export const STICKY_FOOTER =
  "sticky bottom-[calc(-1rem-env(safe-area-inset-bottom))] z-10 -mx-4 -mb-4 flex-row gap-2 border-t bg-background px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 max-sm:[&>*]:flex-1 sm:-bottom-6 sm:-mx-6 sm:-mb-6 sm:px-6 sm:pb-4";

/** Campos de texto livre (nome, grupo, graduação): sem autopreenchimento do navegador, tecla "OK" e sempre visíveis. */
export const textField = {
  autoComplete: "off",
  enterKeyHint: "done",
  onFocus: scrollFieldIntoView,
} as const;

/** Rola o elemento até o centro da faixa (a aba tocada fica à vista). `scrollIntoView` não existe em todo ambiente. */
export function scrollIntoViewCentered(el: Element | null): void {
  el?.scrollIntoView?.({ inline: "center", block: "nearest", behavior: "smooth" });
}
