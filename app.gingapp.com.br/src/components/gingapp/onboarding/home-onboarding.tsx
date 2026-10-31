import { useState } from "react";
import { shouldOfferInstall, useInstall } from "@/lib/install";
import { canOfferPush } from "@/lib/onboarding";
import { SNOOZE_KEYS, useSnooze, type Clock } from "@/lib/snooze";
import { InstallCard } from "./install-card";
import { PushCard } from "./push-card";

/**
 * Convite logo depois do login, na Home: UM cartão por vez, nunca os dois juntos.
 *  1. "Instalar o GingApp" (app fora do modo standalone, com prompt nativo guardado ou em iPhone/iPad, e não dispensado);
 *  2. "Ativar notificações" (servidor com push, navegador com suporte, permissão ainda "default", e não dispensado).
 * Cada "Agora não" grava o instante em localStorage e o cartão só volta depois de 3 dias. Nada é pedido sozinho.
 */
export function HomeOnboarding({ clock }: { clock?: Clock }) {
  const install = useInstall();
  const installSnooze = useSnooze(SNOOZE_KEYS.install, clock);
  // Avaliado só ao montar: depois que o usuário nega a permissão o cartão precisa continuar montado para mostrar a dica.
  const [pushPossible] = useState(canOfferPush);

  if (shouldOfferInstall(install) && !installSnooze.snoozed) {
    return <InstallCard onDismiss={installSnooze.snooze} />;
  }
  // Só monta o cartão de avisos onde ele pode existir (assim aparelhos sem push nem consultam /push/config).
  return pushPossible ? <PushCard clock={clock} /> : null;
}
