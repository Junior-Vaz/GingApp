import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useSessionUser } from "@/lib/session";
import { NativeSelect } from "@/modules/alunos/native-select";
import { sponsorsErrorMessage, useCampaignMutations } from "./api";
import { SponsorImageField } from "./image-field";
import { RulesNotice } from "./rules-notice";
import { SlidePreview } from "./slide-preview";
import {
  SPONSOR_CATEGORIES,
  SPONSOR_LIMITS,
  campaignPayload,
  campaignToForm,
  checkDestinationUrl,
  contentChanged,
  emptyCampaignForm,
  serverFieldErrors,
  validateCampaignForm,
  type CampaignFieldErrors,
  type CampaignFormState,
  type GroupCampaign,
  type GroupSponsor,
} from "./sponsor-utils";

const FIELDS = [
  "sponsorId",
  "title",
  "text",
  "imageRef",
  "ctaLabel",
  "destinationUrl",
  "category",
  "startsAt",
  "endsAt",
  "price",
  "billingNote",
] as const;
/** Nomes dos campos do corpo da API (para ligar erros do servidor aos campos do formulário). */
const SERVER_FIELD_TO_FORM: Record<string, keyof CampaignFormState> = {
  sponsorId: "sponsorId",
  title: "title",
  text: "text",
  imageRef: "imageRef",
  ctaLabel: "ctaLabel",
  destinationUrl: "destinationUrl",
  category: "category",
  startsAt: "startsAt",
  endsAt: "endsAt",
  priceCents: "price",
  billingNote: "billingNote",
};

