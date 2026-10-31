import { useState, type ReactNode } from "react";
import { useInstall } from "@/lib/install";
import { Button } from "@/components/ui/button";
import { Reveal } from "../reveal";
import { IosInstallGuide } from "./install-guide";

/** Moldura comum dos convites da Home: entra suave (sem "pulo" de layout) e deixa o respiro de baixo DENTRO do Reveal. */
export function OnboardingFrame({ children }: { children: ReactNode }) {
  return (
    <Reveal>
      <div className="pb-4">{children}</div>
    </Reveal>
  );
}

/**
 * Convite "Instalar o GingApp". Android/desktop: UM toque abre o prompt nativo (`beforeinstallprompt` guardado desde o
 * início da página). iPhone/iPad: não há prompt; o toque abre a folha guiada (nunca chama `prompt()`).
 * "Agora não" é decidido por quem usa o cartão (grava a dispensa de 3 dias).
 */
export function InstallCard({ onDismiss }: { onDismiss: () => void }) {
  const { platform, promptInstall } = useInstall();
  const [guideOpen, setGuideOpen] = useState(false);

  async function install() {
    if (platform === "ios") {
      setGuideOpen(true);
      return;
    }
    // O prompt nativo roda de forma síncrona dentro do toque; só o resultado é aguardado.
    const result = await promptInstall();
    // Fechou o prompt do navegador sem instalar: trata como "Agora não" (volta só depois de 3 dias).
    if (result === "dismissed") onDismiss();
  }

  return (
    <OnboardingFrame>
      <section
        aria-label="Instalar o GingApp"
        data-testid="onboarding-install-card"
        className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 shadow-sm sm:flex-row sm:items-center"
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <img
            src="/icon-192.png"
            alt=""
            width={40}
            height={40}
            className="size-10 flex-none rounded-xl border border-border"
          />
          <div className="min-w-0">
            <h2 className="text-sm font-bold leading-tight">Instalar o GingApp</h2>
            <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
              Abra direto da tela inicial, em tela cheia e mais rápido.
            </p>
          </div>
        </div>
        <div className="flex gap-2 sm:flex-none">
          <Button type="button" className="min-h-11 flex-1 sm:flex-none" onClick={() => void install()}>
            Instalar
          </Button>
          <Button type="button" variant="ghost" className="min-h-11 flex-none" onClick={onDismiss}>
            Agora não
          </Button>
        </div>
      </section>
      {platform === "ios" && <IosInstallGuide open={guideOpen} onOpenChange={setGuideOpen} />}
    </OnboardingFrame>
  );
}
