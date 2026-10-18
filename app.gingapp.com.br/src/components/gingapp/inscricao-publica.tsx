import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarDays,
  Check,
  CheckCircle2,
  CircleAlert,
  Copy,
  Loader2,
  MapPin,
  Printer,
  Search,
  Ticket,
  Users,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError } from "@/lib/api";
import { isValidCpf } from "@/lib/cpf";
import { formatCurrency } from "@/lib/format";
import {
  buildAnswers,
  classifySubmitError,
  closedMessage,
  copyText,
  fetchPublicForm,
  formatEventDate,
  isEmptyAnswer,
  isValidEmail,
  lookupIdentity,
  lookupRegistration,
  maskInput,
  NETWORK_MESSAGE,
  NOT_FOUND_MESSAGE,
  paymentStatusLabel,
  pixKeyTypeLabel,
  RATE_LIMIT_MESSAGE,
  statusLabel,
  submitRegistration,
  validateAnswers,
  visibleFields,
  type Answers,
  type AnswerValue,
  type ClosedReason,
  type FormFieldDef,
  type LookupResult,
  type PixInfo,
  type PublicForm,
  type SubmissionResult,
} from "@/lib/inscricao";
import { imageSrc, isImageRef } from "@/lib/uploads";
import { isAuthenticated, useSessionUser } from "@/lib/session";
import type { Ficha } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { FieldBlock, FormattedText } from "./inscricao-campos";

/** Impressão do comprovante: só a área marcada aparece (sem o formulário, botões nem rodapé). */
const PRINT_CSS = `@media print {
  body * { visibility: hidden !important; }
  .print-area, .print-area * { visibility: visible !important; }
  .print-area { position: absolute; left: 0; top: 0; width: 100%; padding: 24px; box-shadow: none !important; border: 0 !important; }
  .no-print { display: none !important; }
}`;

const SECTION_CLASS = "min-w-0 space-y-5 rounded-xl border border-border bg-card p-4 shadow-[var(--shadow)]";
const NO_SECTION = "__sem_secao__";

export type RegistrationView = "form" | "consult";

interface PageProps {
  slug: string;
  /** Tela inicial: o formulário ou a consulta por protocolo (`?consultar=1`). */
  initialView?: RegistrationView;
  /** Avisa a rota para refletir a tela na URL (sem dados pessoais). */
  onViewChange?: (view: RegistrationView) => void;
}

