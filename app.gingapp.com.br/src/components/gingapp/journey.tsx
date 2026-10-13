import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Award, Download, Loader2, Network, Route } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { errorMessage } from "@/lib/api";
import { downloadCertificatePdf } from "@/lib/certificate-pdf";
import { dayOnly, fmt, readableIconColor, softenColor, verificationUrl } from "@/lib/format";
import { useSessionUser } from "@/lib/session";
import { STAFF_ROLE_LABEL } from "@/lib/roles";
import { buildTimeline, graduationCardLabel } from "@/lib/derive";
import { readJourneyView, storeJourneyView, type JourneyView } from "@/lib/hierarchy";
import {
  useAttendance,
  useCertificates,
  useFicha,
  useGraduations,
  useHierarchy,
  useMyRoles,
  useMyStudent,
  usePassport,
  type Certificate,
} from "@/lib/queries";
import { MyClasses } from "./class-parts";
import { GraduationCard, RopeRuler } from "./graduation-parts";
import { HierarchyCanvas } from "./hierarchy";
import { Rope } from "./rope";
import { PageHeading, SectionHeading, StateMessage, TwoWayToggle } from "./shared";

const JOURNEY_VIEWS = [
  { value: "timeline", label: "Linha do tempo", icon: Route },
  { value: "hierarchy", label: "Hierarquia", icon: Network },
] as const;

