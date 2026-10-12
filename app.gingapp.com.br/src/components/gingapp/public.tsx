import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Award, CircleAlert } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { dayOnly, fmt } from "@/lib/format";
import { Brand } from "./app-shell";
import { Avatar } from "./avatar";

interface PublicCertificate {
  title: string;
  studentName: string;
  organizationName: string;
  issuedAt: string | null;
}

interface PublicPassport {
  student: { name: string };
  organization: { name: string };
  unit: { name: string } | null;
  currentGraduation: { name: string } | null;
  stats: { aulas: number; rodas: number; eventos: number; graduacoes: number; certificados: number };
}

function PublicFrame({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 py-10">
      <Brand large />
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{heading}</p>
      {children}
    </div>
  );
}

const cardClass = "flex w-full max-w-sm flex-col items-center gap-3 rounded-lg border border-border bg-card p-8 text-center";

function NotFound({ title, text }: { title: string; text: string }) {
  return (
    <div className={cardClass} role="alert">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <CircleAlert size={26} />
      </span>
      <p className="text-lg font-bold">{title}</p>
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

/** 404 = não existe; qualquer outra falha (rede/5xx) também não valida, mas com mensagem própria. */
function usePublic<T>(path: string) {
  return useQuery({
    queryKey: ["public", path],
    queryFn: () => api.get<T>(path, { skipAuthRedirect: true }),
    retry: false,
  });
}

export function CertificateVerificationPage({ code }: { code: string }) {
  const query = usePublic<PublicCertificate>(`/public/certificates/${encodeURIComponent(code)}`);
  const certificate = query.data;
  const notFound = query.error instanceof ApiError && query.error.status === 404;

  return (
    <PublicFrame heading="GingApp · Verificação de certificado">
      {query.isLoading ? (
        <div className="text-sm text-muted-foreground">Verificando…</div>
      ) : notFound ? (
        <NotFound title="Certificado não encontrado" text="Este código não corresponde a nenhum certificado válido emitido pelo GingApp." />
      ) : query.error ? (
        <NotFound title="Não foi possível verificar" text="Tente novamente em instantes." />
      ) : certificate ? (
        <div className={cardClass}>
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary text-primary">
            <Award size={26} />
          </span>
          <p className="text-xs font-semibold text-primary">Certificado autêntico</p>
          <p className="text-lg font-bold">{certificate.title}</p>
          <p className="text-sm text-muted-foreground">{certificate.studentName}</p>
          <div className="mt-2 w-full space-y-1 border-t border-border pt-4 text-sm text-muted-foreground">
            <p>
              Emitido por <span className="font-medium text-foreground">{certificate.organizationName}</span>
            </p>
            <p>Em {certificate.issuedAt ? fmt(dayOnly(certificate.issuedAt), "dd/MM/yyyy") : "—"}</p>
          </div>
        </div>
      ) : null}
    </PublicFrame>
  );
}

export function PassportVerificationPage({ code }: { code: string }) {
  const query = usePublic<PublicPassport>(`/public/passport/${encodeURIComponent(code)}`);
  const passport = query.data;
  const notFound = query.error instanceof ApiError && query.error.status === 404;
  const stat = (label: string, value: number) => (
    <div key={label} className="rounded-md bg-secondary p-3 text-center">
      <strong className="block text-lg text-primary">{value}</strong>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  );

  return (
    <PublicFrame heading="GingApp · Passaporte do Capoeirista">
      {query.isLoading ? (
        <div className="text-sm text-muted-foreground">Carregando…</div>
      ) : notFound ? (
        <NotFound title="Passaporte não encontrado" text="Este link não corresponde a nenhum Passaporte público ativo." />
      ) : query.error ? (
        <NotFound title="Não foi possível carregar" text="Tente novamente em instantes." />
      ) : passport ? (
        <div className={cardClass}>
          <Avatar name={passport.student.name} size={64} groupName={passport.organization.name} />
          <p className="text-lg font-bold">{passport.student.name}</p>
          <p className="text-sm text-muted-foreground">
            {passport.organization.name}
            {passport.unit ? ` · ${passport.unit.name}` : ""}
          </p>
          {passport.currentGraduation && (
            <span className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-primary">
              {passport.currentGraduation.name}
            </span>
          )}
          <div className="mt-3 grid w-full grid-cols-3 gap-2.5 border-t border-border pt-4">
            {stat("Aulas", passport.stats.aulas)}
            {stat("Rodas", passport.stats.rodas)}
            {stat("Eventos", passport.stats.eventos)}
            {stat("Graduações", passport.stats.graduacoes)}
            {stat("Certificados", passport.stats.certificados)}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Esses números representam histórico, não ranking.</p>
        </div>
      ) : null}
    </PublicFrame>
  );
}
