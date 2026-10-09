import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Award } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { errorMessage } from "@/lib/api";
import { dayOnly, fmt, readableIconColor, softenColor, verificationUrl } from "@/lib/format";
import {
  useAttendance,
  useCertificates,
  useGraduations,
  useMyStudent,
  usePassport,
  type Certificate,
} from "@/lib/queries";
import { PageHeading, SectionHeading, StateMessage } from "./shared";

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

export function JourneyPage() {
  const [certificate, setCertificate] = useState<Certificate | null>(null);
  const { student, isLoading: loadingStudent, error: studentError } = useMyStudent();
  const graduations = useGraduations(student?.id);
  const certificates = useCertificates();
  const passport = usePassport();
  const attendance = useAttendance({ limit: 1 }); // só precisa do % dos 30 dias (agregado no servidor)

  const list = graduations.data ?? [];
  const current = list[0] ?? null;
  const color = softenColor(current?.graduationLevel.color);
  const percent = attendance.data?.last30dPercent ?? null;
  const stats = passport.data?.stats;
  const loading = loadingStudent || graduations.isLoading;
  const error = studentError ?? graduations.error;

  return (
    <>
      <PageHeading title="Minha jornada" subtitle="Sua história na capoeira, um passo de cada vez." />
      {error ? (
        <StateMessage tone="error">{errorMessage(error, "Não foi possível carregar sua jornada.")}</StateMessage>
      ) : !loading && !student ? (
        <StateMessage>Nenhum aluno vinculado a esta conta.</StateMessage>
      ) : (
        <>
          <div className="journey-top">
            <div
              className="graduation-display"
              style={color ? { background: color, color: readableIconColor(color) } : undefined}
            >
              <Award className="rope-icon" style={color ? { color: readableIconColor(color) } : undefined} />
              <div>
                <span className="eyebrow">Minha graduação</span>
                <h2>{current ? current.graduationLevel.name : loading ? "Carregando…" : "Sem graduação"}</h2>
                <p>
                  {[
                    passport.data?.organization.name,
                    current ? `Desde ${fmt(dayOnly(current.graduatedAt), "MMMM 'de' yyyy")}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "Nenhuma graduação registrada ainda."}
                </p>
              </div>
            </div>
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
                  <strong className="text-primary">{stats?.rodas ?? 0}</strong> rodas
                </span>
                <span>
                  <strong className="text-primary">{stats?.eventos ?? 0}</strong> eventos
                </span>
                <span>
                  <strong className="text-primary">{stats?.graduacoes ?? list.length}</strong> graduações
                </span>
              </div>
            </div>
          </div>
          <section className="content-band">
            <h2>Cada encontro conta uma história</h2>
            {list.length > 0 ? (
              <div className="timeline">
                {list.map((item) => {
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
                      <h3>{item.graduationLevel.name}</h3>
                      {item.notes && <p>{item.notes}</p>}
                    </article>
                  );
                })}
              </div>
            ) : (
              <StateMessage>{loading ? "Carregando…" : "Nenhuma graduação registrada ainda."}</StateMessage>
            )}
          </section>
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
                  <div key={item.id} className="flex items-center justify-between gap-4">
                    <div className="flex gap-3 items-center">
                      <Award className="text-primary" />
                      <div>
                        <h3 className="font-semibold text-sm">{item.title}</h3>
                        <p className="text-xs text-muted-foreground mt-1">
                          {item.issuedAt ? fmt(dayOnly(item.issuedAt), "dd/MM/yyyy") : "—"}
                        </p>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setCertificate(item)}>
                      QR Code
                    </Button>
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
