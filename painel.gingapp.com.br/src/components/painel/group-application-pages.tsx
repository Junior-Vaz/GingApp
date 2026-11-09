import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  Award,
  CalendarCheck,
  CheckCircle2,
  Clock,
  Inbox,
  Loader2,
  Mail,
  MailWarning,
  MessageSquare,
  QrCode,
  SearchX,
  Smartphone,
  Users,
  Wallet,
  XCircle,
} from "lucide-react";
import { Brand } from "@/components/painel/brand";
import { GroupApplicationForm } from "@/components/painel/group-application-form";
import { LegalLinks } from "@/components/painel/legal";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ApiError } from "@/lib/api";
import { fmt, toDate } from "@/lib/format";
import {
  RESEND_INTERVAL_MINUTES,
  RESEND_MAX_SENDS,
  VERIFY_LINK_HOURS,
  confirmErrorMessage,
  confirmGroupApplicationEmail,
  fetchGroupApplicationStatus,
  readApplicationToken,
  resendErrorMessage,
  resendGroupApplicationEmail,
  type GroupApplicationStatus,
  type GroupApplicationSubmitted,
} from "@/lib/group-application";

const ENTER_ANIMATION = "animate-in fade-in-0 slide-in-from-bottom-2 duration-500 motion-reduce:animate-none";

/** Moldura das páginas públicas de adesão: fundo branco, marca no topo, links legais no rodapé. */
function PublicShell({ children, narrow = false }: { children: ReactNode; narrow?: boolean }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <Link to="/comecar" aria-label="GingApp - início do cadastro">
          <Brand />
        </Link>
        <Button asChild variant="ghost" size="sm" className="min-h-11 md:min-h-9">
          <Link to="/login" search={{ redirect: undefined }}>
            Entrar
          </Link>
        </Button>
      </header>
      <main className={`mx-auto w-full flex-1 px-4 pb-10 sm:px-6 ${narrow ? "max-w-md" : "max-w-5xl"}`}>{children}</main>
      <footer className="px-4 pb-8">
        <LegalLinks />
      </footer>
    </div>
  );
}