function Field({
  id,
  label,
  error,
  hint,
  counter,
  children,
}: {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: ReactNode;
  counter?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {counter && (
          <span className="text-xs text-muted-foreground" aria-live="off">
            {counter}
          </span>
        )}
      </div>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

interface CampaignFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = nova campanha. */
  campaign: GroupCampaign | null;
  sponsors: readonly GroupSponsor[];
}

/**
 * Criar/editar campanha do GRUPO, com pré-visualização fiel do slide (375 px) que atualiza ao vivo. NÃO tem UF nem peso
 * (campanha de grupo). Editar o conteúdo de uma campanha ativa/pausada a devolve a rascunho (aviso explícito).
 */
export function CampaignForm({ open, onOpenChange, campaign, sponsors }: CampaignFormProps) {
  const uid = useId();
  const user = useSessionUser();
  const { create, update } = useCampaignMutations();
  const [form, setForm] = useState<CampaignFormState>(emptyCampaignForm);
  const [original, setOriginal] = useState<CampaignFormState>(emptyCampaignForm);
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<CampaignFieldErrors>({});
  const [general, setGeneral] = useState<string[]>([]);
  const pending = create.isPending || update.isPending;

  useEffect(() => {
    if (!open) return;
    const initial = campaign ? campaignToForm(campaign) : emptyCampaignForm();
    setForm(initial);
    setOriginal(initial);
    setSubmitted(false);
    setServerErrors({});
    setGeneral([]);
  }, [open, campaign]);

  const set = <K extends keyof CampaignFormState>(key: K, value: CampaignFormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setServerErrors((e) => ({ ...e, [key]: undefined }));
  };

  const live = useMemo(() => validateCampaignForm(form), [form]);
  const urlCheck = useMemo(() => (form.destinationUrl.trim() ? checkDestinationUrl(form.destinationUrl) : null), [form.destinationUrl]);
  const hasValue = (k: keyof CampaignFormState) => form[k].trim() !== "";
  // Erros que aparecem ao vivo (assim que há conteúdo); os demais só depois da primeira tentativa de salvar.
  const liveKeys = new Set<keyof CampaignFormState>();
  if (hasValue("destinationUrl")) liveKeys.add("destinationUrl");
  if (hasValue("startsAt") && hasValue("endsAt")) liveKeys.add("endsAt");
  if (hasValue("price")) liveKeys.add("price");
  if (form.billingNote.length > SPONSOR_LIMITS.billingNoteMax) liveKeys.add("billingNote");
  const errorOf = (k: keyof CampaignFormState): string | undefined => serverErrors[k] ?? (submitted || liveKeys.has(k) ? live[k] : undefined);

  const sponsor = sponsors.find((s) => String(s.id) === form.sponsorId);
  const editingLive = campaign !== null && (campaign.status === "ACTIVE" || campaign.status === "PAUSED");
  const willRevert = editingLive && contentChanged(original, form);
  const id = (name: (typeof FIELDS)[number]) => `${uid}-${name}`;
  const describe = (name: (typeof FIELDS)[number], extra?: string) => {
    const ids = [errorOf(name) ? `${id(name)}-error` : "", extra ?? ""].filter(Boolean).join(" ");
    return ids || undefined;
  };

  function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    setGeneral([]);
    const found = validateCampaignForm(form);
    const first = FIELDS.find((f) => found[f]);
    if (first) {
      document.getElementById(id(first))?.focus();
      return;
    }
    const body = campaignPayload(form);
    const reverted = willRevert;
    const onSuccess = () => {
      toast.success(
        campaign
          ? reverted
            ? "Campanha salva e devolvida para rascunho. Ative de novo para ela voltar ao ar."
            : "Campanha atualizada."
          : "Campanha criada como rascunho. Ative quando estiver pronta.",
      );
      onOpenChange(false);
    };
    const onError = (error: unknown) => {
      const server = serverFieldErrors(error, [...FIELDS, ...Object.keys(SERVER_FIELD_TO_FORM)]);
      const mapped: CampaignFieldErrors = {};
      for (const [field, message] of Object.entries(server.fields)) {
        const key = SERVER_FIELD_TO_FORM[field];
        if (key) mapped[key] = message;
      }
      setServerErrors(mapped);
      const hasFieldErrors = Object.keys(mapped).length > 0;
      const message = sponsorsErrorMessage(error, "Não foi possível salvar a campanha.");
      setGeneral(hasFieldErrors ? server.general : [message]);
      if (!hasFieldErrors) toast.error(message);
      else {
        const target = FIELDS.find((f) => mapped[f]);
        if (target) document.getElementById(id(target))?.focus();
      }
    };
    if (campaign) update.mutate({ id: campaign.id, body }, { onSuccess, onError });
    else create.mutate(body, { onSuccess, onError });
  }

  return (
    <Sheet open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <SheetContent className="overflow-y-auto max-sm:w-full max-sm:p-4 sm:max-w-5xl">
        <SheetHeader>
          <SheetTitle>{campaign ? "Editar campanha" : "Nova campanha"}</SheetTitle>
          <SheetDescription>
            A campanha nasce como rascunho e só vai ao ar depois de você ativá-la. Preço e observação são anotações privadas do seu grupo.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={submit} noValidate data-testid="campaign-form" className="grid gap-6 pb-4 sm:px-4 lg:grid-cols-[minmax(0,1fr)_395px]">
          <div className="grid content-start gap-4 lg:order-1">
            <RulesNotice />

            {editingLive && (
              <p className="flex items-start gap-2 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950" data-testid="edit-live-hint">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  Esta campanha está {campaign?.status === "ACTIVE" ? "ativa" : "pausada"}. Mudar o patrocinador, o título, o texto, a imagem, o botão, o
                  link ou a categoria a devolve para <strong>rascunho</strong> e ela precisa ser ativada de novo.
                </span>
              </p>
            )}
            {willRevert && (
              <div role="status" className="rounded-md border border-amber-500 bg-amber-100 p-3 text-sm font-medium text-amber-950" data-testid="revert-warning">
                Atenção: ao salvar, esta campanha volta para rascunho e sai do ar até você ativá-la de novo.
              </div>
            )}

            {general.length > 0 && (
              <div role="alert" className="rounded-md border border-destructive/50 p-3 text-sm text-destructive" data-testid="campaign-form-error">
                {general.map((m) => (
                  <p key={m}>{m}</p>
                ))}
              </div>
            )}

            <Field id={id("sponsorId")} label="Patrocinador *" error={errorOf("sponsorId")}>
              <NativeSelect
                id={id("sponsorId")}
                className="h-11 md:h-9"
                value={form.sponsorId}
                aria-invalid={errorOf("sponsorId") ? true : undefined}
                aria-describedby={describe("sponsorId")}
                onChange={(e) => set("sponsorId", e.target.value)}
              >
                <option value="">Escolha…</option>
                {sponsors.map((s) => (
                  <option key={s.id} value={String(s.id)}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
              {sponsors.length === 0 && (
                <p className="text-xs text-muted-foreground">Você ainda não tem patrocinadores. Cadastre um na aba Patrocinadores antes de criar a campanha.</p>
              )}
            </Field>

            <Field id={id("title")} label="Título *" error={errorOf("title")} counter={`${String(form.title.length)}/${String(SPONSOR_LIMITS.titleMax)}`}>
              <Input
                id={id("title")}
                value={form.title}
                maxLength={SPONSOR_LIMITS.titleMax}
                aria-invalid={errorOf("title") ? true : undefined}
                aria-describedby={describe("title")}
                onChange={(e) => set("title", e.target.value)}
              />
            </Field>

            <Field id={id("text")} label="Texto *" error={errorOf("text")} counter={`${String(form.text.length)}/${String(SPONSOR_LIMITS.textMax)}`}>
              <Textarea
                id={id("text")}
                rows={3}
                value={form.text}
                maxLength={SPONSOR_LIMITS.textMax}
                aria-invalid={errorOf("text") ? true : undefined}
                aria-describedby={describe("text")}
                onChange={(e) => set("text", e.target.value)}
              />
            </Field>

            <SponsorImageField
              label="Imagem de fundo (opcional)"
              value={form.imageRef}
              onChange={(v) => set("imageRef", v)}
              error={errorOf("imageRef")}
              testId="campaign-image"
            />

            <Field
              id={id("ctaLabel")}
              label="Texto do botão *"
              error={errorOf("ctaLabel")}
              counter={`${String(form.ctaLabel.length)}/${String(SPONSOR_LIMITS.ctaMax)}`}
            >
              <Input
                id={id("ctaLabel")}
                value={form.ctaLabel}
                maxLength={SPONSOR_LIMITS.ctaMax}
                aria-invalid={errorOf("ctaLabel") ? true : undefined}
                aria-describedby={describe("ctaLabel")}
                onChange={(e) => set("ctaLabel", e.target.value)}
              />
            </Field>

            <Field
              id={id("destinationUrl")}
              label="Link de destino *"
              error={errorOf("destinationUrl")}
              hint={urlCheck && !urlCheck.error ? "Endereço aceito." : "Só https://, sem usuário/senha, sem IP/localhost, sem porta e sem acentos no endereço."}
            >
              <Input
                id={id("destinationUrl")}
                type="url"
                inputMode="url"
                autoComplete="off"
                placeholder="https://www.loja.com.br/pagina"
                value={form.destinationUrl}
                aria-invalid={errorOf("destinationUrl") ? true : undefined}
                aria-describedby={describe("destinationUrl")}
                onChange={(e) => set("destinationUrl", e.target.value)}
              />
              {urlCheck?.warning && (
                <p className="text-xs text-amber-800" data-testid="url-warning">
                  {urlCheck.warning}
                </p>
              )}
            </Field>

            <Field id={id("category")} label="Categoria *" error={errorOf("category")} hint="Só categorias permitidas. Bebidas alcoólicas, apostas, tabaco, conteúdo adulto, crédito predatório e política partidária são proibidos.">
              <NativeSelect
                id={id("category")}
                className="h-11 md:h-9"
                value={form.category}
                aria-invalid={errorOf("category") ? true : undefined}
                aria-describedby={describe("category")}
                onChange={(e) => set("category", e.target.value)}
              >
                <option value="">Escolha…</option>
                {SPONSOR_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id={id("startsAt")} label="Início * (horário de Brasília)" error={errorOf("startsAt")}>
                <Input
                  id={id("startsAt")}
                  type="datetime-local"
                  value={form.startsAt}
                  aria-invalid={errorOf("startsAt") ? true : undefined}
                  aria-describedby={describe("startsAt")}
                  onChange={(e) => set("startsAt", e.target.value)}
                />
              </Field>
              <Field id={id("endsAt")} label="Fim * (horário de Brasília)" error={errorOf("endsAt")} hint={`O fim vem depois do início, com no máximo ${String(SPONSOR_LIMITS.windowMaxDays)} dias.`}>
                <Input
                  id={id("endsAt")}
                  type="datetime-local"
                  value={form.endsAt}
                  aria-invalid={errorOf("endsAt") ? true : undefined}
                  aria-describedby={describe("endsAt")}
                  onChange={(e) => set("endsAt", e.target.value)}
                />
              </Field>
            </div>

            <Field id={id("price")} label="Preço combinado (privado, opcional)" error={errorOf("price")} hint="Anotação só sua, em reais (ex.: 1.500,00). A plataforma não cobra nem intermedeia.">
              <Input
                id={id("price")}
                inputMode="decimal"
                placeholder="1.500,00"
                value={form.price}
                aria-invalid={errorOf("price") ? true : undefined}
                aria-describedby={describe("price")}
                onChange={(e) => set("price", e.target.value)}
              />
            </Field>

            <Field
              id={id("billingNote")}
              label="Observação de cobrança (privada, opcional)"
              error={errorOf("billingNote")}
              counter={`${String(form.billingNote.length)}/${String(SPONSOR_LIMITS.billingNoteMax)}`}
              hint="Só o seu grupo vê. Não aparece no app."
            >
              <Textarea
                id={id("billingNote")}
                rows={2}
                value={form.billingNote}
                aria-invalid={errorOf("billingNote") ? true : undefined}
                aria-describedby={describe("billingNote")}
                onChange={(e) => set("billingNote", e.target.value)}
              />
            </Field>
          </div>

          <aside className="order-first min-w-0 lg:order-2" aria-label="Pré-visualização">
            <div className="lg:sticky lg:top-2">
              <SlidePreview
                title={form.title}
                text={form.text}
                ctaLabel={form.ctaLabel}
                imageRef={form.imageRef}
                logoRef={sponsor?.logo ?? ""}
                sponsorName={sponsor?.name ?? ""}
                groupName={user?.organizationName?.trim() || user?.organizationSlug || ""}
              />
              <p className="mt-2 text-xs text-muted-foreground">
                É assim que o aluno adulto verá o anúncio no carrossel da Home. O selo &ldquo;Patrocinado&rdquo; e a faixa &ldquo;Parceiro do grupo&rdquo; são fixos.
              </p>
            </div>
          </aside>

          <SheetFooter className="sticky bottom-0 -mx-4 flex-row justify-end gap-2 border-t bg-background px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] max-sm:[&>button]:flex-1 sm:-mx-4 lg:order-3 lg:col-span-2">
            <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando…" : campaign ? "Salvar alterações" : "Criar campanha"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