export function QrDialog({
  open,
  onOpenChange,
  title,
  description,
  url,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  url: string | null;
}) {
  const [dataUrl, setDataUrl] = useState("");

  useEffect(() => {
    if (!open || !url) {
      setDataUrl("");
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(url, { margin: 1, width: 240, color: { dark: "#16181d", light: "#ffffff" } })
      .then((value) => {
        if (!cancelled) setDataUrl(value);
      })
      .catch(() => {
        if (!cancelled) setDataUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [open, url]);

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copiado!");
    } catch {
      toast.info("Não foi possível copiar automaticamente.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        <div className="text-center">
          {dataUrl && <img src={dataUrl} alt="QR Code de verificação" width={192} height={192} className="mx-auto h-48 w-48 rounded-lg" />}
          {url && <p className="mt-3 break-all text-xs text-muted-foreground">{url}</p>}
        </div>
        <Button variant="outline" onClick={copy}>
          Copiar link
        </Button>
      </DialogContent>
    </Dialog>
  );
}

/** "Baixar PDF" de um certificado: busca autenticada do arquivo, com estado de carregando e erro na própria linha. */
function CertificatePdfButton({ certificate }: { certificate: Certificate }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function download() {
    setLoading(true);
    setError("");
    try {
      await downloadCertificatePdf(certificate.id);
    } catch (err) {
      setError(errorMessage(err, "Não foi possível baixar o PDF. Verifique sua conexão."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="outline" size="sm" onClick={download} disabled={loading}>
        {loading ? <Loader2 className="animate-spin" /> : <Download />}
        {loading ? "Baixando…" : "Baixar PDF"}
      </Button>
      {error && (
        <p className="max-w-48 text-right text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function JourneyPage() {
  const [certificate, setCertificate] = useState<Certificate | null>(null);
  const [view, setView] = useState<JourneyView>(readJourneyView);
  const changeView = (next: JourneyView) => {
    setView(next);
    storeJourneyView(next);
  };
  const user = useSessionUser();
  const { student, isLoading: loadingStudent, error: studentError } = useMyStudent();
  const graduations = useGraduations(student?.id);
  const certificates = useCertificates();
  const hierarchy = useHierarchy(); // mesma consulta da aba Hierarquia: alimenta a régua de cordas do sistema
  const passport = usePassport();
  const roles = useMyRoles();
  const ficha = useFicha(); // origem/reconhecimento das cordas; se falhar, a Jornada segue só com as graduações do aluno
  const attendance = useAttendance({ limit: 1 }); // só precisa do % dos 30 dias (agregado no servidor)

  const list = graduations.data ?? [];
  const current = list[0] ?? null;
  const timeline = buildTimeline(list, ficha.data);
  const percent = attendance.data?.last30dPercent ?? null;
  const stats = passport.data?.stats;
  const loading = loadingStudent || graduations.isLoading;
  const error = studentError ?? graduations.error;

  const toggle = <TwoWayToggle value={view} options={JOURNEY_VIEWS} onChange={changeView} label="Modo de visualização da jornada" />;

  // Modo Hierarquia: canvas em tela cheia (sem título nem rolagem; o alternador flutua sobre ele).
  if (view === "hierarchy") return <HierarchyCanvas viewToggle={toggle} />;

  return (
    <>
      <PageHeading title="Minha jornada" subtitle="Sua história na capoeira, um passo de cada vez." />
      <div className="view-bar">{toggle}</div>
      {error ? (
        <StateMessage tone="error">{errorMessage(error, "Não foi possível carregar sua jornada.")}</StateMessage>
      ) : !loading && !student ? (
        <StateMessage>Nenhum aluno vinculado a esta conta.</StateMessage>
      ) : (
        <>
          <div className="journey-top">
            <GraduationCard
              label={graduationCardLabel(student, user?.id)}
              name={current ? current.graduationLevel.name : null}
              rope={current ? current.graduationLevel : null}
              loading={loading}
              roleLabel={roles[0] ? STAFF_ROLE_LABEL[roles[0]] : null}
              subtitle={
                [
                  passport.data?.organization.name,
                  current ? `Desde ${fmt(dayOnly(current.graduatedAt), "MMMM 'de' yyyy")}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "Nenhuma graduação registrada ainda."
              }
            />
            <div className="py-4">
              <div className="flex justify-between text-sm">
                <strong>Sua constância faz a diferença</strong>
                <span className="text-primary">{percent === null ? "—" : `${Math.round(percent)}%`}</span>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${Math.min(100, Math.round(percent ?? 0))}%` }} />
              </div>
              <p className="text-xs text-muted-foreground">
                {percent === null ? "Sem registros de presença ainda." : "de frequência nos últimos 30 dias · Continue em movimento!"}
              </p>
              <div className="flex gap-5 mt-5 text-xs">
                <span>
                  <strong className="text-primary">{stats?.rodas ?? 0}</strong> {stats?.rodas === 1 ? "roda" : "rodas"}
                </span>
                <span>
                  <strong className="text-primary">{stats?.eventos ?? 0}</strong> {stats?.eventos === 1 ? "evento" : "eventos"}
                </span>
                <span>
                  <strong className="text-primary">{stats?.graduacoes ?? list.length}</strong> graduações
                </span>
              </div>
            </div>
          </div>
          <section className="content-band">
            <h2>Cada encontro conta uma história</h2>
            {(hierarchy.data?.levels.length ?? 0) > 0 && (
              <RopeRuler levels={hierarchy.data?.levels ?? []} currentOrder={current?.graduationLevel.order ?? null} />
            )}
            {timeline.length > 0 ? (
              <div className="timeline">
                {timeline.map((item) => {
                  const itemColor = softenColor(item.graduationLevel.color);
                  return (
                    <article key={item.id} className="timeline-item">
                      <div
                        className="timeline-dot"
                        style={itemColor ? { background: itemColor, color: readableIconColor(itemColor) } : undefined}
                      >
                        <Award />
                      </div>
                      <time>{fmt(dayOnly(item.graduatedAt), "MMMM 'de' yyyy")}</time>
                      <div className="timeline-rope">
                        <Rope {...item.graduationLevel} orientation="horizontal" length={52} thickness={12} />
                        <h3>{item.graduationLevel.name}</h3>
                      </div>
                      {(item.originGroup || item.recognized) && (
                        <p className="mt-1 flex flex-wrap gap-1" data-testid="timeline-origin">
                          {item.originGroup && <span className="badge">Corda de origem — {item.originGroup}</span>}
                          {item.recognized && <span className="badge">Reconhecida pelo grupo</span>}
                        </p>
                      )}
                      {item.notes && <p>{item.notes}</p>}
                    </article>
                  );
                })}
              </div>
            ) : (
              <StateMessage>{loading ? "Carregando…" : "Nenhuma graduação registrada ainda."}</StateMessage>
            )}
          </section>
          <MyClasses />
          <section className="content-band">
            <SectionHeading title="Meus certificados" />
            {certificates.isLoading ? (
              <StateMessage>Carregando…</StateMessage>
            ) : certificates.error ? (
              <StateMessage tone="error">{errorMessage(certificates.error, "Não foi possível carregar os certificados.")}</StateMessage>
            ) : (certificates.data ?? []).length === 0 ? (
              <StateMessage>Nenhum certificado emitido ainda.</StateMessage>
            ) : (
              <div className="flex flex-col gap-4">
                {(certificates.data ?? []).map((item) => (
                  <div key={item.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                    <div className="flex gap-3 items-center">
                      <Award className="text-primary" />
                      <div>
                        <h3 className="font-semibold text-sm">{item.title}</h3>
                        <p className="text-xs text-muted-foreground mt-1">
                          {item.issuedAt ? fmt(dayOnly(item.issuedAt), "dd/MM/yyyy") : "—"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <CertificatePdfButton certificate={item} />
                      <Button variant="outline" size="sm" onClick={() => setCertificate(item)}>
                        QR Code
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
          <QrDialog
            open={certificate !== null}
            onOpenChange={(open) => {
              if (!open) setCertificate(null);
            }}
            title={certificate?.title ?? "Certificado"}
            description="Escaneie para validar a autenticidade deste certificado."
            url={certificate ? verificationUrl(certificate.verificationCode) : null}
          />
        </>
      )}
    </>
  );
}
