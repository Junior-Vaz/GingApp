import { useState } from "react";
import { StudentPicker } from "@/components/painel/student-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/modules/rodas/native-select";
import { PARTICIPANT_STATUS_LABEL, type ParticipantStatus } from "@/modules/rodas/types";
import type { ParticipantPayload } from "./types";

type Kind = "student" | "guest";
const STATUS_OPTIONS: ParticipantStatus[] = ["CONFIRMED", "INVITED", "DECLINED", "ATTENDED", "CANCELLED"];

interface Props {
  onAdd: (payload: ParticipantPayload) => Promise<unknown>;
}

/** Inscreve um aluno (studentId) OU um convidado (guestName) - nunca os dois (regra do backend). */
export function AddParticipantForm({ onAdd }: Props) {
  const [kind, setKind] = useState<Kind>("student");
  const [studentId, setStudentId] = useState<number | null>(null);
  const [guestName, setGuestName] = useState("");
  const [status, setStatus] = useState<ParticipantStatus>("CONFIRMED");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit() {
    setError("");
    const payload: ParticipantPayload = { status };
    if (kind === "student") {
      if (!studentId) return setError("Selecione um aluno.");
      payload.studentId = studentId;
    } else {
      const name = guestName.trim();
      if (name.length < 2) return setError("Informe o nome do convidado (mínimo 2 caracteres).");
      payload.guestName = name;
    }
    setPending(true);
    try {
      await onAdd(payload);
      setStudentId(null);
      setGuestName("");
    } catch {
      // toast de erro já exibido pelo chamador
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      <p className="text-sm font-semibold">Adicionar participante</p>
      <div className="flex gap-4 text-sm" role="radiogroup" aria-label="Tipo de participante">
        {(["student", "guest"] as const).map((option) => (
          <label key={option} className="flex cursor-pointer items-center gap-2">
            <input type="radio" name="participant-kind" checked={kind === option} onChange={() => setKind(option)} />
            {option === "student" ? "Aluno cadastrado" : "Convidado"}
          </label>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {kind === "student" ? (
          <StudentPicker value={studentId} onChange={(student) => setStudentId(student?.id ?? null)} />
        ) : (
          <div className="grid gap-1.5">
            <Label htmlFor="participant-guest">Nome do convidado</Label>
            <Input id="participant-guest" value={guestName} onChange={(e) => setGuestName(e.target.value)} />
          </div>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="participant-status">Situação</Label>
          <NativeSelect
            id="participant-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as ParticipantStatus)}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {PARTICIPANT_STATUS_LABEL[option]}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button size="sm" disabled={pending} onClick={() => void submit()}>
        {pending ? "Adicionando…" : "Adicionar"}
      </Button>
    </div>
  );
}