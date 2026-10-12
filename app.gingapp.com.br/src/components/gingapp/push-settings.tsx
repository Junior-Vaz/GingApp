import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BellRing, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { errorMessage, api } from "@/lib/api";
import {
  PUSH_CATEGORIES,
  PushPermissionDeniedError,
  disablePush,
  enablePush,
  getBrowserSubscription,
  isPushSupported,
  needsIosInstall,
  registerSubscription,
  usePushConfig,
  usePushPreferences,
  type PushCategory,
  type PushPreferences,
} from "@/lib/push";

/**
 * Avisos no celular (Web Push). Só aparece quando o servidor tem push ligado (GET /push/config -> enabled) e o
 * aparelho suporta (ou, no iPhone, mostra a dica de instalar o app na tela inicial). Notificação in-app continua
 * sempre existindo: as preferências aqui só controlam o push.
 */
export function PushSettings() {
  const config = usePushConfig();
  const enabled = config.data?.enabled === true;
  const iosInstall = enabled && needsIosInstall();
  const supported = enabled && !iosInstall && isPushSupported();

  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [checked, setChecked] = useState(false);
  const [denied, setDenied] = useState(false);
  const queryClient = useQueryClient();

  // Estado real do aparelho. Se já há inscrição, regrava (idempotente) para o usuário logado ser o dono dela.
  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    void (async () => {
      const current = await getBrowserSubscription();
      if (cancelled) return;
      setSubscription(current);
      setDenied(typeof Notification !== "undefined" && Notification.permission === "denied");
      setChecked(true);
      if (current && Notification.permission === "granted") await registerSubscription(current).catch(() => undefined);
    })();
    return () => {
      cancelled = true;
    };
  }, [supported]);

  const preferences = usePushPreferences(supported && subscription !== null);

  const activate = useMutation({
    mutationFn: () => enablePush(config.data!.publicKey!),
    onSuccess: async (created) => {
      setSubscription(created);
      setDenied(false);
      await queryClient.invalidateQueries({ queryKey: ["push-preferences"] });
      toast.success("Avisos no celular ativados.");
    },
    onError: (error) => {
      if (error instanceof PushPermissionDeniedError) {
        setDenied(typeof Notification !== "undefined" && Notification.permission === "denied");
        toast.error("Você não permitiu as notificações. Libere nas configurações do navegador para ativar.");
        return;
      }
      toast.error(errorMessage(error, "Não foi possível ativar os avisos agora."));
    },
  });

  const deactivate = useMutation({
    mutationFn: () => disablePush(subscription!),
    onSuccess: () => {
      setSubscription(null);
      toast.success("Avisos no celular desativados.");
    },
    onError: (error) => toast.error(errorMessage(error, "Não foi possível desativar os avisos.")),
  });

  const update = useMutation({
    mutationFn: (patch: Partial<PushPreferences>) => api.put<PushPreferences>("/push/preferences", patch),
    onSuccess: (data) => queryClient.setQueryData(["push-preferences"], data),
    onError: (error) => toast.error(errorMessage(error, "Não foi possível salvar a preferência.")),
  });

  if (!enabled) return null;

  if (iosInstall) {
    return (
      <section className="notice-list" aria-label="Avisos no celular" data-testid="push-ios-tip">
        <div className="notice-item">
          <div className="notice-meta">
            <Smartphone size={15} />
            <span>Avisos no celular</span>
          </div>
          <p>
            No iPhone e no iPad, os avisos só funcionam com o GingApp instalado: toque em Compartilhar e depois em
            &quot;Adicionar à Tela de Início&quot;, abra o app pelo ícone e volte aqui para ativar.
          </p>
        </div>
      </section>
    );
  }

  if (!supported) return null;

  const active = subscription !== null;
  const prefs = preferences.data;

  return (
    <section className="notice-list" aria-label="Avisos no celular" data-testid="push-settings">
      <div className="notice-item">
        <div className="notice-meta">
          <BellRing size={15} />
          <span>Avisos no celular</span>
        </div>
        <p>
          {active
            ? "Este aparelho recebe avisos do GingApp mesmo com o app fechado."
            : "Receba aulas canceladas, cobranças e recados do grupo direto no celular, mesmo com o app fechado."}
        </p>
        {denied && !active && (
          <p className="text-destructive" role="alert">
            As notificações estão bloqueadas neste navegador. Libere nas configurações do site para ativar.
          </p>
        )}
        <div className="mt-3">
          {active ? (
            <Button variant="outline" size="sm" disabled={deactivate.isPending} onClick={() => deactivate.mutate()}>
              Desativar avisos neste aparelho
            </Button>
          ) : (
            <Button size="sm" disabled={!checked || activate.isPending || denied} onClick={() => activate.mutate()}>
              <BellRing />
              Ativar avisos no celular
            </Button>
          )}
        </div>
      </div>
      {active && (
        <div className="notice-item" data-testid="push-preferences">
          <h3>O que você quer receber</h3>
          {PUSH_CATEGORIES.map(({ key, label, hint }) => (
            <div className="flex items-center justify-between gap-4 py-2" key={key}>
              <label htmlFor={`push-pref-${key}`} className="flex-1 cursor-pointer">
                <span className="block text-xs font-semibold">{label}</span>
                <span className="block text-[10px] text-muted-foreground">{hint}</span>
              </label>
              <Switch
                id={`push-pref-${key}`}
                checked={prefs?.[key as PushCategory] ?? true}
                disabled={!prefs || update.isPending}
                onCheckedChange={(value) => update.mutate({ [key]: value })}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
