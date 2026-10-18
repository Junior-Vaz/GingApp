import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { ImageUploader } from "@/components/painel/image-upload-field";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { reaisToCents } from "@/modules/eventos/event-schema";
import { useEventOptions } from "./api";
import type { Draft } from "./builder";
import { SelectField, TextAreaField, TextField, ToggleRow } from "./form-controls";
import { PIX_KEY_TYPE_LABEL, type PaymentMode, type PixKeyType } from "./types";

interface SettingsTabProps {
  draft: Draft;
  readOnly: boolean;
  onChange: (patch: Partial<Draft>) => void;
  /** Mensagens (cliente + servidor) da aba. */
  errors: string[];
  /** Título do evento ligado (quando o evento não está entre os carregados no seletor). */
  eventTitle: string | null;
}

function Group({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="grid grid-cols-[minmax(0,1fr)] gap-4 rounded-xl border bg-card p-4">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

const PAYMENT_OPTIONS: {
  mode: PaymentMode;
  label: string;
  description: string;
  disabled?: boolean;
}[] = [
  { mode: "NONE", label: "Sem pagamento", description: "Inscrição gratuita." },
  {
    mode: "PIX_MANUAL",
    label: "Pix manual",
    description:
      "O inscrito paga pela sua chave Pix e anexa o comprovante; você confere e confirma.",
  },
  {
    mode: "PIX_AUTO",
    label: "Pix automático",
    description: "Cobrança e baixa automáticas pelo Mercado Pago.",
    disabled: true,
  },
];

/** O que o inscrito verá na tela de pagamento (prévia do modo Pix manual). */
export function PixPreview({ draft }: { draft: Draft }) {
  const cents = reaisToCents(draft.price);
  return (
    <div
      className="grid gap-1.5 rounded-lg border border-dashed bg-muted/40 p-3 text-sm"
      data-testid="pix-preview"
    >
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Info className="size-3.5" aria-hidden /> Prévia: o que o inscrito vai ver
      </p>
      <p>
        Valor da inscrição: <strong>{cents ? formatCurrency(cents) : "—"}</strong>
      </p>
      <p className="break-all">
        Chave Pix ({PIX_KEY_TYPE_LABEL[draft.pixKeyType]}):{" "}
        <strong>{draft.pixKey.trim() || "—"}</strong>
      </p>
      <p>
        Favorecido: <strong>{draft.pixBeneficiary.trim() || "—"}</strong>
      </p>
      <p className="text-muted-foreground">
        Depois de pagar, anexe o comprovante para concluir a inscrição.
      </p>
    </div>
  );
}

/** Aba "Configurações": informações, período e vagas, pagamento, aprovação, mensagem de confirmação e termo LGPD. */
export function SettingsTab({ draft, readOnly, onChange, errors, eventTitle }: SettingsTabProps) {
  const events = useEventOptions();
  const eventList = events.data ?? [];
  const linkedMissing =
    draft.eventId !== null && !eventList.some((e) => String(e.id) === String(draft.eventId));

  return (
    <fieldset
      disabled={readOnly}
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 border-0 p-0"
    >
      {errors.length > 0 && (
        <ul
          role="alert"
          className="grid gap-1 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}

      <Group title="Informações">
        <TextField
          label="Título do formulário"
          value={draft.title}
          maxLength={120}
          onChange={(e) => onChange({ title: e.target.value })}
        />
        <TextAreaField
          label="Texto de apresentação"
          hint="Aparece no topo da página de inscrição, junto com o banner."
          rows={5}
          maxLength={5000}
          value={draft.intro}
          onChange={(e) => onChange({ intro: e.target.value })}
        />
        <ImageUploader
          label="Banner"
          value={draft.bannerUrl}
          onChange={(bannerUrl) => onChange({ bannerUrl })}
          previewAlt="Pré-visualização do banner"
          disabled={readOnly}
          description="Aparece no topo da página e na pré-visualização do WhatsApp. JPEG, PNG ou WebP até 5 MB."
        />
        <SelectField
          label="Evento"
          hint="Opcional. Ligado a um evento, as inscrições confirmadas viram participantes dele."
          value={draft.eventId === null ? "" : String(draft.eventId)}
          onChange={(e) => {
            const chosen = eventList.find((ev) => String(ev.id) === e.target.value);
            onChange({ eventId: chosen ? chosen.id : null });
          }}
        >
          <option value="">Sem evento (formulário avulso)</option>
          {linkedMissing && draft.eventId !== null && (
            <option value={String(draft.eventId)}>
              {eventTitle ?? `Evento ${String(draft.eventId)}`}
            </option>
          )}
          {eventList.map((event) => (
            <option key={String(event.id)} value={String(event.id)}>
              {event.title}
            </option>
          ))}
        </SelectField>
      </Group>

      <Group title="Período e vagas" description="Deixe vazio para não limitar.">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Abre em"
            type="datetime-local"
            value={draft.opensAt}
            onChange={(e) => onChange({ opensAt: e.target.value })}
          />
          <TextField
            label="Encerra em"
            type="datetime-local"
            value={draft.closesAt}
            onChange={(e) => onChange({ closesAt: e.target.value })}
          />
        </div>
        <TextField
          label="Limite de inscrições"
          type="number"
          inputMode="numeric"
          min={1}
          placeholder="Sem limite"
          value={draft.maxSubmissions}
          onChange={(e) => onChange({ maxSubmissions: e.target.value })}
        />
        <ToggleRow
          label="Aceitar lista de espera"
          description="Quando o limite for atingido, novas pessoas entram na fila e você promove quando abrir vaga."
          checked={draft.allowWaitlist}
          disabled={readOnly}
          onCheckedChange={(allowWaitlist) => onChange({ allowWaitlist })}
        />
      </Group>

      <Group title="Pagamento">
        <div role="radiogroup" aria-label="Forma de pagamento" className="grid gap-2">
          {PAYMENT_OPTIONS.map((opt) => {
            const selected = draft.paymentMode === opt.mode;
            return (
              <label
                key={opt.mode}
                className={cn(
                  "flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 focus-within:ring-2 focus-within:ring-ring",
                  selected && "border-primary bg-primary/5 ring-1 ring-primary",
                  opt.disabled && "cursor-not-allowed opacity-60",
                )}
              >
                <input
                  type="radio"
                  name="payment-mode"
                  className="mt-1 size-4 accent-[var(--color-primary)]"
                  checked={selected}
                  disabled={opt.disabled || readOnly}
                  onChange={() => onChange({ paymentMode: opt.mode })}
                />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {opt.label}
                    {opt.disabled && <Badge variant="secondary">Em breve</Badge>}
                  </span>
                  <span className="block text-xs text-muted-foreground">{opt.description}</span>
                </span>
              </label>
            );
          })}
        </div>

        {draft.paymentMode === "PIX_MANUAL" && (
          <div className="grid gap-4">
            <TextField
              label="Valor da inscrição (R$)"
              inputMode="decimal"
              placeholder="25,00"
              value={draft.price}
              onChange={(e) => onChange({ price: e.target.value })}
              error={
                draft.price.trim() && reaisToCents(draft.price) === null
                  ? "Informe o valor em reais, ex.: 25,00."
                  : null
              }
            />
            <div className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
              <SelectField
                label="Tipo da chave Pix"
                value={draft.pixKeyType}
                onChange={(e) => onChange({ pixKeyType: e.target.value as PixKeyType })}
              >
                {(Object.keys(PIX_KEY_TYPE_LABEL) as PixKeyType[]).map((type) => (
                  <option key={type} value={type}>
                    {PIX_KEY_TYPE_LABEL[type]}
                  </option>
                ))}
              </SelectField>
              <TextField
                label="Chave Pix"
                hint="A chave Pix fica visível a todos enquanto o formulário estiver aberto. Prefira uma chave aleatória."
                value={draft.pixKey}
                maxLength={140}
                onChange={(e) => onChange({ pixKey: e.target.value })}
              />
            </div>
            <TextField
              label="Nome do favorecido"
              value={draft.pixBeneficiary}
              maxLength={120}
              onChange={(e) => onChange({ pixBeneficiary: e.target.value })}
            />
            <PixPreview draft={draft} />
          </div>
        )}
      </Group>

      <Group title="Aprovação">
        <ToggleRow
          label="Eu aprovo cada inscrição"
          description="Ligado: a inscrição só vira confirmada quando você aprovar. Desligado: confirma sozinha quando o pagamento for confirmado."
          checked={draft.requireApproval}
          disabled={readOnly}
          onCheckedChange={(requireApproval) => onChange({ requireApproval })}
        />
        <TextAreaField
          label="Mensagem de confirmação"
          hint="Mostrada ao inscrito depois de enviar (ex.: instruções, local e horário)."
          rows={3}
          maxLength={2000}
          value={draft.confirmationMessage}
          onChange={(e) => onChange({ confirmationMessage: e.target.value })}
        />
      </Group>

      <Group title="Privacidade (LGPD)">
        <TextAreaField
          label="Texto do termo de consentimento"
          hint={
            draft.consentVersion !== null
              ? `Versão atual do texto: ${String(draft.consentVersion)}. Mudar o texto gera uma nova versão.`
              : "O aceite do inscrito é registrado com a data e a versão deste texto."
          }
          rows={5}
          maxLength={5000}
          value={draft.consentText}
          onChange={(e) => onChange({ consentText: e.target.value })}
        />
        <TextField
          label="Guardar os dados por (meses)"
          type="number"
          inputMode="numeric"
          min={1}
          max={120}
          placeholder="12"
          hint="Depois desse prazo, as respostas e os anexos são apagados."
          value={draft.retentionMonths}
          onChange={(e) => onChange({ retentionMonths: e.target.value })}
        />
      </Group>
    </fieldset>
  );
}
