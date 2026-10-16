import { useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Copy, Info, Loader2, QrCode } from "lucide-react";
import { toast } from "sonner";
import { PasswordInput } from "@/components/painel/password-input";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { fmt, toDate } from "@/lib/format";
import { useMercadoPagoActions, useMercadoPagoStatus, useSaveMercadoPagoCredentials } from "./pix-api";
import { PixCredentialsForm } from "./pix-credentials-form";
import { mpCredentialsErrorMessage, type MercadoPagoStatus } from "./pix";

/**
 * "Receber por Pix" (só o MESTRE): o Mestre cola as credenciais da PRÓPRIA conta Mercado Pago (o dinheiro cai direto
 * nela e o webhook do GingApp dá a baixa). A conexão por autorização (OAuth) é opcional e só aparece se o servidor a oferece.
 * Estados: carregando / erro / indisponível neste ambiente / desconectado (formulário) / conectado / revogado ou com erro.
 */
export function PixConnectionCard() {
  const status = useMercadoPagoStatus();
  const { connect, disconnect } = useMercadoPagoActions();
  const [disconnecting, setDisconnecting] = useState(false);
  const [replacingToken, setReplacingToken] = useState(false);
  const data = status.data;

  const shell = (children: ReactNode) => (
    <section aria-labelledby="pix-card-title" data-testid="pix-connection" className="rounded-lg border bg-card p-4 sm:p-6">
      <h2 id="pix-card-title" className="mb-3 flex items-center gap-2 text-base font-semibold">
        <QrCode className="size-5" aria-hidden /> Receber por Pix
      </h2>
      {children}
    </section>
  );

  if (status.isLoading) return shell(<Skeleton className="h-24 w-full" />);

  if (status.error || !data) {
    return shell(
      <div className="grid gap-3">
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(status.error, "Não foi possível carregar a conexão com o Mercado Pago.")}
        </p>
        <div>
          <Button variant="outline" size="sm" onClick={() => void status.refetch()}>
            Tentar de novo
          </Button>
        </div>
      </div>,
    );
  }

  if (!data.available) {
    return shell(
      <p role="status" data-testid="pix-unavailable" className="flex items-start gap-2 rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        Pix automático indisponível neste ambiente.
      </p>,
    );
  }

  /** Link secundário: só quando o servidor oferece o OAuth. */
  const oauthLink = data.oauthAvailable ? (
    <p className="text-xs text-muted-foreground">
      Prefere conectar pelo Mercado Pago?{" "}
      <button
        type="button"
        className="font-medium underline underline-offset-2 hover:text-foreground disabled:opacity-50"
        onClick={() => connect.mutate()}
        disabled={connect.isPending}
      >
        {connect.isPending && <Loader2 className="mr-1 inline size-3 animate-spin" aria-hidden />}
        Conectar por autorização
      </button>
    </p>
  ) : null;

  const disconnectDialog = (
    <ConfirmDialog
      open={disconnecting}
      onOpenChange={setDisconnecting}
      title="Desconectar o Mercado Pago?"
      description="Você deixa de gerar Pix das mensalidades, os Pix em aberto serão cancelados e a baixa automática deixa de funcionar até você conectar de novo."
      confirmLabel="Desconectar"
      onConfirm={() => disconnect.mutateAsync()}
    />
  );

  if (data.status === "REVOKED" || data.status === "ERROR") {
    const isError = data.status === "ERROR";
    return shell(
      <div className="grid gap-4" data-testid="pix-broken">
        <div role="alert" className="grid gap-1 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <p className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            Não foi possível usar sua conta. Cole o token novamente.
          </p>
          {isError && data.lastError && (
            <p data-testid="pix-last-error" className="pl-6 text-xs">
              Motivo: {data.lastError}
            </p>
          )}
        </div>
        <PixCredentialsForm mode="connect" />
        {oauthLink}
        {isError && (
          <div>
            <Button variant="outline" onClick={() => setDisconnecting(true)}>
              Desconectar
            </Button>
          </div>
        )}
        {isError && disconnectDialog}
      </div>,
    );
  }

  if (data.connected) {
    return shell(
      <div className="grid gap-4" data-testid="pix-connected">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
            <CheckCircle2 className="size-3.5" aria-hidden /> Conectado
          </span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
            {data.liveMode ? "Produção" : "Teste"}
          </span>
          {data.mode && (
            <span className="text-xs text-muted-foreground">{data.mode === "OAUTH" ? "por autorização" : "por token"}</span>
          )}
        </div>

        <dl className="grid gap-1.5 text-sm" data-testid="pix-account">
          {data.tokenHint && (
            <DetailRow label="Token" value={`terminado em ••••${data.tokenHint} (só os 4 últimos caracteres, para você reconhecer; não identifica o token)`} />
          )}
          {data.providerUserId && <DetailRow label="Conta" value={data.providerUserId} />}
          {data.connectedAt && <DetailRow label="Conectado" value={`desde ${fmt(toDate(data.connectedAt), "dd/MM/yyyy")}`} />}
          {data.publicKey && <DetailRow label="Chave pública" value={data.publicKey} mono />}
        </dl>

        <p className="text-sm text-muted-foreground">
          Os Pix das mensalidades caem direto na sua conta Mercado Pago e a baixa é automática. Use “Gerar Pix” nos
          lançamentos em aberto.
        </p>

        <WebhookSection data={data} />

        {replacingToken ? (
          <div className="rounded-md border p-3 sm:p-4">
            <PixCredentialsForm
              mode="update"
              initialPublicKey={data.publicKey}
              onDone={() => setReplacingToken(false)}
              onCancel={() => setReplacingToken(false)}
            />
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setReplacingToken(true)}>
              Trocar token
            </Button>
            <Button variant="outline" onClick={() => setDisconnecting(true)}>
              Desconectar
            </Button>
          </div>
        )}

        {disconnectDialog}
      </div>,
    );
  }

  return shell(
    <div className="grid gap-4" data-testid="pix-disconnected">
      <h3 className="text-sm font-semibold">Conectar sua conta Mercado Pago</h3>
      <PixCredentialsForm mode="connect" />
      {oauthLink}
    </div>,
  );
}

function DetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="text-muted-foreground">{label}:</dt>
      <dd className={mono ? "break-all font-mono text-xs leading-5" : "break-all"}>{value}</dd>
    </div>
  );
}

/** URL do webhook (somente leitura + Copiar) e o segredo opcional para validar a assinatura. */
function WebhookSection({ data }: { data: MercadoPagoStatus }) {
  const save = useSaveMercadoPagoCredentials();
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function copyUrl() {
    if (!data.webhookUrl) return;
    try {
      await navigator.clipboard.writeText(data.webhookUrl);
      toast.success("URL do webhook copiada.");
    } catch {
      toast.error("Não foi possível copiar. Selecione o texto e copie manualmente.");
    }
  }

  async function saveSecret(value: string) {
    setError(null);
    try {
      await save.mutateAsync({ webhookSecret: value });
    } catch (err) {
      setError(mpCredentialsErrorMessage(err, "Não foi possível salvar o segredo do webhook. Tente novamente."));
      return;
    }
    setSecret("");
    save.reset();
    toast.success(value === "" ? "Segredo do webhook removido" : "Segredo do webhook salvo");
  }

  const trimmed = secret.trim();
  // Conexão por autorização (OAuth): o webhook é conferido só com o segredo do servidor; não há segredo próprio (B5).
  const ownSecretAllowed = data.mode !== "OAUTH";
  return (
    <div className="grid gap-3 rounded-md border p-3 sm:p-4" data-testid="pix-webhook">
      <h3 className="text-sm font-semibold">Webhook</h3>
      <p className="text-sm text-muted-foreground">
        O GingApp envia a URL abaixo em cada Pix: você não precisa cadastrar nada no Mercado Pago. O segredo do webhook é
        opcional e só aumenta a verificação; se a assinatura não conferir, o Pix ainda é confirmado pela consulta ao Mercado
        Pago.
      </p>

      {data.webhookUrl && (
        <div className="flex gap-2">
          <Input readOnly aria-label="URL do webhook" value={data.webhookUrl} className="font-mono text-xs md:text-xs" onFocus={(event) => event.currentTarget.select()} />
          <Button type="button" variant="outline" onClick={() => void copyUrl()}>
            <Copy /> Copiar
          </Button>
        </div>
      )}

      {ownSecretAllowed && data.hasWebhookSecret && data.webhookSecretReadable === false && (
        <p role="alert" data-testid="pix-webhook-unreadable" className="rounded-md border border-amber-300/60 bg-amber-50 p-2 text-xs text-amber-900">
          O segredo do webhook salvo não pode mais ser lido. Cole o segredo de novo (os Pix continuam sendo confirmados pela
          consulta ao Mercado Pago).
        </p>
      )}

      {ownSecretAllowed && (
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (trimmed && !save.isPending) void saveSecret(trimmed);
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label htmlFor="pix-webhook-secret">Segredo do webhook</Label>
            {data.hasWebhookSecret && (
              <span className="inline-flex items-center gap-2 text-xs">
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700">
                  <CheckCircle2 className="size-3.5" aria-hidden /> Segredo configurado
                </span>
                <Button type="button" variant="ghost" size="sm" disabled={save.isPending} onClick={() => void saveSecret("")}>
                  Remover
                </Button>
              </span>
            )}
          </div>
          <PasswordInput
            id="pix-webhook-secret"
            toggleLabel="segredo do webhook"
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="none"
            placeholder={data.hasWebhookSecret ? "Cole para atualizar o segredo" : "Cole o segredo para definir"}
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div>
            <Button type="submit" variant="outline" size="sm" disabled={!trimmed || save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />} {data.hasWebhookSecret ? "Atualizar segredo" : "Salvar segredo"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
