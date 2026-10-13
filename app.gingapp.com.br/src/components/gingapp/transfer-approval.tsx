import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Info, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { newPasswordRules } from "@/lib/password";
import {
  MINOR_BY_LINK_MESSAGE,
  SHARED_ITEM_LABEL,
  TRANSFER_APPROVAL_INVALID,
  TRANSFER_APPROVAL_NO_TOKEN,
  approveTransfer,
  declineTransfer,
  fetchTransferApproval,
  isInvalidTokenError,
  transferApprovalErrorMessage,
  validateApproveForm,
  type ApproveFormErrors,
  type TransferApprovalSummary,
} from "@/lib/transfer-approval";
import { PasswordField } from "./change-password";
import { ErrorBox, Frame } from "./password-reset";

const TITLE = "Aprovar transferência";

type Outcome = { status: "APPROVED" | "DECLINED"; groupName: string; email: string | null };

function GoToApp() {
  return (
    <Link to="/login" search={{ redirect: undefined }} className="mt-6 block">
      <Button className="h-12 w-full text-base" tabIndex={-1}>
        Entrar no app
      </Button>
    </Link>
  );
}

/** Resumo do que muda: frequência/graduações/certificados (NUNCA financeiro ou contato) e encerramento da matrícula. */
function Summary({ data }: { data: TransferApprovalSummary }) {
  const items = data.sharedOnApproval.map((item) => SHARED_ITEM_LABEL[item]).filter(Boolean);
  return (
    <div data-testid="approval-summary">
      <div className="mt-3 flex items-center gap-3">
        {data.groupLogoUrl && (
          <img src={data.groupLogoUrl} alt="" className="h-12 w-12 rounded-md border border-border object-cover" />
        )}
        <p className="text-base">
          O grupo <strong>{data.groupName}</strong> quer receber você.
        </p>
      </div>
      <p className="mt-4 flex items-center gap-2 text-sm font-semibold">
        <ShieldCheck size={16} aria-hidden />
        O que será compartilhado com o grupo novo (somente leitura)
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm" aria-label="Itens compartilhados">
        {items.map((label) => (
          <li key={label}>{label}</li>
        ))}
      </ul>
      <p className="mt-2 text-sm text-muted-foreground">O financeiro e os seus dados de contato nunca são compartilhados.</p>
      <p className="mt-3 flex items-start gap-2 rounded-lg bg-muted px-3 py-2.5 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>Ao aprovar, a sua matrícula atual será encerrada e você passará a fazer parte do grupo novo.</span>
      </p>
    </div>
  );
}

/**
 * /aprovar-transferencia?token=... (pública, sem login): o adulto aprova ou recusa a transferência recebida por
 * link do mestre do grupo novo. O token fica só em memória (removido da URL na montagem) e nunca é logado.
 */
