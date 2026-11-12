import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * Mini kit de testes de DOM (render, screen, fireEvent, waitFor) só com react-dom + act: o `app` não tem
 * `@testing-library/dom`, e o mesmo teste precisa rodar nos DOIS projetos. Segue a semântica do Testing Library
 * (consulta por role/nome acessível ignora subárvores `aria-hidden`, como faz o Radix nos irmãos do diálogo aberto).
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Matcher = string | RegExp;

const mounted: Array<{ root: Root; container: HTMLElement; alive: boolean }> = [];

export { act };

export function render(ui: ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const entry = { root, container, alive: true };
  mounted.push(entry);
  act(() => root.render(ui));
  return {
    container,
    rerender: (next: ReactElement) => act(() => root.render(next)),
    unmount: () => {
      if (!entry.alive) return;
      entry.alive = false;
      act(() => root.unmount());
    },
  };
}

export function cleanup() {
  for (const entry of mounted.splice(0)) {
    if (entry.alive) act(() => entry.root.unmount());
    entry.alive = false;
    entry.container.remove();
  }
  document.body.innerHTML = "";
  document.body.removeAttribute("style");
  document.body.removeAttribute("data-scroll-locked");
}

const normalize = (text: string | null | undefined): string =>
  (text ?? "").replace(/\s+/g, " ").trim();
const matches = (value: string, matcher: Matcher): boolean =>
  typeof matcher === "string" ? value === matcher : matcher.test(value);

function isInaccessible(el: Element): boolean {
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (node.getAttribute("aria-hidden") === "true" || node.hasAttribute("hidden")) return true;
    if ((node as HTMLElement).style?.display === "none") return true;
  }
  return false;
}

function roleOf(el: Element): string | null {
  const explicit = el.getAttribute("role");
  if (explicit) return explicit;
  const tag = el.tagName.toLowerCase();
  if (tag === "button") return "button";
  if (tag === "input") {
    const type = (el as HTMLInputElement).type;
    if (type === "range") return "slider";
    if (type === "button" || type === "submit") return "button";
  }
  if (tag === "img" && el.getAttribute("alt")) return "img";
  if (/^h[1-6]$/.test(tag)) return "heading";
  return null;
}

function textFor(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof Element)) return "";
  if (node.getAttribute("aria-hidden") === "true") return "";
  const label = node.tagName.toLowerCase() === "img" ? node.getAttribute("alt") : null;
  if (label) return label;
  return Array.from(node.childNodes).map(textFor).join("");
}

function nameOf(el: Element): string {
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id))
      .filter((node): node is HTMLElement => node !== null)
      .map((node) => normalize(textFor(node)))
      .join(" ");
    if (text) return text;
  }
  const aria = el.getAttribute("aria-label");
  if (aria) return normalize(aria);
  return normalize(textFor(el));
}

function createQueries(root: () => ParentNode) {
  const byRole = (role: string, options: { name?: Matcher } = {}): HTMLElement[] =>
    Array.from(root().querySelectorAll<HTMLElement>("*")).filter(
      (el) =>
        roleOf(el) === role &&
        !isInaccessible(el) &&
        (options.name === undefined || matches(nameOf(el), options.name)),
    );
  const byTestId = (id: string): HTMLElement[] =>
    Array.from(root().querySelectorAll<HTMLElement>(`[data-testid="${id}"]`));
  const byText = (matcher: Matcher): HTMLElement[] =>
    Array.from(root().querySelectorAll<HTMLElement>("*")).filter((el) => {
      if (["SCRIPT", "STYLE"].includes(el.tagName) || isInaccessible(el)) return false;
      const own = normalize(
        Array.from(el.childNodes)
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent)
          .join(""),
      );
      return own !== "" && matches(own, matcher);
    });
  const byAlt = (matcher: Matcher): HTMLElement[] =>
    Array.from(root().querySelectorAll<HTMLElement>("[alt]")).filter((el) =>
      matches(el.getAttribute("alt") ?? "", matcher),
    );
  const byLabel = (matcher: Matcher): HTMLElement[] =>
    Array.from(root().querySelectorAll<HTMLElement>("[aria-label]")).filter((el) =>
      matches(el.getAttribute("aria-label") ?? "", matcher),
    );

  const one = (list: HTMLElement[], what: string): HTMLElement => {
    if (list.length === 0) throw new Error(`Não encontrei ${what}`);
    if (list.length > 1) throw new Error(`Encontrei ${list.length} elementos para ${what}`);
    return list[0] as HTMLElement;
  };
  const maybe = (list: HTMLElement[], what: string): HTMLElement | null => {
    if (list.length > 1) throw new Error(`Encontrei ${list.length} elementos para ${what}`);
    return list[0] ?? null;
  };

  return {
    getByTestId: (id: string) => one(byTestId(id), `data-testid=${id}`),
    queryByTestId: (id: string) => maybe(byTestId(id), `data-testid=${id}`),
    getByRole: (role: string, options?: { name?: Matcher }) =>
      one(byRole(role, options), `role=${role} name=${String(options?.name)}`),
    queryByRole: (role: string, options?: { name?: Matcher }) =>
      maybe(byRole(role, options), `role=${role} name=${String(options?.name)}`),
    getByText: (matcher: Matcher) => one(byText(matcher), `texto ${String(matcher)}`),
    queryByText: (matcher: Matcher) => maybe(byText(matcher), `texto ${String(matcher)}`),
    getByAltText: (matcher: Matcher) => one(byAlt(matcher), `alt ${String(matcher)}`),
    queryByAltText: (matcher: Matcher) => maybe(byAlt(matcher), `alt ${String(matcher)}`),
    getByLabelText: (matcher: Matcher) => one(byLabel(matcher), `aria-label ${String(matcher)}`),
  };
}

