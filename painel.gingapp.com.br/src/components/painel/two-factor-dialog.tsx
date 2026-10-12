import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { PasswordInput } from "@/components/painel/password-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useSessionUser } from "@/lib/session";
import {
  ME_QUERY_KEY,
  RECOVERY_CODE_PATTERN,
  TWO_FACTOR_CODE_PATTERN,
  disableTwoFactor,
  enableTwoFactor,
  fetchMe,
  setupTwoFactor,
  twoFactorErrorMessage,
  type AuthMe,
  type TwoFactorSetup,
} from "@/lib/two-factor";

function InlineError({ message }: { message: string }) {
  return message ? (
    <p className="text-sm text-destructive" role="alert">
      {message}
    </p>
  ) : null;
}

/** Os 8 códigos de recuperação, mostrados UMA vez (só existem em memória enquanto o diálogo está aberto). */
function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      toast.success("Códigos copiados.");
    } catch {
      toast.error("Não foi possível copiar. Selecione e copie os códigos manualmente.");
    }
  }
  return (
    <div className="grid gap-3" data-testid="recovery-codes">
      <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm font-semibold" role="alert">
        Guarde agora estes códigos de recuperação. Eles não serão mostrados de novo e cada um vale uma única vez, caso
        você perca o acesso ao app autenticador.
      </p>
      <ul className="grid grid-cols-2 gap-2 rounded-md border bg-muted/40 p-3 font-mono text-sm">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => void copy()}>
          <Copy />
          Copiar códigos
        </Button>
        <Button type="button" onClick={onDone}>
          Já guardei os códigos
        </Button>
      </div>
    </div>
  );
}