export function TransferApprovalPage({ token: tokenFromUrl }: { token: string | undefined }) {
  const navigate = useNavigate();
  const [token] = useState(() => tokenFromUrl?.trim() ?? "");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<ApproveFormErrors>({});
  const [serverError, setServerError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmingDecline, setConfirmingDecline] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    if (tokenFromUrl !== undefined) {
      void navigate({ to: "/aprovar-transferencia", search: { token: undefined }, replace: true });
    }
    // Só na montagem: o token já foi capturado no estado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const query = useQuery({
    queryKey: ["transfer-approval", token],
    queryFn: () => fetchTransferApproval(token),
    enabled: token !== "",
    retry: false,
    staleTime: Infinity,
  });

  async function approve(event: FormEvent) {
    event.preventDefault();
    if (!query.data || busy) return;
    setServerError("");
    const found = validateApproveForm({ newPassword, confirmPassword, email, emailRequired: query.data.emailRequired });
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      const sentEmail = query.data.emailRequired ? email.trim() : "";
      const result = await approveTransfer(token, newPassword, sentEmail || undefined);
      setNewPassword("");
      setConfirmPassword("");
      setOutcome({ status: "APPROVED", groupName: result?.groupName ?? query.data.groupName, email: sentEmail || null });
    } catch (err) {
      setServerError(transferApprovalErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function decline() {
    if (!query.data || busy) return;
    setServerError("");
    setBusy(true);
    try {
      const result = await declineTransfer(token);
      setOutcome({ status: "DECLINED", groupName: result?.groupName ?? query.data.groupName, email: null });
    } catch (err) {
      setServerError(transferApprovalErrorMessage(err));
      setConfirmingDecline(false);
    } finally {
      setBusy(false);
    }
  }

  if (outcome) {
    return outcome.status === "APPROVED" ? (
      <Frame title="Transferência aprovada">
        <p className="mt-4 flex items-start gap-2 text-sm" role="status" data-testid="approval-success">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <span>
            Pronto! Você agora faz parte do grupo <strong>{outcome.groupName}</strong>. O seu login foi criado
            {outcome.email ? (
              <>
                {" "}
                com o e-mail <strong>{outcome.email}</strong>
              </>
            ) : (
              " com o e-mail que já estava no seu cadastro"
            )}
            : entre no app com ele e a senha que você acabou de criar.
          </span>
        </p>
        <GoToApp />
      </Frame>
    ) : (
      <Frame title="Transferência recusada">
        <p className="mt-4 flex items-start gap-2 text-sm" role="status" data-testid="approval-declined">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <span>
            Você recusou a transferência para o grupo <strong>{outcome.groupName}</strong>. A sua matrícula atual
            continua como está.
          </span>
        </p>
      </Frame>
    );
  }

  if (!token) {
    return (
      <Frame title={TITLE}>
        <ErrorBox>{TRANSFER_APPROVAL_NO_TOKEN}</ErrorBox>
      </Frame>
    );
  }

  if (query.isPending) {
    return (
      <Frame title={TITLE}>
        <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground" role="status" data-testid="approval-loading">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Carregando o pedido…
        </p>
      </Frame>
    );
  }

  if (query.isError) {
    const invalid = isInvalidTokenError(query.error);
    return (
      <Frame title={TITLE}>
        <ErrorBox>{invalid ? TRANSFER_APPROVAL_INVALID : transferApprovalErrorMessage(query.error)}</ErrorBox>
        {!invalid && (
          <Button className="mt-4 w-full" variant="outline" onClick={() => void query.refetch()}>
            Tentar de novo
          </Button>
        )}
      </Frame>
    );
  }

  const data = query.data;

  if (data.isMinor || !data.canApproveByLink) {
    return (
      <Frame title={TITLE}>
        <Summary data={data} />
        <p className="mt-4 flex items-start gap-2 rounded-lg bg-muted px-3 py-2.5 text-sm" role="status" data-testid="approval-minor">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{MINOR_BY_LINK_MESSAGE}</span>
        </p>
        <GoToApp />
      </Frame>
    );
  }

  return (
    <Frame title={TITLE}>
      <Summary data={data} />
      <form onSubmit={(e) => void approve(e)} noValidate>
        <h2 className="mt-6 text-base font-bold">Criar senha de acesso</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Para entrar no app no grupo novo, crie uma senha. Ela vale para o seu login no GingApp.
        </p>
        {data.emailRequired && (
          <div className="mt-3">
            <label className="field-label" htmlFor="approvalEmail">
              Seu e-mail
            </label>
            <input
              className="profile-input"
              id="approvalEmail"
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="voce@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? "approvalEmail-error" : undefined}
            />
            {errors.email && (
              <p id="approvalEmail-error" className="mt-1 text-sm text-destructive">
                {errors.email}
              </p>
            )}
          </div>
        )}
        <PasswordField
          id="approvalNewPassword"
          label="Nova senha"
          autoComplete="new-password"
          value={newPassword}
          onChange={setNewPassword}
          error={errors.newPassword}
        />
        <PasswordField
          id="approvalConfirmPassword"
          label="Confirmar nova senha"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          error={errors.confirmPassword}
        />
        <ul className="mt-3 grid gap-1 text-xs text-muted-foreground" aria-label="Requisitos da nova senha">
          {newPasswordRules(newPassword, "")
            .filter((rule) => rule.id === "length" || rule.id === "bytes")
            .map((rule) => (
              <li key={rule.id} data-ok={rule.ok} className={rule.ok ? "text-foreground" : undefined}>
                {rule.label}
              </li>
            ))}
        </ul>

        {serverError && <ErrorBox>{serverError}</ErrorBox>}

        {confirmingDecline ? (
          <div
            className="mt-6 rounded-md border border-destructive/40 bg-destructive/5 p-4"
            role="group"
            aria-label="Confirmar recusa"
            data-testid="decline-confirm"
          >
            <p className="text-sm">
              Recusar a transferência para <strong>{data.groupName}</strong>? A sua matrícula atual continua como está.
            </p>
            <div className="mt-3 flex gap-2">
              <Button type="button" variant="destructive" className="flex-1" disabled={busy} onClick={() => void decline()}>
                {busy && <Loader2 className="animate-spin" />}
                Sim, recusar
              </Button>
              <Button type="button" variant="outline" className="flex-1" disabled={busy} onClick={() => setConfirmingDecline(false)}>
                Voltar
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-6 grid gap-2">
            <Button className="h-12 w-full text-base" type="submit" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              {busy ? "Aprovando…" : "Aprovar"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-12 w-full text-base"
              disabled={busy}
              onClick={() => setConfirmingDecline(true)}
            >
              Recusar
            </Button>
          </div>
        )}
      </form>
    </Frame>
  );
}
