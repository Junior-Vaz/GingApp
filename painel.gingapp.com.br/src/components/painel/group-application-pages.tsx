import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Award,
  CalendarCheck,
  CheckCircle2,
  Clock,
  Inbox,
  Loader2,
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
  fetchGroupApplicationStatus,
  readApplicationToken,
  type GroupApplicationStatus,
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
  const [submittedToken, setSubmittedToken] = useState<string | null>(null);

  if (submittedToken) {
    return (
      <PublicShell narrow>
        <Card className={`grid gap-4 p-6 ${ENTER_ANIMATION}`} data-testid="application-received">
          <CheckCircle2 className="size-9 text-primary" aria-hidden />
          <h1 className="text-xl font-extrabold">Pedido recebido</h1>
          <p className="text-sm text-muted-foreground">
            Obrigado! A equipe do GingApp vai conferir os dados do seu grupo. A análise é feita por pessoas e não temos um prazo fixo.
          </p>
          <ul className="grid list-disc gap-1.5 pl-5 text-sm">
            <li>Ainda não existe conta nem grupo: eles são criados quando o pedido for aprovado.</li>
            <li>Você pode acompanhar o andamento a qualquer momento pelo botão abaixo. Guardamos o link neste aparelho.</li>
            <li>Se aprovado, você entra no painel com o e-mail e a senha que acabou de criar.</li>
          </ul>
          <Button asChild size="lg" className="w-full">
            <Link to="/comecar/acompanhar/$token" params={{ token: submittedToken }}>
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
          <GroupApplicationForm onSubmitted={(token) => {
            setSubmittedToken(token);
            window.scrollTo({ top: 0 });
          }} />
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

function StatusBody({ data }: { data: GroupApplicationStatus }) {
  const sent = formatDate(data.createdAt);
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
  const query = useQuery({
    queryKey: ["group-application-status", token],
    queryFn: () => fetchGroupApplicationStatus(token),
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
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
  } else if (query.isError || !query.data) {
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
    content = <StatusBody data={query.data} />;
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
