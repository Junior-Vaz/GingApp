import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { CircleCheck, Loader2, MapPin } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api";
import { dayOnly, fmt, isSameDay, startOfToday } from "@/lib/format";
import {
  GEO_AVAILABLE_KEY,
  GEO_CHECKIN_SECTION_ID,
  geoCheckinErrorMessage,
  geoOptionKey,
  pendingGeoOptions,
  registerGeoCheckin,
  useGeoCheckinAvailable,
  type GeoCheckinOption,
} from "@/lib/geo-checkin";
import { useMyStudent } from "@/lib/queries";

export const GEO_PRIVACY_TEXT = "Sua localização é usada só para confirmar que você está na aula e não é guardada.";

function whenLabel(option: GeoCheckinOption): string {
  const day = dayOnly(option.date);
  const dayText = isSameDay(day, startOfToday()) ? "Hoje" : fmt(day, "EEE, dd/MM");
  const time = option.startTime || option.endTime ? `${option.startTime ?? "—"}–${option.endTime ?? "—"}` : null;
  return [dayText, time].filter(Boolean).join(" · ");
}

/**
 * Seção "Check-in por localização" da página de check-in. Lista as aulas em janela (GET /attendance/geo-checkin/available)
 * do usuário e dos dependentes; "Estou aqui" lê a posição UMA vez (só no toque) e confirma a presença. A posição nunca é
 * guardada aqui: não há estado, storage nem log com coordenadas.
 */
export function GeoCheckinSection() {
  const queryClient = useQueryClient();
  const { students, isSuccess: studentsReady } = useMyStudent();
  const available = useGeoCheckinAvailable(studentsReady && students.length > 0);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());

  const options = available.data ?? [];
  // Nome do aluno só quando há mais de um (dependentes) nas opções ou na conta.
  const showStudent = students.length > 1 || new Set(options.map((option) => option.studentId)).size > 1;

  async function checkIn(option: GeoCheckinOption) {
    const key = geoOptionKey(option);
    setBusyKey(key);
    setErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    try {
      const result = await registerGeoCheckin(option);
      setDone((current) => new Set(current).add(key));
      toast.success(result.alreadyCheckedIn ? "Sua presença já estava registrada." : "Presença registrada! Bom treino.");
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: GEO_AVAILABLE_KEY }),
        queryClient.invalidateQueries({ queryKey: ["attendance"] }),
        queryClient.invalidateQueries({ queryKey: ["passport"] }),
        queryClient.invalidateQueries({ queryKey: ["ranking"] }),
      ]);
    } catch (failure) {
      const message = geoCheckinErrorMessage(failure);
      setErrors((current) => ({ ...current, [key]: message }));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section
      id={GEO_CHECKIN_SECTION_ID}
      aria-labelledby="geo-checkin-title"
      data-testid="geo-checkin-section"
      className="mx-auto mt-8 flex max-w-md scroll-mt-24 flex-col gap-3"
    >
      <div>
        <h2 id="geo-checkin-title" className="text-base font-bold">
          Check-in por localização
        </h2>
        <p className="text-sm text-muted-foreground">Quando a aula estiver perto, toque em “Estou aqui” para confirmar sua presença.</p>
      </div>

      {available.isLoading ? (
        <p className="text-sm text-muted-foreground" role="status">
          Procurando aulas para check-in…
        </p>
      ) : available.error ? (
        <div className="flex flex-col items-start gap-2" role="alert">
          <p className="text-sm text-destructive">{errorMessage(available.error, "Não foi possível carregar os check-ins por localização.")}</p>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => void available.refetch()}>
            Tentar de novo
          </Button>
        </div>
      ) : options.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="geo-checkin-empty">
          Nenhuma aula com check-in por localização disponível agora. Ele aparece aqui a partir de 2 horas antes da aula, nas turmas que usam
          esse recurso.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {options.map((option) => {
            const key = geoOptionKey(option);
            const registered = option.alreadyCheckedIn || done.has(key);
            const busy = busyKey === key;
            const error = errors[key];
            const label = `Estou aqui: ${option.className}${showStudent ? ` (${option.studentName})` : ""}`;
            return (
              <li key={key} data-testid="geo-checkin-item" className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
                <div className="min-w-0">
                  <p className="font-semibold leading-tight">{option.className}</p>
                  <p className="text-xs text-muted-foreground">{whenLabel(option)}</p>
                  {showStudent && <p className="text-xs font-medium">{option.studentName}</p>}
                </div>
                {registered ? (
                  <p className="flex min-h-11 items-center gap-2 text-sm font-semibold text-primary" role="status">
                    <CircleCheck size={18} aria-hidden="true" />
                    Presença registrada
                  </p>
                ) : (
                  <>
                    <Button
                      type="button"
                      className="min-h-11 w-full"
                      aria-label={label}
                      aria-busy={busy}
                      disabled={busyKey !== null}
                      onClick={() => void checkIn(option)}
                    >
                      {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <MapPin aria-hidden="true" />}
                      {busy ? "Obtendo sua localização…" : "Estou aqui"}
                    </Button>
                    <p className="text-xs text-muted-foreground">{GEO_PRIVACY_TEXT}</p>
                  </>
                )}
                {error && (
                  <p className="text-sm text-destructive" role="alert">
                    {error}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * Cartão discreto da Home: "Check-in disponível: <turma>" que leva à seção. Só aparece quando há opção em janela ainda sem
 * presença; sem aluno na conta nem consulta o servidor.
 */
export function GeoCheckinHomeCard() {
  const { students, isSuccess: studentsReady } = useMyStudent();
  const available = useGeoCheckinAvailable(studentsReady && students.length > 0);
  const pending = pendingGeoOptions(available.data);
  if (pending.length === 0) return null;

  const classNames = [...new Set(pending.map((option) => option.className))];
  const first = classNames[0]!;
  const others = classNames.length - 1;
  return (
    <Link
      to="/checkin"
      hash={GEO_CHECKIN_SECTION_ID}
      data-testid="geo-checkin-home-card"
      className="mb-4 flex min-h-11 items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 no-underline shadow-sm"
    >
      <span className="flex size-9 flex-none items-center justify-center rounded-full bg-secondary text-primary" aria-hidden="true">
        <MapPin size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold leading-tight">Check-in disponível: {first}</span>
        <span className="block text-xs text-muted-foreground">
          {others > 0 ? `e mais ${others} ${others === 1 ? "turma" : "turmas"} · ` : ""}Toque para confirmar sua presença
        </span>
      </span>
    </Link>
  );
}