export async function waitFor<T>(assertion: () => T, timeout = 2500): Promise<T> {
  const start = Date.now();
  let last: unknown;
  for (;;) {
    try {
      return assertion();
    } catch (error) {
      last = error;
    }
    if (Date.now() - start > timeout) throw last;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
    });
  }
}

const base = createQueries(() => document.body);

export const screen = {
  ...base,
  findByTestId: (id: string) => waitFor(() => base.getByTestId(id)),
  findByRole: (role: string, options?: { name?: Matcher }) =>
    waitFor(() => base.getByRole(role, options)),
  findByAltText: (matcher: Matcher) => waitFor(() => base.getByAltText(matcher)),
};

export function within(scope: HTMLElement) {
  return createQueries(() => scope);
}

function dispatch(target: Element | Document, event: Event) {
  act(() => {
    target.dispatchEvent(event);
  });
}

interface KeyInit {
  key: string;
  shiftKey?: boolean;
}
interface PointerInit {
  pointerId?: number;
  clientX?: number;
  clientY?: number;
}

const mouse = (type: string, init: PointerInit = {}): Event => {
  const Ctor =
    ((window as unknown as Record<string, unknown>)["PointerEvent"] as
      typeof MouseEvent | undefined) ?? MouseEvent;
  return new Ctor(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
    ...(init.pointerId === undefined ? {} : { pointerId: init.pointerId }),
  } as MouseEventInit);
};

export const fireEvent = {
  click: (el: Element) =>
    dispatch(el, new MouseEvent("click", { bubbles: true, cancelable: true })),
  /** `change` de <input type=file> (com `files`) ou de <input type=range> (com `value`). */
  change: (el: Element, init: { target: { files?: File[]; value?: string } }) => {
    const input = el as HTMLInputElement;
    if (init.target.files)
      Object.defineProperty(input, "files", { configurable: true, value: init.target.files });
    if (init.target.value !== undefined) {
      // React rastreia o valor: usa o setter nativo para o onChange disparar.
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, init.target.value);
    }
    dispatch(el, new Event(init.target.files ? "change" : "input", { bubbles: true }));
  },
  keyDown: (el: Element, init: KeyInit) =>
    dispatch(
      el,
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: init.key,
        shiftKey: init.shiftKey ?? false,
      }),
    ),
  load: (el: Element) => dispatch(el, new Event("load")),
  error: (el: Element) => dispatch(el, new Event("error")),
  loadedMetadata: (el: Element) => dispatch(el, new Event("loadedmetadata")),
  pointerDown: (el: Element, init: PointerInit) => dispatch(el, mouse("pointerdown", init)),
  pointerMove: (el: Element, init: PointerInit) => dispatch(el, mouse("pointermove", init)),
  pointerUp: (el: Element, init: PointerInit) => dispatch(el, mouse("pointerup", init)),
  visibilityChange: () => dispatch(document, new Event("visibilitychange")),
};
