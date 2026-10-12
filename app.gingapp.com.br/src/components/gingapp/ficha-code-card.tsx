import { useState } from "react";
import { Check, Copy, QrCode } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { usePersonCode } from "@/lib/queries";

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
    <section className="content-band" data-testid="person-code-card" aria-labelledby="person-code-title">
      <h2 id="person-code-title">Meu código GingApp</h2>
      <p className="text-xs text-muted-foreground">
        Este é o seu código único no GingApp. Ao entrar em outro grupo, informe este código para levar sua ficha.
      </p>
      <p className="mt-3 select-all font-mono text-2xl font-bold tracking-wider" data-testid="person-code-value">
        {data.gingappCode}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
          {copied ? <Check /> : <Copy />}
          {copied ? "Copiado" : "Copiar"}
        </Button>
        {data.qrDataUrl && (
          <Button type="button" variant="outline" size="sm" aria-expanded={showQr} onClick={() => setShowQr((v) => !v)}>
            <QrCode />
            {showQr ? "Ocultar QR" : "Mostrar QR"}
          </Button>
        )}
      </div>
      {showQr && data.qrDataUrl && (
        <img
          src={data.qrDataUrl}
          alt={`QR Code do código GingApp ${data.gingappCode}`}
          className="mt-4 h-48 w-48 rounded-md border bg-white p-2"
        />
      )}
    </section>
  );
}
