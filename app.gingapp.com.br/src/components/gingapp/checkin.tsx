import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CircleCheck, QrCode, ScanLine, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/api";
import { normalizeCheckinInput, parseCheckinToken, submitCheckin, type CheckinResult } from "@/lib/checkin";
import { useMyStudent } from "@/lib/queries";
import { PageHeading } from "./shared";

/** BarcodeDetector ainda nao esta nos tipos do TypeScript (so Chromium/Android e Safari recentes). */
interface BarcodeDetectorLike {
  detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>>;
}
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

function getBarcodeDetector(): BarcodeDetectorCtor | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector ?? null;
}

/** Leitura por camera so existe com BarcodeDetector + getUserMedia; sem isso a tela cai no campo de digitar. */
function canScan(): boolean {
  return getBarcodeDetector() !== null && typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

const SCAN_INTERVAL_MS = 300;

export function CheckinPage({ initialToken = "" }: { initialToken?: string }) {
  const queryClient = useQueryClient();
  const { students, student, selectStudent, isLoading: studentLoading } = useMyStudent();
  const [code, setCode] = useState(() => normalizeCheckinInput(initialToken));
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<CheckinResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanSupported = canScan();

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);

  // O fluxo da camera e sempre encerrado ao desmontar (senao a luz da camera fica acesa).
  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    },
    [],
  );

  async function startCamera() {
    setCameraError(null);
    const Detector = getBarcodeDetector();
    if (!Detector || !navigator.mediaDevices?.getUserMedia) return;
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      setScanning(true);
    } catch {
      setCameraError("Não foi possível acessar a câmera. Autorize o uso da câmera ou digite o código.");
    }
  }

  // Com a camera aberta: liga o stream no <video> e le um QR a cada intervalo. Ao achar, PARA a camera e
  // so preenche o codigo - a presenca so e registrada quando a pessoa toca em "Confirmar presença".
  useEffect(() => {
    if (!scanning) return;
    const video = videoRef.current;
    const stream = streamRef.current;
    const Detector = getBarcodeDetector();
    if (!video || !stream || !Detector) return;
    video.srcObject = stream;
    void video.play?.().catch(() => undefined);
    const detector = new Detector({ formats: ["qr_code"] });
    let busy = false;
    const timer = setInterval(() => {
      if (busy) return;
      busy = true;
      detector
        .detect(video)
        .then((codes) => {
          const raw = codes.find((item) => item.rawValue)?.rawValue;
          if (!raw) return;
          setCode(normalizeCheckinInput(raw));
          setResult(null);
          setError(null);
          stopCamera();
        })
        .catch(() => undefined)
        .finally(() => {
          busy = false;
        });
    }, SCAN_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [scanning, stopCamera]);

  async function confirm(event: FormEvent) {
    event.preventDefault();
    setResult(null);
    setError(null);
    const parsed = parseCheckinToken(code);
    if (!parsed) {
      setError("Código inválido. Ele começa com E ou L, por exemplo E12-K7QXM3PA2B.");
      return;
    }
    stopCamera();
    setPending(true);
    try {
      // Envia o aluno atualmente selecionado (proprio ou dependente) quando conhecido.
      setResult(await submitCheckin(parsed, student?.id));
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["attendance"] }),
        queryClient.invalidateQueries({ queryKey: ["events"] }),
        queryClient.invalidateQueries({ queryKey: ["calendar"] }),
        queryClient.invalidateQueries({ queryKey: ["participants"] }),
        queryClient.invalidateQueries({ queryKey: ["passport"] }),
      ]);
    } catch (failure) {
      setError(errorMessage(failure, "Não foi possível confirmar a presença. Tente novamente."));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <PageHeading title="Check-in" subtitle="Leia o QR code do evento ou da aula, ou digite o código, para confirmar sua presença." />
      <form className="mx-auto flex max-w-md flex-col gap-4" onSubmit={confirm} noValidate>
        {students.length > 1 && (
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Aluno
            <select
              className="select-field"
              aria-label="Aluno do check-in"
              value={student?.id ?? ""}
              onChange={(event) => selectStudent(Number(event.target.value))}
            >
              {students.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {scanSupported ? (
          scanning ? (
            <div className="flex flex-col gap-2">
              <video ref={videoRef} className="w-full rounded-lg bg-black" playsInline muted aria-label="Câmera para ler o QR code" />
              <Button type="button" variant="outline" onClick={stopCamera}>
                <X />
                Fechar câmera
              </Button>
            </div>
          ) : (
            <Button type="button" variant="outline" onClick={() => void startCamera()}>
              <ScanLine />
              Ler QR code
            </Button>
          )
        ) : (
          <p className="text-sm text-muted-foreground" role="status">
            A leitura do QR code pela câmera não está disponível neste aparelho ou navegador. Digite o código abaixo.
          </p>
        )}
        {cameraError && (
          <p className="text-sm text-destructive" role="alert">
            {cameraError}
          </p>
        )}

        <label className="flex flex-col gap-1 text-sm font-semibold">
          Digite o código
          <Input
            value={code}
            onChange={(event) => {
              setCode(event.target.value);
              setResult(null);
              setError(null);
            }}
            placeholder="E12-K7QXM3PA2B"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
          />
        </label>

        {/* Espera o aluno ativo ser conhecido: sem ele o servidor nao sabe qual dependente confirmar. */}
        <Button type="submit" disabled={pending || studentLoading || code.trim() === ""}>
          <QrCode />
          {pending ? "Confirmando…" : "Confirmar presença"}
        </Button>

        {result && (
          <div className="flex items-start gap-2 rounded-lg bg-muted p-3 text-sm" role="status">
            <CircleCheck className="mt-0.5 shrink-0 text-primary" size={18} aria-hidden="true" />
            <div>
              <strong>{result.alreadyCheckedIn ? "Você já tinha feito check-in." : "Presença confirmada!"}</strong>
              <p className="text-muted-foreground">
                {result.kind === "EVENTO" ? "Evento" : "Aula"}
                {result.alreadyCheckedIn ? ": sua presença já estava registrada." : ": sua presença foi registrada."}
              </p>
            </div>
          </div>
        )}
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </form>
    </>
  );
}
