import { useState } from "react";
import { Check, Copy, Fingerprint, QrCode } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { usePersonCode } from "@/lib/queries";
import { CardHeader } from "./profile-parts";

/**
 * Cartão "Meu código GingApp" (ficha única do capoeirista). Sem ficha (404 PERSON_NOT_FOUND),
 * erro ou carregando: não renderiza nada, para nunca quebrar o Perfil.
 */
export function PersonCodeCard() {
  const { data } = usePersonCode();
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);

  if (!data?.gingappCode) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(data!.gingappCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Não foi possível copiar. Selecione o código e copie manualmente.");
    }
  }

  return (
    <section className="pf-card" data-testid="person-code-card" aria-labelledby="person-code-title">
      <CardHeader icon={Fingerprint} title="Meu código GingApp" id="person-code-title" />
      <p className="pf-hint">
        Este é o seu código único no GingApp. Ao entrar em outro grupo, informe este código para levar sua ficha.
      </p>
      <div className="pf-code">
        <span className="pf-code-label">Seu código</span>
        <p className="pf-code-value" data-testid="person-code-value">
          {data.gingappCode}
        </p>
      </div>
      <div className="pf-code-actions">
        <Button type="button" variant="soft" className="pf-action" onClick={() => void copy()}>
          {copied ? <Check /> : <Copy />}
          {copied ? "Copiado" : "Copiar"}
        </Button>
        {data.qrDataUrl && (
          <Button type="button" variant="outline" className="pf-action" aria-expanded={showQr} onClick={() => setShowQr((v) => !v)}>
            <QrCode />
            {showQr ? "Ocultar QR" : "Mostrar QR"}
          </Button>
        )}
      </div>
      {showQr && data.qrDataUrl && (
        <img src={data.qrDataUrl} alt={`QR Code do código GingApp ${data.gingappCode}`} className="pf-qr" />
      )}
    </section>
  );
}
