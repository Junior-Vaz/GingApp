/**
 * Atalhos de teclado do operador no desktop (A/B = vencedor do lado A/B, U = desfazer, I = iniciar). Nunca disparam
 * enquanto a pessoa digita, com modificadores (Ctrl/Alt/Meta), repetindo a tecla ou com um diálogo aberto.
 */
export function shouldIgnoreShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return true;
  const target = event.target;
  if (target instanceof HTMLElement) {
    const tag = target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return true;
  }
  return document.querySelector('[role="dialog"], [role="alertdialog"]') !== null;
}

export type ShortcutKey = "a" | "b" | "u" | "i";

/** A tecla pressionada, quando é um dos atalhos do chaveamento. */
export function shortcutKey(event: KeyboardEvent): ShortcutKey | null {
  const key = event.key.length === 1 ? event.key.toLowerCase() : "";
  return key === "a" || key === "b" || key === "u" || key === "i" ? key : null;
}
