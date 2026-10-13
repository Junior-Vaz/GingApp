import { useEffect, useState } from "react";
import { Download, RefreshCw, Share, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { applyUpdate, isIosDevice, isStandalone, promptInstall, usePwaState } from "@/lib/pwa";

/** Aviso fixo "Nova versão disponível — Atualizar" (o service worker novo espera até o usuário aceitar). */
export function UpdatePrompt() {
  const { needRefresh } = usePwaState();
  const [busy, setBusy] = useState(false);
  if (!needRefresh) return null;
  return (
    <div
      role="status"
      data-testid="update-prompt"
      className="fixed inset-x-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-50 flex items-center gap-3 rounded-lg border bg-card p-3 shadow-lg md:inset-x-auto md:bottom-4 md:right-4 md:w-96"
    >
      <RefreshCw className="size-5 shrink-0 text-primary" aria-hidden />
      <p className="min-w-0 flex-1 text-sm font-medium">Nova versão disponível</p>
      <Button
        size="sm"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void applyUpdate().finally(() => setBusy(false));
        }}
      >
        Atualizar
      </Button>
    </div>
  );
}

/**
 * "Instalar app": no Chrome/Edge/Android usa o convite nativo (beforeinstallprompt); no iPhone/iPad o Safari não tem
 * convite, então mostra a dica "Adicionar à Tela de Início". Não aparece com o app já instalado (standalone).
 */
export function InstallAppButton({ className }: { className?: string }) {
  const { canInstall } = usePwaState();
  const [showHint, setShowHint] = useState(false);
  if (isStandalone()) return null;
  const ios = isIosDevice();
  if (!canInstall && !ios) return null;
  return (
    <div className={className} data-testid="install-app">
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          if (canInstall) void promptInstall();
          else setShowHint((value) => !value);
        }}
      >
        <Download /> Instalar app
      </Button>
      {!canInstall && ios && showHint && (
        <p role="note" className="mt-2 flex items-start gap-2 rounded-md bg-secondary p-3 text-sm text-primary">
          <Share className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Toque em <strong>Compartilhar</strong> e depois em <strong>Adicionar à Tela de Início</strong>.
          </span>
        </p>
      )}
    </div>
  );
}

/** Faixa "Sem conexão": o shell abre offline (precache), mas os dados vêm da API e não são guardados. */
export function OfflineBanner() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  if (online) return null;
  return (
    <div
      role="alert"
      data-testid="offline-banner"
      className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
    >
      <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>
        <strong>Sem conexão.</strong> Você pode navegar, mas os dados só carregam e salvam quando a internet voltar.
      </p>
    </div>
  );
}