/** Página pública de inscrição (sem login): `/i/<slug>`. */
export function PublicRegistrationPage({ slug, initialView = "form", onViewChange }: PageProps) {
  const [view, setView] = useState<RegistrationView>(initialView);
  const [lastProtocol, setLastProtocol] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const query = useQuery({
    queryKey: ["public-form", slug],
    queryFn: () => fetchPublicForm(slug),
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const form = query.data;

  useEffect(() => {
    if (!form) return;
    const previous = document.title;
    document.title = form.title;
    return () => {
      document.title = previous;
    };
  }, [form]);

  const changeView = useCallback(
    (next: RegistrationView) => {
      setView(next);
      onViewChange?.(next);
      window.scrollTo({ top: 0 });
    },
    [onViewChange],
  );

  let body: ReactNode;
  if (query.isLoading) body = <LoadingState />;
  else if (query.error instanceof ApiError && query.error.status === 404) body = <ProblemCard title={NOT_FOUND_MESSAGE} />;
  else if (query.error || !form)
    body = (
      <ProblemCard
        title="Não foi possível carregar o formulário"
        text={query.error instanceof ApiError || !query.error ? "Tente novamente em instantes." : NETWORK_MESSAGE}
        action={
          <Button type="button" variant="outline" className="min-h-11" onClick={() => void query.refetch()}>
            Tentar de novo
          </Button>
        }
      />
    );
  else
    body = (
      <>
        <FormHeader form={form} compact={submitted} />
        <div className="space-y-5 px-4 pb-10">
          {view === "consult" && (
            <LookupView slug={slug} initialProtocol={lastProtocol} onBack={() => changeView("form")} />
          )}
          {/* Sempre montado (só escondido na consulta): o que a pessoa digitou não se perde ao consultar e voltar. */}
          <div hidden={view === "consult"}>
            <RegistrationFlow
              slug={slug}
              form={form}
              onReloadForm={async () => void (await query.refetch())}
              onSubmitted={() => setSubmitted(true)}
              onConsult={(protocol) => {
                setLastProtocol(protocol);
                changeView("consult");
              }}
            />
          </div>
        </div>
      </>
    );

  return (
    <div className="min-h-dvh overflow-x-hidden bg-background pb-[env(safe-area-inset-bottom)]">
      <style>{PRINT_CSS}</style>
      <main className="mx-auto w-full max-w-xl">{body}</main>
      <footer className="no-print mx-auto max-w-xl px-4 pb-8 text-center text-xs text-muted-foreground">
        Inscrição online pelo GingApp. Seus dados são usados somente para esta inscrição.{" "}
        <a href="/privacidade" target="_blank" rel="noopener" className="font-medium text-primary underline underline-offset-2">
          Política de privacidade
        </a>
      </footer>
    </div>
  );
}

/* ---------- Estados genéricos ---------- */

function LoadingState() {
  return (
    <div role="status" aria-label="Carregando formulário" data-testid="inscricao-carregando" className="space-y-4">
      <Skeleton className="aspect-video w-full rounded-none" />
      <div className="space-y-4 px-4">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    </div>
  );
}

function ProblemCard({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="px-4 py-16">
      <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-3 rounded-xl border border-border bg-card p-8 text-center" role="alert">
        <span className="flex size-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <CircleAlert size={26} aria-hidden />
        </span>
        <p className="text-lg font-bold">{title}</p>
        {text && <p className="text-sm text-muted-foreground">{text}</p>}
        {action}
      </div>
    </div>
  );
}

/* ---------- Cabeçalho (banner, título, evento, vagas, introdução) ---------- */

function Banner({ url, compact }: { url: string | null; compact: boolean }) {
  const [failed, setFailed] = useState(false);
  const usable = !!url && isImageRef(url) && !failed;
  return usable ? (
    <img
      src={imageSrc(url)}
      alt=""
      className={cn("w-full object-cover", compact ? "max-h-24" : "max-h-80")}
      data-testid="inscricao-banner"
      onError={() => setFailed(true)}
    />
  ) : (
    <div
      className={cn("flex w-full items-center justify-center bg-primary", compact ? "h-20" : "aspect-video max-h-60")}
      data-testid="inscricao-banner-padrao"
    >
      <span className="rounded-2xl bg-white/95 px-4 py-2.5 shadow-lg">
        <img src="/logo.png" alt="GingApp" className="h-9 w-auto object-contain" />
      </span>
    </div>
  );
}

function Fact({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex min-w-0 items-start gap-2 text-sm">
      <span className="mt-0.5 shrink-0 text-primary" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 break-words [overflow-wrap:anywhere]">{children}</span>
    </li>
  );
}

function FormHeader({ form, compact }: { form: PublicForm; compact: boolean }) {
  const price = form.priceCents ?? 0; // o backend manda null quando gratuito
  const showPrice = form.paymentMode !== "NONE" && price > 0;
  const spots = form.isOpen ? form.spotsLeft : null; // fechado: "Restam 0 vagas" seria ruído
  return (
    <header className="no-print mb-5">
      <Banner url={form.bannerUrl} compact={compact} />
      <div className="space-y-3 px-4 pt-4">
        <h1 className="break-words text-2xl font-extrabold leading-tight [overflow-wrap:anywhere]">{form.title}</h1>
        {compact ? null : (form.event || showPrice || (spots !== null && spots !== undefined)) && (
          <ul className="space-y-1.5 rounded-lg bg-secondary/70 p-3" data-testid="inscricao-evento">
            {form.event && form.event.title !== form.title && <Fact icon={<Ticket size={16} />}>{form.event.title}</Fact>}
            {form.event?.date && <Fact icon={<CalendarDays size={16} />}>{formatEventDate(form.event.date)}</Fact>}
            {form.event?.location && <Fact icon={<MapPin size={16} />}>{form.event.location}</Fact>}
            {showPrice && <Fact icon={<Wallet size={16} />}>Inscrição: {formatCurrency(price)}</Fact>}
            {spots !== null && spots !== undefined && (
              <Fact icon={<Users size={16} />}>
                <span data-testid="inscricao-vagas">{spots === 1 ? "Resta 1 vaga" : `Restam ${spots} vagas`}</span>
              </Fact>
            )}
          </ul>
        )}
        {!compact && form.intro && <FormattedText text={form.intro} className="text-sm leading-relaxed text-foreground/90" />}
      </div>
    </header>
  );
}

/* ---------- Pagamento (Pix manual) ---------- */

function PaymentBlock({ amountCents, pix }: { amountCents: number | null; pix: PixInfo | null }) {
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  async function copy() {
    if (!pix) return;
    setCopied((await copyText(pix.key)) ? "ok" : "fail");
  }
  return (
    <section
      aria-label="Pagamento por Pix"
      data-testid="inscricao-pagamento"
      className="min-w-0 space-y-3 rounded-xl border-2 border-primary/40 bg-secondary/60 p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-bold">Pagamento por Pix</h2>
        <strong className="text-xl text-primary" data-testid="inscricao-valor">
          {formatCurrency(amountCents ?? 0)}
        </strong>
      </div>
      {pix ? (
        <>
          <dl className="space-y-1.5 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">{pixKeyTypeLabel(pix.keyType)}</dt>
              <dd className="break-all rounded-md bg-card px-3 py-2 font-mono text-base font-semibold" data-testid="inscricao-chave-pix">
                {pix.key}
              </dd>
            </div>
            {pix.beneficiary && (
              <div>
                <dt className="text-xs text-muted-foreground">Favorecido</dt>
                <dd className="break-words font-medium">{pix.beneficiary}</dd>
              </div>
            )}
          </dl>
          <Button type="button" className="h-12 w-full text-base" onClick={() => void copy()}>
            {copied === "ok" ? <Check /> : <Copy />} {copied === "ok" ? "Chave Pix copiada!" : "Copiar chave Pix"}
          </Button>
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
            {copied === "ok" && "Chave copiada. Agora cole no app do seu banco."}
            {copied === "fail" && "Não foi possível copiar. Selecione a chave acima e copie manualmente."}
          </p>
          <p className="text-sm">Pague pelo app do seu banco e anexe o comprovante neste formulário.</p>
        </>
      ) : (
        <p className="text-sm">A chave Pix será informada pela organização do evento.</p>
      )}
    </section>
  );
}

/* ---------- Fluxo: formulário -> sucesso ---------- */

type Prefill = Partial<Record<"name" | "nickname" | "birthDate" | "document" | "phone" | "email", string>>;

/** Só existe para quem está logado: busca a ficha (sem derrubar a sessão em 401) e entrega os dados uma vez. */
function PrefillLoader({ onFill }: { onFill: (values: Prefill) => void }) {
  const user = useSessionUser();
  const query = useQuery({
    queryKey: ["public-form-prefill", user?.id ?? null],
    queryFn: () => api.get<Ficha>("/people/me/ficha", { skipAuthRedirect: true }),
    // Responsável pode ter vários dependentes: a ficha "padrão" poderia ser de outra pessoa. Só nome/e-mail da conta.
    enabled: !!user && user.role !== "RESPONSAVEL",
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const done = useRef(false);
  const settled = query.isSuccess || query.isError || query.fetchStatus === "idle";
  useEffect(() => {
    if (done.current || !user || !settled) return;
    done.current = true;
    const person = query.data?.person;
    const values: Prefill = { name: person?.name ?? user.name, email: user.email };
    if (person?.nickname) values.nickname = person.nickname;
    if (person?.birthDate) values.birthDate = person.birthDate.slice(0, 10);
    onFill(values);
  }, [settled, user, query.data, onFill]);
  return null;
}

function RegistrationFlow({
  slug,
  form,
  onReloadForm,
  onSubmitted,
  onConsult,
}: {
  slug: string;
  form: PublicForm;
  /** Refaz o GET do formulário (termo novo e `startedToken` novo) sem desmontar a tela: as respostas ficam. */
  onReloadForm: () => Promise<void>;
  onSubmitted: () => void;
  onConsult: (protocol: string) => void;
}) {
  const [answers, setAnswers] = useState<Answers>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [consentError, setConsentError] = useState("");
  const [hp, setHp] = useState("");
  const [busyKeys, setBusyKeys] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState("");
  const [result, setResult] = useState<SubmissionResult | null>(null);
  const [closed, setClosed] = useState<{ reason: ClosedReason | null } | null>(null);
  const submittingRef = useRef(false);
  const containerRef = useRef<HTMLFormElement>(null);
  const logged = useSessionUser() !== null && isAuthenticated();

  const fillFromAccount = useCallback(
    (values: Prefill) => {
      setAnswers((current) => {
        const next = { ...current };
        for (const field of form.fields) {
          const value = field.mapsTo ? values[field.mapsTo as keyof Prefill] : undefined;
          if (value && isEmptyAnswer(next[field.key]) && ["SHORT_TEXT", "EMAIL", "PHONE", "CPF", "DATE"].includes(field.type)) {
            next[field.key] = maskInput(field.type, value);
          }
        }
        return next;
      });
    },
    [form.fields],
  );

  if (closed || !form.isOpen) {
    return <ClosedView reason={closed ? closed.reason : form.closedReason} title={form.event?.title ?? form.title} onConsult={() => onConsult("")} />;
  }
  if (result) return <SuccessView form={form} result={result} answers={answers} onConsult={() => onConsult(result.protocol)} />;

  const visible = visibleFields(form, answers);
  const price = form.priceCents ?? 0;
  const paymentActive = form.paymentMode === "PIX_MANUAL" && price > 0;
  const paymentAnchor = paymentActive ? (visible.find((f) => f.type === "FILE")?.key ?? "__consent__") : null;

  function setAnswer(key: string, value: AnswerValue | undefined) {
    setAnswers((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!(key in current)) return current;
      const rest = { ...current };
      delete rest[key];
      return rest;
    });
    setBanner("");
  }

  function setBusy(key: string, busy: boolean) {
    setBusyKeys((current) => (busy ? (current.includes(key) ? current : [...current, key]) : current.filter((k) => k !== key)));
  }

  function focusFirstError(fieldErrors: Record<string, string>, hasConsentError: boolean) {
    const order = [...visible.map((f) => f.key), "__consent__"];
    const first = order.find((key) => (key === "__consent__" ? hasConsentError : key in fieldErrors));
    if (!first) return;
    window.setTimeout(() => {
      const holder =
        first === "__consent__"
          ? containerRef.current?.querySelector<HTMLElement>("[data-consent-box]")
          : [...(containerRef.current?.querySelectorAll<HTMLElement>("[data-field-key]") ?? [])].find((el) => el.getAttribute("data-field-key") === first);
      const target = holder?.querySelector<HTMLElement>("input:not(.sr-only), select, textarea, button") ?? holder;
      target?.focus();
      holder?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    }, 0);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submittingRef.current) return; // duplo toque / reenvio após 201
    if (busyKeys.length > 0) {
      setBanner("Aguarde o envio do arquivo terminar.");
      return;
    }
    const clientErrors = validateAnswers(form, answers);
    const missingConsent = !consent;
    if (Object.keys(clientErrors).length > 0 || missingConsent) {
      setErrors(clientErrors);
      setConsentError(missingConsent ? "Para se inscrever é preciso aceitar o termo." : "");
      setBanner("Confira os campos destacados.");
      focusFirstError(clientErrors, missingConsent);
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setBanner("");
    try {
      const response = await submitRegistration(slug, {
        answers: buildAnswers(form, answers),
        consent: true,
        consentVersion: Number(form.consent.version), // a versão do termo que ESTÁ na tela
        hp,
        startedToken: form.startedToken,
      });
      setResult(response); // submittingRef continua true: depois do 201 não há reenvio
      onSubmitted(); // o cabeçalho encolhe: o protocolo aparece sem rolar (o foco vai para o título do sucesso)
    } catch (error) {
      submittingRef.current = false;
      const failure = classifySubmitError(error);
      if (failure.kind === "validation") {
        const known = new Set(form.fields.map((f) => f.key));
        const fieldErrors: Record<string, string> = {};
        const extra: string[] = [];
        for (const [key, message] of Object.entries(failure.fields)) {
          if (known.has(key)) fieldErrors[key] = message;
          else extra.push(message);
        }
        setErrors(fieldErrors);
        setBanner([failure.message, ...extra].join(" "));
        // "Arquivo inválido ou expirado: envie o arquivo de novo.": o token já não vale, então tira o anexo para a
        // pessoa enviar outro (senão reenviaria o mesmo token recusado).
        const staleFiles = form.fields.filter((f) => f.type === "FILE" && f.key in fieldErrors).map((f) => f.key);
        if (staleFiles.length > 0) {
          setAnswers((current) => {
            const next = { ...current };
            for (const key of staleFiles) delete next[key];
            return next;
          });
        }
        focusFirstError(fieldErrors, false);
      } else if (failure.kind === "consent-outdated") {
        // O organizador mudou o termo enquanto a pessoa preenchia: recarrega o formulário (termo e token novos), MANTÉM o
        // que foi digitado e desmarca o aceite para ela ler o texto novo e aceitar de novo.
        setConsent(false);
        setConsentError(failure.message);
        setBanner(failure.message);
        await onReloadForm();
        focusFirstError({}, true);
      } else if (failure.kind === "closed") {
        setClosed({ reason: failure.reason });
        window.scrollTo({ top: 0 });
      } else if (failure.kind === "full") {
        setClosed({ reason: "FULL" });
        window.scrollTo({ top: 0 });
      } else {
        setBanner(failure.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  // Seções na ordem recebida; campos sem seção conhecida vêm primeiro, sem título.
  const sectionIds = new Set(form.sections.map((s) => s.id));
  const groups: { id: string | number; title: string | null; description: string | null; fields: FormFieldDef[] }[] = [
    { id: NO_SECTION, title: null, description: null, fields: visible.filter((f) => !f.sectionId || !sectionIds.has(f.sectionId)) },
    ...form.sections.map((s) => ({ id: s.id, title: s.title, description: s.description, fields: visible.filter((f) => f.sectionId === s.id) })),
  ].filter((group) => group.fields.length > 0);

  const payment = paymentActive ? <PaymentBlock amountCents={price} pix={form.pix} /> : null;

  return (
    <form ref={containerRef} onSubmit={(e) => void handleSubmit(e)} noValidate className="space-y-5" aria-label={`Inscrição: ${form.title}`}>
      {logged && <PrefillLoader onFill={fillFromAccount} />}
      {form.paymentMode === "PIX_AUTO" && price > 0 && (
        <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground" data-testid="inscricao-pix-auto">
          O pagamento desta inscrição será combinado com a organização do evento.
        </p>
      )}
      {groups.map((group) => (
        <section key={group.id} aria-label={group.title ?? "Dados da inscrição"} className={SECTION_CLASS}>
          {group.title && (
            <div className="space-y-1">
              <h2 className="text-lg font-bold">{group.title}</h2>
              {group.description && <FormattedText text={group.description} className="text-sm text-muted-foreground" />}
            </div>
          )}
          {group.fields.map((field) => (
            <div key={field.key} className="space-y-5">
              {paymentAnchor === field.key && payment}
              <FieldBlock
                slug={slug}
                field={field}
                value={answers[field.key]}
                error={errors[field.key]}
                onChange={setAnswer}
                onBusyChange={setBusy}
              />
            </div>
          ))}
        </section>
      ))}

      {paymentAnchor === "__consent__" && payment}

      {/* Honeypot: fora da tela (não display:none), fora da ordem de tabulação e invisível para leitores de tela. */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", top: "auto", width: 1, height: 1, overflow: "hidden" }}>
        <label>
          Não preencha este campo
          <input
            type="text"
            name="website"
            data-testid="hp"
            tabIndex={-1}
            autoComplete="off"
            value={hp}
            onChange={(e) => setHp(e.target.value)}
          />
        </label>
      </div>

      <section data-consent-box className={SECTION_CLASS} aria-label="Termo de consentimento">
        <h2 className="text-lg font-bold">Termo e privacidade</h2>
        <div
          tabIndex={0}
          role="region"
          aria-label="Texto do termo"
          className="max-h-44 overflow-y-auto rounded-md border border-border bg-muted/40 p-3 text-sm"
        >
          <FormattedText text={form.consent.text} />
        </div>
        <label
          className={cn(
            "flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-secondary",
            consentError && "border-destructive",
          )}
        >
          <input
            type="checkbox"
            id="consentimento"
            data-testid="consentimento"
            checked={consent}
            aria-required
            aria-invalid={!!consentError}
            aria-describedby={consentError ? "consentimento-erro" : undefined}
            className="mt-0.5 size-5 shrink-0 accent-[var(--primary)]"
            onChange={(e) => {
              setConsent(e.target.checked);
              if (e.target.checked) setConsentError("");
            }}
          />
          <span className="min-w-0 font-medium">
            Li e aceito o termo acima e a{" "}
            <a href="/privacidade" target="_blank" rel="noopener" className="text-primary underline underline-offset-2">
              Política de privacidade
            </a>
            .<span className="sr-only"> (obrigatório)</span>
          </span>
        </label>
        {consentError && (
          <p id="consentimento-erro" role="alert" className="text-sm font-medium text-destructive">
            {consentError}
          </p>
        )}
      </section>

      <div role="alert" aria-live="assertive" data-testid="inscricao-aviso">
        {banner && <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm font-medium text-destructive">{banner}</p>}
      </div>

      <Button type="submit" className="h-12 w-full text-base font-bold" disabled={submitting || busyKeys.length > 0}>
        {submitting && <Loader2 className="animate-spin" />}
        {submitting ? "Enviando…" : "Enviar inscrição"}
      </Button>
      {busyKeys.length > 0 && <p className="text-center text-sm text-muted-foreground">Aguarde o envio do arquivo terminar.</p>}

      <p className="text-center text-sm">
        <button type="button" className="min-h-11 font-medium text-primary underline underline-offset-2" onClick={() => onConsult("")}>
          Já me inscrevi: consultar minha inscrição
        </button>
      </p>
    </form>
  );
}

/* ---------- Inscrições encerradas ---------- */

function ClosedView({ reason, title, onConsult }: { reason: ClosedReason | null; title: string; onConsult: () => void }) {
  return (
    <div className="space-y-4" data-testid="inscricao-encerrada">
      <div role="alert" className="space-y-1 rounded-xl border border-border bg-card p-5 text-center">
        <p className="text-sm text-muted-foreground">{title}</p>
        <p className="text-lg font-bold">{closedMessage(reason)}</p>
      </div>
      <p className="text-center text-sm">
        <button type="button" className="min-h-11 font-medium text-primary underline underline-offset-2" onClick={onConsult}>
          Consultar minha inscrição
        </button>
      </p>
    </div>
  );
}

/**
 * Linha "Pagamento" do resultado/consulta. Inscrição recusada ou cancelada não tem mais pagamento a cobrar: o servidor
 * continua mandando `paymentStatus: "PENDING"` nela, então a linha "Pagamento pendente" só confundiria a pessoa.
 */
function paymentLine(status: string, paymentStatus: string | null): string | null {
  return status === "REJECTED" || status === "CANCELLED" ? null : paymentStatusLabel(paymentStatus);
}

/* ---------- Sucesso ---------- */

function SuccessView({
  form,
  result,
  answers,
  onConsult,
}: {
  form: PublicForm;
  result: SubmissionResult;
  answers: Answers;
  onConsult: () => void;
}) {
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  const payment = result.payment && result.payment.mode === "PIX_MANUAL" ? result.payment : null;
  const nameField = form.fields.find((f) => f.mapsTo === "name");
  const personName = nameField && typeof answers[nameField.key] === "string" ? (answers[nameField.key] as string).trim() : "";
  const paymentText = paymentLine(result.status, result.paymentStatus);

  return (
    <div className="space-y-5" data-testid="inscricao-sucesso">
      <div className="print-area space-y-4 rounded-xl border border-border bg-card p-5 text-center shadow-[var(--shadow)]">
        <p className="hidden text-sm font-semibold print:block">Comprovante de inscrição · GingApp</p>
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-secondary text-primary no-print">
          <CheckCircle2 size={30} aria-hidden />
        </span>
        <div role="status" aria-live="polite" className="space-y-1">
          <h2 ref={headingRef} tabIndex={-1} className="text-xl font-extrabold outline-none">
            Inscrição recebida!
          </h2>
          {result.message && <FormattedText text={result.message} className="text-sm text-muted-foreground" />}
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Seu protocolo</p>
          <p className="mt-1 break-all font-mono text-3xl font-extrabold tracking-wider text-primary" data-testid="inscricao-protocolo">
            {result.protocol}
          </p>
        </div>
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Evento</dt>
            <dd className="min-w-0 break-words text-right font-medium">{form.event?.title ?? form.title}</dd>
          </div>
          {personName && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Nome</dt>
              <dd className="min-w-0 break-words text-right font-medium">{personName}</dd>
            </div>
          )}
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Situação</dt>
            <dd className="text-right font-medium" data-testid="inscricao-status">
              {statusLabel(result.status)}
            </dd>
          </div>
          {paymentText && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Pagamento</dt>
              <dd className="text-right font-medium">{paymentText}</dd>
            </div>
          )}
        </dl>
        <p className="hidden text-xs text-muted-foreground print:block">Emitido em {new Date().toLocaleString("pt-BR")}. Guarde o protocolo.</p>
      </div>

      <div className="no-print space-y-3">
        <Button
          type="button"
          variant="outline"
          className="h-12 w-full text-base"
          onClick={async () => setCopied((await copyText(result.protocol)) ? "ok" : "fail")}
        >
          {copied === "ok" ? <Check /> : <Copy />} {copied === "ok" ? "Protocolo copiado!" : "Copiar protocolo"}
        </Button>
        {copied === "fail" && <p className="text-center text-sm text-destructive">Não foi possível copiar. Anote o protocolo acima.</p>}
        <Button type="button" className="h-12 w-full text-base" onClick={() => window.print()}>
          <Printer /> Salvar / imprimir comprovante
        </Button>
        {payment && (
          <div className="space-y-3">
            <p className="rounded-lg bg-secondary p-3 text-sm" data-testid="inscricao-lembrete-comprovante">
              {result.proofRequired
                ? "Atenção: o comprovante do Pix é obrigatório e ainda não foi recebido. Envie-o à organização informando o protocolo para confirmar a inscrição."
                : "Guarde o comprovante do Pix. A organização vai conferir o pagamento e confirmar sua inscrição."}
            </p>
            <PaymentBlock amountCents={payment.amountCents} pix={payment.pix} />
          </div>
        )}
        <p className="text-center text-sm">
          <button type="button" className="min-h-11 font-medium text-primary underline underline-offset-2" onClick={onConsult}>
            Consultar minha inscrição
          </button>
        </p>
      </div>
    </div>
  );
}

/* ---------- Consulta por protocolo ---------- */

const LOOKUP_GENERIC = "Não encontramos uma inscrição com estes dados. Confira o protocolo e o e-mail ou CPF informados.";

function LookupView({ slug, initialProtocol, onBack }: { slug: string; initialProtocol: string; onBack: (() => void) | null }) {
  const [protocol, setProtocol] = useState(initialProtocol);
  const [identity, setIdentity] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [found, setFound] = useState<LookupResult | null>(null);
  const loadingRef = useRef(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (loadingRef.current) return;
    setFound(null);
    const code = protocol.trim().toUpperCase();
    const who = identity.trim();
    if (!code || !who) {
      setError("Informe o protocolo e o seu e-mail ou CPF.");
      return;
    }
    if (who.includes("@") ? !isValidEmail(who) : !isValidCpf(who)) {
      setError("Informe um e-mail válido ou um CPF válido.");
      return;
    }
    setError("");
    loadingRef.current = true;
    setLoading(true);
    try {
      setFound(await lookupRegistration(slug, { protocol: code, ...lookupIdentity(who) }));
    } catch (e) {
      if (e instanceof ApiError) setError(e.status === 429 ? RATE_LIMIT_MESSAGE : LOOKUP_GENERIC);
      else setError(NETWORK_MESSAGE);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }

  const paymentText = found ? paymentLine(found.status, found.paymentStatus) : null;
  return (
    <section className={SECTION_CLASS} data-testid="inscricao-consulta" aria-label="Consultar inscrição">
      <h2 className="text-lg font-bold">Consultar minha inscrição</h2>
      <form onSubmit={(e) => void submit(e)} noValidate className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="consulta-protocolo" className="block text-sm font-semibold">
            Protocolo
          </label>
          <Input
            id="consulta-protocolo"
            className="h-11 uppercase"
            value={protocol}
            autoCapitalize="characters"
            autoComplete="off"
            placeholder="INS-XXXX"
            onChange={(e) => setProtocol(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="consulta-identidade" className="block text-sm font-semibold">
            E-mail ou CPF usado na inscrição
          </label>
          <Input
            id="consulta-identidade"
            className="h-11"
            value={identity}
            autoCapitalize="none"
            autoComplete="off"
            onChange={(e) => setIdentity(e.target.value)}
          />
        </div>
        <div role="alert" aria-live="assertive">
          {error && <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm font-medium text-destructive">{error}</p>}
        </div>
        <Button type="submit" className="h-12 w-full text-base font-bold" disabled={loading}>
          {loading ? <Loader2 className="animate-spin" /> : <Search />} {loading ? "Consultando…" : "Consultar"}
        </Button>
      </form>
      <div role="status" aria-live="polite">
        {found && (
          <div className="space-y-2 rounded-lg border border-primary/40 bg-secondary/60 p-4" data-testid="inscricao-consulta-resultado">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Protocolo {found.protocol}</p>
            <p className="text-lg font-bold">{statusLabel(found.status)}</p>
            {paymentText && <p className="text-sm font-medium">{paymentText}</p>}
            {found.message && <FormattedText text={found.message} className="text-sm text-muted-foreground" />}
          </div>
        )}
      </div>
      {onBack && (
        <p className="text-center text-sm">
          <button type="button" className="min-h-11 font-medium text-primary underline underline-offset-2" onClick={onBack}>
            Voltar ao formulário
          </button>
        </p>
      )}
    </section>
  );
}