/** Verificação em duas etapas desligada: botão Ativar -> QR code + segredo -> primeiro código -> códigos de recuperação. */
function DisabledView({ isMaster, onEnabled }: { isMaster: boolean; onEnabled: (codes: string[]) => void }) {
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const start = useMutation({
    mutationFn: setupTwoFactor,
    onSuccess: (data) => {
      setSetup(data);
      setError("");
    },
    onError: (err) => setError(twoFactorErrorMessage(err, "Não foi possível iniciar a ativação.")),
  });
  const enable = useMutation({
    mutationFn: () => enableTwoFactor(code.trim()),
    onSuccess: (data) => onEnabled(data.recoveryCodes),
    onError: (err) => setError(twoFactorErrorMessage(err, "Não foi possível ativar. Confira o código e tente novamente.")),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!TWO_FACTOR_CODE_PATTERN.test(code.trim())) {
      setError("Informe os 6 dígitos do código.");
      return;
    }
    setError("");
    enable.mutate();
  }

  return (
    <div className="grid gap-3">
      <p className="text-sm">
        Status: <Badge variant="outline">Desativada</Badge>
      </p>
      {isMaster && !setup && (
        <p className="text-xs text-muted-foreground" data-testid="two-factor-hint">
          <ShieldAlert className="mr-1 inline size-3.5 align-text-bottom" aria-hidden />
          Recomendado: ative a verificação em duas etapas.
        </p>
      )}
      {setup ? (
        <form onSubmit={submit} noValidate className="grid gap-3">
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>Abra um app autenticador (Google Authenticator, Authy, Microsoft Authenticator...).</li>
            <li>Leia o QR code abaixo ou digite o segredo manualmente.</li>
            <li>Digite o código de 6 dígitos que o app mostrar.</li>
          </ol>
          <img
            src={setup.qrCodeDataUrl}
            alt="QR code para o app autenticador"
            className="mx-auto size-44 rounded-md border bg-white p-2"
          />
          <div>
            <p className="text-xs font-medium text-muted-foreground">Segredo para digitação manual</p>
            <p className="break-all font-mono text-sm font-semibold" data-testid="two-factor-secret">
              {setup.secret}
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="two-factor-enable-code">Código de 6 dígitos</Label>
            <Input
              id="two-factor-enable-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
            />
          </div>
          <InlineError message={error} />
          <div className="flex gap-2">
            <Button type="submit" disabled={enable.isPending}>
              {enable.isPending && <Loader2 className="animate-spin" />}
              Confirmar e ativar
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setSetup(null);
                setCode("");
                setError("");
              }}
            >
              Cancelar
            </Button>
          </div>
        </form>
      ) : (
        <>
          <InlineError message={error} />
          <div>
            <Button type="button" disabled={start.isPending} onClick={() => start.mutate()}>
              {start.isPending && <Loader2 className="animate-spin" />}
              Ativar
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** Verificação em duas etapas ligada: mostra o status e permite desativar (senha + código do app ou de recuperação). */
function EnabledView({ me, onDisabled }: { me: AuthMe; onDisabled: () => void }) {
  const [password, setPassword] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const disable = useMutation({
    mutationFn: () =>
      disableTwoFactor(password, useRecovery ? { recoveryCode: code.trim() } : { code: code.trim() }),
    onSuccess: () => {
      toast.success("Verificação em duas etapas desativada.");
      onDisabled();
    },
    onError: (err) => setError(twoFactorErrorMessage(err, "Não foi possível desativar.")),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (password === "") {
      setError("Informe a sua senha.");
      return;
    }
    const valid = useRecovery ? RECOVERY_CODE_PATTERN.test(code.trim()) : TWO_FACTOR_CODE_PATTERN.test(code.trim());
    if (!valid) {
      setError(useRecovery ? "Informe o código de recuperação no formato xxxxx-xxxxx." : "Informe os 6 dígitos do código.");
      return;
    }
    setError("");
    disable.mutate();
  }

  return (
    <div className="grid gap-3">
      <p className="text-sm">
        Status: <Badge>Ativada</Badge>
      </p>
      <p className="text-sm" data-testid="recovery-remaining">
        Códigos de recuperação restantes: <strong>{me.recoveryCodesRemaining}</strong>
      </p>
      <form onSubmit={submit} noValidate className="grid gap-3 border-t pt-3">
        <h3 className="text-sm font-bold">Desativar</h3>
        <div className="grid gap-2">
          <Label htmlFor="two-factor-disable-password">Senha atual</Label>
          <PasswordInput
            id="two-factor-disable-password"
            autoComplete="current-password"
            toggleLabel="senha atual"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="two-factor-disable-code">{useRecovery ? "Código de recuperação" : "Código de 6 dígitos"}</Label>
          {useRecovery ? (
            <Input
              id="two-factor-disable-code"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="xxxxx-xxxxx"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          ) : (
            <Input
              id="two-factor-disable-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
            />
          )}
          <button
            type="button"
            className="justify-self-start text-xs underline"
            onClick={() => {
              setUseRecovery((current) => !current);
              setCode("");
              setError("");
            }}
          >
            {useRecovery ? "Usar código do app autenticador" : "Usar código de recuperação"}
          </button>
        </div>
        <InlineError message={error} />
        <div>
          <Button type="submit" variant="destructive" disabled={disable.isPending}>
            {disable.isPending && <Loader2 className="animate-spin" />}
            Desativar verificação
          </Button>
        </div>
      </form>
    </div>
  );
}

/** Conteúdo do diálogo; só é montado com o diálogo aberto (fechar descarta segredo e códigos da memória). */
function TwoFactorPanel() {
  const queryClient = useQueryClient();
  const isMaster = useSessionUser()?.role === "MESTRE";
  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: fetchMe, retry: false });
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });

  if (recoveryCodes) {
    return (
      <RecoveryCodes
        codes={recoveryCodes}
        onDone={() => {
          setRecoveryCodes(null);
          void refresh();
        }}
      />
    );
  }
  if (me.isLoading) return <Skeleton className="h-24 w-full" />;
  if (me.error || !me.data) {
    return (
      <div className="grid gap-2">
        <InlineError message={twoFactorErrorMessage(me.error, "Não foi possível carregar o estado da verificação.")} />
        <div>
          <Button variant="outline" size="sm" onClick={() => void me.refetch()}>
            Tentar novamente
          </Button>
        </div>
      </div>
    );
  }
  return me.data.twoFactorEnabled ? (
    <EnabledView me={me.data} onDisabled={() => void refresh()} />
  ) : (
    <DisabledView
      isMaster={isMaster}
      onEnabled={(codes) => {
        setRecoveryCodes(codes);
        void refresh();
      }}
    />
  );
}

export function TwoFactorDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Verificação em duas etapas</DialogTitle>
          <DialogDescription>
            Além da senha, o login passa a pedir um código do app autenticador. Isso protege a conta mesmo se a senha vazar.
          </DialogDescription>
        </DialogHeader>
        {open && <TwoFactorPanel />}
      </DialogContent>
    </Dialog>
  );
}

/** Botão do topo "Duas etapas" (acessível a MESTRE e PROFESSOR, ao lado de "Alterar senha"). */
export function TwoFactorButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label="Verificação em duas etapas">
        <ShieldCheck />
        <span className="hidden lg:inline">Duas etapas</span>
      </Button>
      <TwoFactorDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