/** Consulta do andamento (GET público, sem Authorization). Compartilhada pela página de acompanhamento e pelo reenvio. */
function useApplicationStatus(token: string) {
  return useQuery({
    queryKey: ["group-application-status", token],
    queryFn: () => fetchGroupApplicationStatus(token),
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
}

/** Re-renderiza a cada segundo enquanto `active` (contagem regressiva do reenvio). */
function useTick(active: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, [active]);
}

function formatWait(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Reenvio do e-mail de confirmação. O servidor é quem manda (no máximo 3 envios, 1 a cada 5 minutos); aqui só mostramos o
 * que `GET /public/group-applications/:token` informa (`canResend`, `resendAvailableAt`) e o botão fica desabilitado até lá.
 */
function ResendEmailBox({ token, query }: { token: string; query: UseQueryResult<GroupApplicationStatus> }) {
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const resend = useMutation({
    mutationFn: () => resendGroupApplicationEmail(token),
    onSuccess: () =>
      setFeedback({
        ok: true,
        text: "Pedimos o reenvio. Em instantes um novo e-mail deve chegar (confira o spam). O link anterior deixa de valer.",
      }),
    onError: (error) => setFeedback({ ok: false, text: resendErrorMessage(error) }),
    // O servidor é a fonte da verdade da espera e do limite: relê depois de cada tentativa (inclusive o 429).
    onSettled: () => void query.refetch(),
  });

  const data = query.data;
  const availableAt = data?.resendAvailableAt ? Date.parse(data.resendAvailableAt) : Number.NaN;
  const waitMs = Number.isNaN(availableAt) ? 0 : Math.max(0, availableAt - Date.now());
  useTick(waitMs > 0);
  const limitReached = data?.canResend === false && !data.resendAvailableAt;
  const alreadyConfirmed = data !== undefined && data.status !== "UNVERIFIED";

  if (alreadyConfirmed) {
    return (
      <p className="rounded-md bg-secondary p-3 text-sm text-primary" role="status" data-testid="resend-already-confirmed">
        Seu e-mail já foi confirmado. O pedido está na fila de análise da equipe.
      </p>
    );
  }

  const disabled = query.isLoading || resend.isPending || waitMs > 0 || limitReached;
  return (
    <div className="grid gap-2" data-testid="resend-box">
      <Button type="button" variant="outline" className="w-full" disabled={disabled} onClick={() => resend.mutate()}>
        <Mail />
        {resend.isPending ? "Reenviando…" : "Reenviar e-mail"}
      </Button>
      <p className="text-xs text-muted-foreground" data-testid="resend-hint">
        {limitReached
          ? `Você já usou os ${String(RESEND_MAX_SENDS)} reenvios deste pedido. Se o e-mail não chegar, confira o spam ou faça um novo pedido.`
          : waitMs > 0
            ? `Você poderá reenviar em ${formatWait(waitMs)}. Podem ser até ${String(RESEND_MAX_SENDS)} reenvios, com ${String(RESEND_INTERVAL_MINUTES)} minutos entre eles.`
            : `Não chegou? Você pode reenviar até ${String(RESEND_MAX_SENDS)} vezes, com ${String(RESEND_INTERVAL_MINUTES)} minutos entre os envios.`}
      </p>
      {feedback && (
        <p className={feedback.ok ? "text-sm text-primary" : "text-sm text-destructive"} role={feedback.ok ? "status" : "alert"}>
          {feedback.text}
        </p>
      )}
    </div>
  );
}

/** Reenvio na tela "Pedido recebido" (lá ninguém mais consulta o status, então a consulta nasce aqui). */
function ResendEmailForToken({ token }: { token: string }) {
  const query = useApplicationStatus(token);
  return <ResendEmailBox token={token} query={query} />;
}

/** "Pedido recebido": o texto depende de `emailVerification` (PENDING pede a confirmação; SKIPPED = envio desligado). */
function ApplicationReceived({ result }: { result: GroupApplicationSubmitted }) {
  const needsConfirmation = result.emailVerification === "PENDING" || result.status === "UNVERIFIED";
  return (
    <Card
      className={`grid gap-4 p-6 ${ENTER_ANIMATION}`}
      data-testid="application-received"
      data-email-verification={needsConfirmation ? "PENDING" : "SKIPPED"}
    >
      <CheckCircle2 className="size-9 text-primary" aria-hidden />
      <h1 className="text-xl font-extrabold">Pedido recebido</h1>
      {needsConfirmation && (
        <div className="grid gap-3 rounded-md border border-primary/30 bg-secondary p-4" data-testid="email-confirmation">
          <p className="flex items-start gap-2 text-sm font-semibold text-primary">
            <Mail className="mt-0.5 size-4 shrink-0" aria-hidden />
            Enviamos um e-mail para confirmar seu endereço.
          </p>
          <p className="text-sm">
            Abra o link (vale {String(VERIFY_LINK_HOURS)} horas) para o pedido entrar na fila de análise. Confira o spam.
          </p>
          <ResendEmailForToken token={result.statusToken} />
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        Obrigado! A equipe do GingApp vai conferir os dados do seu grupo. A análise é feita por pessoas e não temos um prazo fixo.
      </p>
      <ul className="grid list-disc gap-1.5 pl-5 text-sm">
        <li>Ainda não existe conta nem grupo: eles são criados quando o pedido for aprovado.</li>
        <li>Você pode acompanhar o andamento a qualquer momento pelo botão abaixo. Guardamos o link neste aparelho.</li>
        <li>Se aprovado, você entra no painel com o e-mail e a senha que acabou de criar.</li>
      </ul>
      <Button asChild size="lg" className="w-full">
        <Link to="/comecar/acompanhar/$token" params={{ token: result.statusToken }}>
          Acompanhar meu pedido
        </Link>
      </Button>
      <p className="rounded-md bg-secondary p-3 text-sm text-primary" role="note">
        Se esse e-mail já tem cadastro, use <strong>Entrar</strong> ou <strong>Esqueci minha senha</strong> na tela de login.
      </p>
      <Button asChild variant="outline" className="w-full">
        <Link to="/login" search={{ redirect: undefined }}>
          Ir para o login
        </Link>
      </Button>
    </Card>
  );
}

const STEPS = [
  { title: "Faça o pedido", text: "Preencha o formulário abaixo com seus dados e os do grupo. Leva poucos minutos." },
  {
    title: "A equipe confere e aprova",
    text: "A análise é feita por pessoas, sem prazo prometido. Você acompanha o andamento por aqui.",
  },
  { title: "Entre no painel e siga o passo a passo", text: "Aprovado, é só entrar com o e-mail e a senha que você criou. O painel mostra o que fazer primeiro." },
] as const;

const BENEFITS = [
  { icon: Users, title: "Alunos e turmas", text: "Cadastro dos alunos, turmas, horários e aulas num só lugar." },
  { icon: QrCode, title: "Chamada por QR ou localização", text: "O aluno marca a presença no celular, na hora do treino." },
  { icon: Award, title: "Graduações e certificados", text: "Acompanhe as cordas e emita certificados com QR de verificação." },
  { icon: Wallet, title: "Financeiro", text: "Mensalidades, cobranças e quem está em dia, sem planilha." },
  { icon: MessageSquare, title: "Comunicação com os alunos", text: "Avisos e comunicados que chegam direto no celular de cada um." },
  { icon: Smartphone, title: "App para os alunos", text: "Cada aluno acompanha presença, evolução e eventos no próprio app." },
] as const;

const FAQ = [
  {
    q: "É mesmo gratuito?",
    a: "Sim. Não há mensalidade para o grupo usar o GingApp.",
  },
  {
    q: "Sou professor de um grupo que já usa o GingApp",
    a: "Não precisa fazer este pedido. Peça ao Mestre do seu grupo para cadastrar você em Professores, no painel.",
  },
  {
    q: "Já tenho conta",
    a: "Então é só entrar no painel.",
    link: true,
  },
] as const;

/** /comecar (pública): apresentação, passo a passo, o que o grupo ganha, formulário e perguntas frequentes. */
export function GroupApplicationPage() {
  // Conveniência: pedido feito antes neste navegador (token em localStorage, lido com try/catch).
  const [savedToken] = useState<string | null>(() => readApplicationToken());
  const [submitted, setSubmitted] = useState<GroupApplicationSubmitted | null>(null);

  if (submitted) {
    return (
      <PublicShell narrow>
        <ApplicationReceived result={submitted} />
      </PublicShell>
    );
  }

  return (
    <PublicShell>
      {savedToken && (
        <p className="mb-4 rounded-md bg-secondary px-4 py-3 text-sm text-primary" data-testid="track-saved">
          Você já fez um pedido neste aparelho.{" "}
          <Link to="/comecar/acompanhar/$token" params={{ token: savedToken }} className="font-semibold underline">
            Acompanhar meu pedido
          </Link>
        </p>
      )}

      <section className={`py-6 sm:py-10 ${ENTER_ANIMATION}`} aria-labelledby="comecar-titulo">
        <h1 id="comecar-titulo" className="max-w-3xl text-3xl font-extrabold leading-tight sm:text-4xl">
          Leve seu grupo para o GingApp — é gratuito
        </h1>
        <p className="mt-3 max-w-2xl text-base text-muted-foreground sm:text-lg">
          Organize alunos, turmas, presença, graduações e financeiro do seu grupo de capoeira num painel simples, e dê um app para os seus alunos.
        </p>
        <Button asChild size="lg" className="mt-6 w-full sm:w-auto">
          <a href="#pedido">Fazer o pedido</a>
        </Button>
      </section>

      <section className="py-6" aria-labelledby="como-funciona">
        <h2 id="como-funciona" className="text-xl font-extrabold">
          Como funciona
        </h2>
        <ol className="mt-4 grid gap-4 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-3 rounded-xl border p-4">
              <span
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground"
                aria-hidden
              >
                {index + 1}
              </span>
              <div>
                <h3 className="text-base font-bold">
                  <span className="sr-only">Passo {index + 1}: </span>
                  {step.title}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="py-6" aria-labelledby="o-que-ganha">
        <h2 id="o-que-ganha" className="text-xl font-extrabold">
          O que seu grupo ganha
        </h2>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {BENEFITS.map(({ icon: Icon, title, text }) => (
            <li key={title} className="flex gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
                <Icon className="size-5" aria-hidden />
              </span>
              <div>
                <h3 className="text-sm font-bold">{title}</h3>
                <p className="text-sm text-muted-foreground">{text}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section id="pedido" className="scroll-mt-4 py-6" aria-labelledby="pedido-titulo">
        <Card className="mx-auto w-full max-w-xl p-5 sm:p-6">
          <h2 id="pedido-titulo" className="text-xl font-extrabold">
            Faça o pedido do seu grupo
          </h2>
          <p className="mb-4 mt-1 text-sm text-muted-foreground">
            O pedido não cria o grupo na hora: a equipe confere e, aprovado, você entra com este e-mail e esta senha.
          </p>
          <GroupApplicationForm
            onSubmitted={(result) => {
              setSubmitted(result);
              window.scrollTo({ top: 0 });
            }}
          />
        </Card>
      </section>

      <section className="py-6" aria-labelledby="duvidas">
        <h2 id="duvidas" className="text-xl font-extrabold">
          Dúvidas rápidas
        </h2>
        <div className="mt-4 grid gap-2">
          {FAQ.map((item) => (
            <details key={item.q} className="group rounded-xl border px-4 py-3">
              <summary className="min-h-6 cursor-pointer text-sm font-bold">{item.q}</summary>
              <p className="mt-2 text-sm text-muted-foreground">
                {item.a}
                {"link" in item && (
                  <>
                    {" "}
                    <Link to="/login" search={{ redirect: undefined }} className="font-semibold text-primary underline">
                      Entrar
                    </Link>
                  </>
                )}
              </p>
            </details>
          ))}
        </div>
      </section>
    </PublicShell>
  );
}

function formatDate(iso: string): string {
  return fmt(toDate(iso), "dd/MM/yyyy");
}

function StatusBody({
  data,
  token,
  query,
}: {
  data: GroupApplicationStatus;
  token: string;
  query: UseQueryResult<GroupApplicationStatus>;
}) {
  const sent = formatDate(data.createdAt);
  if (data.status === "UNVERIFIED") {
    return (
      <div className="grid gap-4" data-testid="status-unverified">
        <MailWarning className="size-9 text-primary" aria-hidden />
        <h1 className="text-xl font-extrabold">Falta confirmar seu e-mail</h1>
        <p className="text-sm text-muted-foreground">
          O pedido do grupo <strong className="text-foreground">{data.groupName}</strong>, enviado em {sent}, ainda não está na fila de análise.
          Enviamos um e-mail para o endereço informado: abra o link (vale {String(VERIFY_LINK_HOURS)} horas) para confirmar. Confira o spam.
        </p>
        <ResendEmailBox token={token} query={query} />
        <p className="rounded-md bg-secondary p-3 text-sm text-primary" role="note">
          Se o pedido não for confirmado em 3 dias, ele é encerrado e você pode fazer um novo.
        </p>
      </div>
    );
  }
  if (data.status === "APPROVED") {
    return (
      <div className="grid gap-4" data-testid="status-approved">
        <CheckCircle2 className="size-9 text-primary" aria-hidden />
        <h1 className="text-xl font-extrabold">Aprovado</h1>
        <p className="text-sm text-muted-foreground">
          O pedido do grupo <strong className="text-foreground">{data.groupName}</strong> foi aprovado. Entre no painel com o e-mail e a
          senha que você criou no pedido.
        </p>
        <Button asChild size="lg" className="w-full">
          <Link to="/login" search={{ redirect: undefined }}>
            Entrar no painel
          </Link>
        </Button>
      </div>
    );
  }
  if (data.status === "REJECTED" || data.status === "EXPIRED") {
    const rejected = data.status === "REJECTED";
    return (
      <div className="grid gap-4" data-testid={rejected ? "status-rejected" : "status-expired"}>
        <XCircle className="size-9 text-destructive" aria-hidden />
        <h1 className="text-xl font-extrabold">{rejected ? "Não aprovado" : "Pedido expirado"}</h1>
        <p className="text-sm text-muted-foreground">
          {rejected ? (
            <>
              O pedido do grupo <strong className="text-foreground">{data.groupName}</strong> não foi aprovado.
            </>
          ) : (
            <>
              O pedido do grupo <strong className="text-foreground">{data.groupName}</strong> ficou sem resposta por muito tempo e foi
              encerrado.
            </>
          )}
        </p>
        {rejected && data.rejectionReason && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm" data-testid="rejection-reason">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Motivo informado pela equipe</p>
            <p className="mt-1">{data.rejectionReason}</p>
          </div>
        )}
        <Button asChild size="lg" className="w-full">
          <Link to="/comecar">Fazer novo pedido</Link>
        </Button>
      </div>
    );
  }
  return (
    <div className="grid gap-4" data-testid="status-pending">
      <Clock className="size-9 text-primary" aria-hidden />
      <h1 className="text-xl font-extrabold">Em análise</h1>
      <p className="text-sm text-muted-foreground">
        O pedido do grupo <strong className="text-foreground">{data.groupName}</strong>, enviado em {sent}, está em análise pela equipe do
        GingApp. A análise é feita por pessoas e não temos um prazo fixo. Volte aqui quando quiser: guarde este endereço.
      </p>
      <p className="rounded-md bg-secondary p-3 text-sm text-primary" role="note">
        Nada é criado antes da aprovação. Quando aprovarem, este aviso muda e o botão para entrar no painel aparece.
      </p>
    </div>
  );
}

/** /comecar/acompanhar/$token (pública): consulta o andamento do pedido SEM Authorization. */
export function ApplicationStatusPage({ token }: { token: string }) {
  const query = useApplicationStatus(token);
  const notFound = query.error instanceof ApiError && query.error.status === 404;

  let content: ReactNode;
  if (query.isLoading) {
    content = (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Buscando o seu pedido…
      </p>
    );
  } else if (notFound) {
    content = (
      <div className="grid gap-4" data-testid="status-not-found">
        <SearchX className="size-9 text-muted-foreground" aria-hidden />
        <h1 className="text-xl font-extrabold">Pedido não encontrado</h1>
        <p className="text-sm text-muted-foreground">
          Não achamos nenhum pedido com este endereço. Confira o link ou faça um novo pedido. Se o e-mail que você usou já tinha cadastro,
          use <strong>Entrar</strong> ou <strong>Esqueci minha senha</strong> na tela de login.
        </p>
        <Button asChild size="lg" className="w-full">
          <Link to="/comecar">Fazer um pedido</Link>
        </Button>
      </div>
    );
  } else if (!query.data) {
    // Sem dados (falha na primeira consulta). Uma releitura que falha depois de já termos o pedido mantém a tela atual.
    content = (
      <div className="grid gap-4" data-testid="status-error">
        <Inbox className="size-9 text-muted-foreground" aria-hidden />
        <h1 className="text-xl font-extrabold">Não foi possível consultar o pedido</h1>
        <p className="text-sm text-destructive" role="alert">
          {query.error instanceof ApiError && query.error.status === 429
            ? "Muitas consultas seguidas. Aguarde um instante e tente de novo."
            : "Verifique sua conexão e tente novamente."}
        </p>
        <Button variant="outline" className="w-full" onClick={() => void query.refetch()}>
          Tentar novamente
        </Button>
      </div>
    );
  } else {
    content = <StatusBody data={query.data} token={token} query={query} />;
  }

  return (
    <PublicShell narrow>
      <Card className={`p-6 ${ENTER_ANIMATION}`}>
        <p className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
          <CalendarCheck className="size-4" aria-hidden /> Acompanhar pedido
        </p>
        {content}
      </Card>
    </PublicShell>
  );
}

/**
 * /comecar/confirmar/$token (pública): o link do e-mail de confirmação. NUNCA confirma ao abrir (leitores de e-mail e
 * antivírus abrem links sozinhos): só o clique em "Confirmar meu e-mail" faz o POST. O token de confirmação vive só no PATH
 * (e no corpo do POST), nunca em query string.
 */
export function ConfirmEmailPage({ token }: { token: string }) {
  // Conveniência: pedido feito antes neste navegador (token em localStorage, lido com try/catch).
  const [trackToken] = useState<string | null>(() => readApplicationToken());
  const confirm = useMutation({ mutationFn: () => confirmGroupApplicationEmail(token) });
  const invalid = confirm.error instanceof ApiError && confirm.error.status === 404;

  const trackLink = trackToken ? (
    <Button asChild size="lg" className="w-full">
      <Link to="/comecar/acompanhar/$token" params={{ token: trackToken }}>
        Acompanhar meu pedido
      </Link>
    </Button>
  ) : null;

  let content: ReactNode;
  if (confirm.isSuccess) {
    content = (
      <div className="grid gap-4" data-testid="confirm-success">
        <CheckCircle2 className="size-9 text-primary" aria-hidden />
        <h1 className="text-xl font-extrabold">E-mail confirmado!</h1>
        <p className="text-sm text-muted-foreground" role="status">
          Seu pedido entrou na fila de análise. A análise é feita por pessoas e não temos um prazo fixo.
        </p>
        {trackLink ?? (
          <p className="rounded-md bg-secondary p-3 text-sm text-primary" role="note">
            Para acompanhar, use o link «Acompanhar meu pedido» da tela em que você fez o pedido.
          </p>
        )}
      </div>
    );
  } else if (invalid) {
    content = (
      <div className="grid gap-4" data-testid="confirm-invalid">
        <XCircle className="size-9 text-destructive" aria-hidden />
        <h1 className="text-xl font-extrabold">Link inválido ou vencido</h1>
        <p className="text-sm text-muted-foreground">
          Este link de confirmação não vale mais: ele vence em {String(VERIFY_LINK_HOURS)} horas, só funciona uma vez e é trocado a cada
          reenvio. Se você já confirmou, o pedido está em análise.
        </p>
        {trackLink ?? (
          <p className="text-sm text-muted-foreground">
            Para pedir um novo e-mail de confirmação, abra «Acompanhar meu pedido» na tela em que você fez o pedido.
          </p>
        )}
        <Button asChild size="lg" variant={trackLink ? "outline" : "default"} className="w-full">
          <Link to="/comecar">Voltar ao cadastro</Link>
        </Button>
      </div>
    );
  } else {
    content = (
      <div className="grid gap-4" data-testid="confirm-ready">
        <Mail className="size-9 text-primary" aria-hidden />
        <h1 className="text-xl font-extrabold">Confirme seu e-mail</h1>
        <p className="text-sm text-muted-foreground">
          Falta só um passo: confirme que este e-mail é seu para o pedido de cadastro do grupo entrar na fila de análise da equipe.
        </p>
        {confirm.isError && (
          <p className="text-sm text-destructive" role="alert">
            {confirmErrorMessage(confirm.error)}
          </p>
        )}
        <Button size="lg" className="w-full" disabled={confirm.isPending} onClick={() => confirm.mutate()}>
          {confirm.isPending ? (
            <>
              <Loader2 className="animate-spin" aria-hidden /> Confirmando…
            </>
          ) : (
            "Confirmar meu e-mail"
          )}
        </Button>
        <p className="text-xs text-muted-foreground">Não foi você que fez o pedido? É só ignorar: nada acontece sem esta confirmação.</p>
      </div>
    );
  }

  return (
    <PublicShell narrow>
      <Card className={`p-6 ${ENTER_ANIMATION}`}>
        <p className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
          <Mail className="size-4" aria-hidden /> Confirmação de e-mail
        </p>
        {content}
      </Card>
    </PublicShell>
  );
}
