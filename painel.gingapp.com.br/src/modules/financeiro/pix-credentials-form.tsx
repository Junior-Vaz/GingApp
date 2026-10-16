import { useId, useState, type FormEvent } from "react";
import { ChevronDown, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { PasswordInput } from "@/components/painel/password-input";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSaveMercadoPagoCredentials } from "./pix-api";
import { MP_TWO_FACTOR_CODES, accessTokenProblem, buildCredentialsPayload, mpCredentialsErrorMessage, pixErrorCode } from "./pix";

/**
 * Formulário em que o Mestre cola as credenciais da PRÓPRIA conta Mercado Pago.
 * - "connect": primeira conexão (ou reconexão após REVOKED/ERROR): token + chave pública + segredo do webhook.
 * - "update": "Trocar token": token novo + chave pública (pré-preenchida; esvaziar = remover). O segredo do webhook tem
 *   seção própria no cartão.
 * Definir/trocar o token exige a SENHA atual do Mestre (e o código do 2FA, se ativo): quem roubar a sessão não troca a
 * conta que recebe o dinheiro. Token, senha e código só vivem neste estado local: são apagados ao salvar com sucesso e
 * nunca são ecoados em mensagens.
 */
export function PixCredentialsForm({
  mode,
  initialPublicKey = null,
  onDone,
  onCancel,
}: {
  mode: "connect" | "update";
  initialPublicKey?: string | null;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const uid = useId();
  const save = useSaveMercadoPagoCredentials();
  const update = mode === "update";
  const [accessToken, setAccessToken] = useState("");
  const [publicKey, setPublicKey] = useState(update ? (initialPublicKey ?? "") : "");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tokenProblem = accessTokenProblem(accessToken);
  const canSubmit =
    accessToken.trim() !== "" &&
    tokenProblem === null &&
    currentPassword !== "" &&
    (!needsCode || twoFactorCode.trim() !== "") &&
    !save.isPending;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setError(null);
    try {
      await save.mutateAsync(
        buildCredentialsPayload(
          { accessToken, publicKey, currentPassword, twoFactorCode, ...(update ? {} : { webhookSecret }) },
          { initialPublicKey: update ? initialPublicKey : null },
        ),
      );
    } catch (err) {
      const code = pixErrorCode(err);
      if (code && MP_TWO_FACTOR_CODES.includes(code)) setNeedsCode(true);
      if (code === "INVALID_PASSWORD") setCurrentPassword("");
      if (code === "INVALID_TWO_FACTOR_CODE") setTwoFactorCode("");
      setError(mpCredentialsErrorMessage(err));
      return;
    }
    // Sucesso: nada do que foi digitado fica em memória.
    setAccessToken("");
    setPublicKey("");
    setWebhookSecret("");
    setCurrentPassword("");
    setTwoFactorCode("");
    setNeedsCode(false);
    save.reset();
    toast.success(update ? "Token do Mercado Pago atualizado" : "Mercado Pago conectado");
    onDone?.();
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="grid gap-4" data-testid="pix-credentials-form" noValidate>
      {!update && (
        <p className="text-sm text-muted-foreground">
          O dinheiro das mensalidades cai direto na sua conta Mercado Pago. O GingApp não recebe nem repassa dinheiro. Quando
          o aluno paga o Pix, o GingApp dá a baixa automaticamente.
        </p>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor={`${uid}-token`}>{update ? "Novo Access Token de produção" : "Access Token de produção"}</Label>
        <PasswordInput
          id={`${uid}-token`}
          toggleLabel="token"
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="none"
          value={accessToken}
          onChange={(event) => setAccessToken(event.target.value)}
          aria-invalid={tokenProblem !== null}
          aria-describedby={tokenProblem ? `${uid}-token-error` : undefined}
        />
        {tokenProblem && (
          <p id={`${uid}-token-error`} className="text-xs text-destructive">
            {tokenProblem}
          </p>
        )}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`${uid}-public`}>Chave pública (opcional)</Label>
        <Input
          id={`${uid}-public`}
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="none"
          value={publicKey}
          onChange={(event) => setPublicKey(event.target.value)}
        />
        {update && initialPublicKey && (
          <p className="text-xs text-muted-foreground">Apague o campo para remover a chave pública salva.</p>
        )}
      </div>

      {!update && (
        <div className="grid gap-1.5">
          <Label htmlFor={`${uid}-secret`}>Segredo do webhook (opcional)</Label>
          <PasswordInput
            id={`${uid}-secret`}
            toggleLabel="segredo do webhook"
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="none"
            value={webhookSecret}
            onChange={(event) => setWebhookSecret(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Só aumenta a verificação dos avisos de pagamento. Sem ele (ou se não conferir), o Pix é confirmado pela consulta
            ao Mercado Pago do mesmo jeito.
          </p>
        </div>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor={`${uid}-password`}>Sua senha (para confirmar)</Label>
        <PasswordInput
          id={`${uid}-password`}
          toggleLabel="senha"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">A mesma senha que você usa para entrar no painel. Todos os Mestres do grupo são avisados.</p>
      </div>

      {needsCode && (
        <div className="grid gap-1.5">
          <Label htmlFor={`${uid}-code`}>Código do aplicativo autenticador</Label>
          <Input
            id={`${uid}-code`}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            value={twoFactorCode}
            onChange={(event) => setTwoFactorCode(event.target.value)}
          />
        </div>
      )}

      <Collapsible className="rounded-md border bg-muted/30">
        <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium">
          Onde encontro o Access Token?
          <ChevronDown className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
        </CollapsibleTrigger>
        <CollapsibleContent className="grid gap-2 px-3 pb-3 text-sm text-muted-foreground">
          <ol className="grid list-decimal gap-1 pl-5">
            <li>
              Acesse o painel de desenvolvedores do Mercado Pago (
              <a
                href="https://www.mercadopago.com.br/developers"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                mercadopago.com.br/developers
              </a>
              ) com a conta que vai receber as mensalidades.
            </li>
            <li>Crie uma aplicação (ou abra uma que você já tenha).</li>
            <li>Nas credenciais de PRODUÇÃO da aplicação, copie o Access Token e cole no campo acima.</li>
            <li>Se quiser, copie também a chave pública e o segredo do webhook da mesma aplicação.</li>
          </ol>
          <p className="text-xs">Confira no painel do Mercado Pago: os nomes e a posição das opções podem mudar.</p>
        </CollapsibleContent>
      </Collapsible>

      <p className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        Não compartilhe esse token. Ele permite criar cobranças na sua conta.
      </p>

      {error && (
        <p role="alert" data-testid="pix-credentials-error" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!canSubmit}>
          {save.isPending && <Loader2 className="animate-spin" />} {update ? "Salvar novo token" : "Salvar e conectar"}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={save.isPending}>
            Cancelar
          </Button>
        )}
      </div>
    </form>
  );
}
