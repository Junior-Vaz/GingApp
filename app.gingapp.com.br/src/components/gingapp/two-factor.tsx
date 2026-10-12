import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Check, Copy, ShieldCheck, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  ME_QUERY_KEY,
  TOTP_CODE_LENGTH,
  cleanTotpCode,
  disableTwoFactor,
  enableTwoFactor,
  isQrDataUrl,
  setupTwoFactor,
  twoFactorErrorMessage,
  useTwoFactorStatus,
  type DisableProof,
  type TwoFactorSetup,
} from "@/lib/two-factor";
import { PasswordField } from "./change-password";

function ErrorLine({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p className="mt-3 flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive" role="alert">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </p>
  );
}

function CodeField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input
        className="profile-input"
        id={id}
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="000000"
        maxLength={TOTP_CODE_LENGTH}
        value={value}
        onChange={(event) => onChange(cleanTotpCode(event.target.value))}
      />
    </div>
  );
}

/** Passo 2 da ativação: QR + segredo + confirmação com o primeiro código do app autenticador. */
function SetupPanel({ setup, onCancel, onEnabled }: { setup: TwoFactorSetup; onCancel: () => void; onEnabled: (codes: string[]) => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const enable = useMutation({
    mutationFn: () => enableTwoFactor(code),
    onSuccess: onEnabled,
    onError: (err) => setError(twoFactorErrorMessage(err, "Não foi possível ativar. Confira o código e tente novamente.")),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (code.length !== TOTP_CODE_LENGTH) {
      setError(`Informe o código de ${TOTP_CODE_LENGTH} dígitos.`);
      return;
    }
    enable.mutate();
  }

  return (
    <form onSubmit={submit} noValidate>
      <p className="text-sm">
        1. No aplicativo autenticador (Google Authenticator, Microsoft Authenticator, Authy…), escaneie o QR Code ou digite o segredo.
      </p>
      {isQrDataUrl(setup.qrCodeDataUrl) && (
        <img src={setup.qrCodeDataUrl} alt="QR Code para o aplicativo autenticador" className="mx-auto my-3 h-44 w-44 rounded-md bg-white p-2" />
      )}
      <p className="text-xs text-muted-foreground">Sem câmera? Digite este segredo no aplicativo:</p>
      <code className="mt-1 block break-all rounded-md bg-muted px-3 py-2 text-sm" data-testid="two-factor-secret">
        {setup.secret}
      </code>
      <p className="mt-4 text-sm">2. Digite o código de {TOTP_CODE_LENGTH} dígitos que o aplicativo mostra.</p>
      <CodeField id="twoFactorEnableCode" label={`Código de ${TOTP_CODE_LENGTH} dígitos`} value={code} onChange={setCode} />
      <ErrorLine message={error} />
      <div className="mt-4 flex gap-2">
        <Button type="submit" disabled={enable.isPending}>
          <Check />
          {enable.isPending ? "Ativando…" : "Confirmar e ativar"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={enable.isPending}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

/** Códigos de recuperação: mostrados UMA vez (o servidor só guarda o hash). */
function RecoveryCodesPanel({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      toast.success("Códigos copiados.");
    } catch {
      toast.error("Não foi possível copiar. Anote os códigos manualmente.");
    }
  }

  return (
    <div data-testid="two-factor-recovery-codes">
      <p role="alert" className="rounded-md border border-primary/40 bg-primary/10 p-3 text-sm">
        Guarde agora estes códigos de recuperação. Eles não serão mostrados de novo. Cada um vale uma única vez e serve para entrar se você perder o
        acesso ao aplicativo autenticador.
      </p>
      <ul className="mt-3 grid grid-cols-2 gap-2 font-mono text-sm">
        {codes.map((recoveryCode) => (
          <li key={recoveryCode} className="rounded-md bg-muted px-3 py-2 text-center">
            {recoveryCode}
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => void copy()}>
          <Copy />
          Copiar códigos
        </Button>
        <Button type="button" onClick={onDone}>
          <Check />
          Já guardei os códigos
        </Button>
      </div>
    </div>
  );
}

/** Desativar: exige a senha + um código do aplicativo OU um código de recuperação. */
function DisableForm({ onCancel, onDisabled }: { onCancel: () => void; onDisabled: () => void }) {
  const [password, setPassword] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [error, setError] = useState("");
  const disable = useMutation({
    mutationFn: (proof: DisableProof) => disableTwoFactor(password, proof),
    onSuccess: onDisabled,
    onError: (err) => setError(twoFactorErrorMessage(err, "Não foi possível desativar. Confira a senha e o código.")),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (password === "") return setError("Informe sua senha.");
    if (useRecovery) {
      if (recoveryCode.trim() === "") return setError("Informe o código de recuperação.");
      return disable.mutate({ recoveryCode: recoveryCode.trim() });
    }
    if (code.length !== TOTP_CODE_LENGTH) return setError(`Informe o código de ${TOTP_CODE_LENGTH} dígitos.`);
    disable.mutate({ code });
  }

  return (
    <form onSubmit={submit} noValidate className="mt-3">
      <PasswordField id="twoFactorPassword" label="Senha" autoComplete="current-password" value={password} onChange={setPassword} error={undefined} />
      {useRecovery ? (
        <div>
          <label className="field-label" htmlFor="twoFactorRecoveryCode">
            Código de recuperação
          </label>
          <input
            className="profile-input"
            id="twoFactorRecoveryCode"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="xxxxx-xxxxx"
            value={recoveryCode}
            onChange={(event) => setRecoveryCode(event.target.value)}
          />
        </div>
      ) : (
        <CodeField id="twoFactorDisableCode" label={`Código de ${TOTP_CODE_LENGTH} dígitos`} value={code} onChange={setCode} />
      )}
      <button
        type="button"
        className="mt-2 text-xs text-muted-foreground underline"
        onClick={() => {
          setUseRecovery((current) => !current);
          setError("");
        }}
      >
        {useRecovery ? "Usar código do aplicativo" : "Usar código de recuperação"}
      </button>
      <ErrorLine message={error} />
      <div className="mt-4 flex gap-2">
        <Button type="submit" variant="destructive" disabled={disable.isPending}>
          <ShieldOff />
          {disable.isPending ? "Desativando…" : "Desativar verificação"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={disable.isPending}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

/**
 * "Verificação em duas etapas" do perfil (2FA TOTP opt-in): ativar (QR + código), ver os códigos de recuperação
 * uma única vez e desativar (senha + código). O estado vem de GET /auth/me (twoFactorEnabled).
 */
export function TwoFactorSection() {
  const queryClient = useQueryClient();
  const status = useTwoFactorStatus();
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [setupError, setSetupError] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [disabling, setDisabling] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });

  const start = useMutation({
    mutationFn: setupTwoFactor,
    onSuccess: (data) => {
      setSetupError("");
      setSetup(data);
    },
    onError: (err) => setSetupError(twoFactorErrorMessage(err, "Não foi possível iniciar a ativação.")),
  });

  const enabled = status.data?.twoFactorEnabled === true;

  let body;
  if (recoveryCodes) {
    body = (
      <RecoveryCodesPanel
        codes={recoveryCodes}
        onDone={() => {
          setRecoveryCodes(null);
          void refresh();
        }}
      />
    );
  } else if (status.isLoading) {
    body = <p className="text-xs text-muted-foreground">Carregando…</p>;
  } else if (status.error) {
    body = <ErrorLine message={twoFactorErrorMessage(status.error, "Não foi possível carregar o estado da verificação em duas etapas.")} />;
  } else if (setup) {
    body = (
      <SetupPanel
        setup={setup}
        onCancel={() => setSetup(null)}
        onEnabled={(codes) => {
          setSetup(null);
          setRecoveryCodes(codes);
          toast.success("Verificação em duas etapas ativada.");
          void refresh();
        }}
      />
    );
  } else if (enabled) {
    body = (
      <>
        <p className="flex items-center gap-2 text-sm font-semibold" data-testid="two-factor-enabled">
          <ShieldCheck size={16} aria-hidden />
          Ativada
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Códigos de recuperação restantes: {status.data?.recoveryCodesRemaining ?? 0}
        </p>
        {disabling ? (
          <DisableForm
            onCancel={() => setDisabling(false)}
            onDisabled={() => {
              setDisabling(false);
              toast.success("Verificação em duas etapas desativada.");
              void refresh();
            }}
          />
        ) : (
          <Button variant="outline" className="mt-4" onClick={() => setDisabling(true)}>
            <ShieldOff />
            Desativar
          </Button>
        )}
      </>
    );
  } else {
    body = (
      <>
        <p className="text-xs text-muted-foreground">
          Adicione uma segunda camada de proteção: além da senha, você digita um código do aplicativo autenticador ao entrar.
        </p>
        <ErrorLine message={setupError} />
        <Button variant="outline" className="mt-4" disabled={start.isPending} onClick={() => start.mutate()}>
          <ShieldCheck />
          {start.isPending ? "Preparando…" : "Ativar verificação em duas etapas"}
        </Button>
      </>
    );
  }

  return (
    <section className="content-band mt-6" aria-labelledby="two-factor-title" data-testid="two-factor">
      <h2 id="two-factor-title">Verificação em duas etapas</h2>
      {body}
    </section>
  );
}
