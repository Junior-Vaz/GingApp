import { useEffect, useRef, useSyncExternalStore } from "react";
import { useOptionalSidebar } from "@/components/ui/sidebar";

/**
 * Atividade da página (poupa bateria e dados do operador): a mesa consulta cada categoria em andamento a cada 5 s, mas
 * só enquanto a aba/app está VISÍVEL e o aparelho está ONLINE. Ao voltar ao primeiro plano (ou reconectar) a consulta
 * é refeita na hora, sem esperar o próximo ciclo.
 */

const subscribeVisibility = (notify: () => void): (() => void) => {
  document.addEventListener("visibilitychange", notify);
  window.addEventListener("pageshow", notify);
  return () => {
    document.removeEventListener("visibilitychange", notify);
    window.removeEventListener("pageshow", notify);
  };
};
const isVisible = (): boolean => typeof document === "undefined" || document.visibilityState !== "hidden";

const subscribeOnline = (notify: () => void): (() => void) => {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
};
const isOnline = (): boolean => typeof navigator === "undefined" || navigator.onLine !== false;

/** A aba/app está à frente (não oculta)? */
export function usePageVisible(): boolean {
  return useSyncExternalStore(subscribeVisibility, isVisible, () => true);
}

/** O aparelho está com internet? (`navigator.onLine` + eventos `online`/`offline`) */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, isOnline, () => true);
}

/** `active` = visível E online: só então vale a consulta periódica. */
export function usePageActive(): { active: boolean; visible: boolean; online: boolean } {
  const visible = usePageVisible();
  const online = useOnline();
  return { active: visible && online, visible, online };
}

/** Chama `onResume` na VOLTA a "ativo" (de oculto/offline para visível e online). Não dispara na montagem. */
export function useResumeEffect(active: boolean, onResume: () => void, enabled = true): void {
  const latest = useRef(onResume);
  latest.current = onResume;
  const was = useRef(active);
  useEffect(() => {
    if (enabled && active && !was.current) latest.current();
    was.current = active;
  }, [active, enabled]);
}

/** Abaixo disto, em aparelho de toque, o menu lateral abre recolhido nesta página (largura é do operador, não do menu). */
const COMPACT_SIDEBAR_BELOW_PX = 1100;

/**
 * Tablet e celular deitado (>= 768 px, onde o painel mostra o menu lateral de 256 px): enquanto o operador está no
 * chaveamento o menu fica recolhido (só os ícones), devolvendo ~200 px à mesa e à chave; ao sair da página ele volta
 * como estava. O botão do topo reabre o menu. Mouse/desktop largo e o celular em pé (gaveta) não mudam.
 */
export function useCompactSidebar(): void {
  const sidebar = useOptionalSidebar();
  const latest = useRef(sidebar);
  latest.current = sidebar;
  useEffect(() => {
    const current = latest.current;
    if (!current || current.isMobile || !current.open) return;
    const touch = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
    if (!touch || window.innerWidth >= COMPACT_SIDEBAR_BELOW_PX) return;
    current.setOpen(false);
    return () => latest.current?.setOpen(true);
  }, []);
}
