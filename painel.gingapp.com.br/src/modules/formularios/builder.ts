import { fromLocalInput, isImageRef, toLocalInput } from "@/modules/rodas/form-utils";
import { centsToReais, reaisToCents } from "@/modules/eventos/event-schema";
import {
  FIELD_TYPE_INFO,
  LIMITS,
  isChoiceType,
  type FieldType,
  type FormDefinition,
  type Id,
  type MapsTo,
  type PaymentMode,
  type PixKeyType,
  type ShowIf,
} from "./types";

/**
 * Modelo de edição do construtor (somente cliente): a definição do servidor vira um RASCUNHO (`Draft`) com textos nos
 * campos numéricos/datas (o que a pessoa digita) e campos agrupados por seção. `toPayload` devolve o corpo do PUT.
 * Tudo aqui é função pura (sem React), para testar sem tela.
 */

export interface BField {
  /** Identificador ESTÁVEL do campo (`f_` + 8 caracteres): gerado no cliente e nunca muda depois de criado. */
  key: string;
  type: FieldType;
  label: string;
  helpText: string;
  required: boolean;
  options: string[] | null;
  validation: Record<string, unknown> | null;
  showIf: ShowIf | null;
  mapsTo: MapsTo | null;
}

export interface BSection {
  /** Chave só do cliente (React/seleção); `id` só existe nas seções que já estão no servidor. */
  cid: string;
  id?: Id;
  title: string;
  description: string;
  fields: BField[];
}

export interface Draft {
  title: string;
  intro: string;
  bannerUrl: string;
  eventId: Id | null;
  /** datetime-local ("yyyy-MM-ddTHH:mm") ou "" = sem data. */
  opensAt: string;
  closesAt: string;
  /** Texto: "" = sem limite. */
  maxSubmissions: string;
  allowWaitlist: boolean;
  paymentMode: PaymentMode;
  /** Reais digitados ("25,00"). */
  price: string;
  pixKey: string;
  pixKeyType: PixKeyType;
  pixBeneficiary: string;
  requireApproval: boolean;
  confirmationMessage: string;
  consentText: string;
  consentVersion: string | number | null;
  /** Texto: "" = padrão do servidor. */
  retentionMonths: string;
  sections: BSection[];
}

// ------------------------------------------------------------------ chaves

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomChars(length: number): string {
  const bytes = new Uint8Array(length);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function")
    crypto.getRandomValues(bytes);
  else for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

/** Chave estável de campo: `f_` + 8 caracteres aleatórios, sem repetir nenhuma das existentes. */
export function newFieldKey(existing: Iterable<string> = []): string {
  const taken = new Set(existing);
  let key = `f_${randomChars(8)}`;
  while (taken.has(key)) key = `f_${randomChars(8)}`;
  return key;
}

let sectionSeq = 0;
const newCid = (): string => `n${String(++sectionSeq)}`;

// ------------------------------------------------------------ conversões

export function fromDefinition(def: FormDefinition): Draft {
  const sections: BSection[] = def.sections.map((s, index) => ({
    cid: `s${String(index)}`,
    id: s.id,
    title: s.title,
    description: s.description ?? "",
    fields: [],
  }));
  if (sections.length === 0)
    sections.push({ cid: "s0", title: "Dados", description: "", fields: [] });
  for (const f of def.fields) {
    // Campo sem seção (ou com seção que sumiu) cai na primeira: nada se perde.
    const target = sections.find((s) => s.id !== undefined && s.id === f.sectionId) ?? sections[0]!;
    target.fields.push({
      key: f.key,
      type: f.type,
      label: f.label,
      helpText: f.helpText ?? "",
      required: f.type === "INFO" ? false : f.required,
      options: f.options ? [...f.options] : null,
      validation: f.validation ? { ...f.validation } : null,
      showIf: f.showIf ? { ...f.showIf } : null,
      mapsTo: f.mapsTo,
    });
  }
  return {
    title: def.title,
    intro: def.intro ?? "",
    bannerUrl: def.bannerUrl ?? "",
    eventId: def.eventId,
    opensAt: toLocalInput(def.opensAt),
    closesAt: toLocalInput(def.closesAt),
    maxSubmissions: def.maxSubmissions ? String(def.maxSubmissions) : "",
    allowWaitlist: def.allowWaitlist,
    paymentMode: def.paymentMode,
    price: centsToReais(def.priceCents),
    pixKey: def.pixKey ?? "",
    pixKeyType: def.pixKeyType ?? "PHONE",
    pixBeneficiary: def.pixBeneficiary ?? "",
    requireApproval: def.requireApproval,
    confirmationMessage: def.confirmationMessage ?? "",
    consentText: def.consentText ?? "",
    consentVersion: def.consentVersion,
    retentionMonths: def.retentionMonths ? String(def.retentionMonths) : "",
    sections,
  };
}

const nullable = (value: string): string | null => value.trim() || null;

/** Corpo do PUT /event-forms/:id (mesmo formato do GET, sem id/slug/publicUrl/eventTitle/status). */
export function toPayload(draft: Draft) {
  const manualPix = draft.paymentMode === "PIX_MANUAL";
  const paid = draft.paymentMode !== "NONE";
  return {
    title: draft.title.trim(),
    intro: nullable(draft.intro),
    bannerUrl: nullable(draft.bannerUrl),
    eventId: draft.eventId,
    opensAt: draft.opensAt ? fromLocalInput(draft.opensAt) : null,
    closesAt: draft.closesAt ? fromLocalInput(draft.closesAt) : null,
    maxSubmissions: draft.maxSubmissions.trim() ? Number(draft.maxSubmissions) : null,
    allowWaitlist: draft.allowWaitlist,
    paymentMode: draft.paymentMode,
    priceCents: paid ? (reaisToCents(draft.price) ?? 0) : 0,
    pixKey: manualPix ? nullable(draft.pixKey) : null,
    pixKeyType: manualPix ? draft.pixKeyType : null,
    pixBeneficiary: manualPix ? nullable(draft.pixBeneficiary) : null,
    requireApproval: draft.requireApproval,
    confirmationMessage: nullable(draft.confirmationMessage),
    consentText: nullable(draft.consentText),
    consentVersion: draft.consentVersion,
    retentionMonths: draft.retentionMonths.trim() ? Number(draft.retentionMonths) : null,
    sections: draft.sections.map((s) => ({
      ...(s.id !== undefined ? { id: s.id } : {}),
      title: s.title.trim(),
      description: nullable(s.description),
    })),
    fields: draft.sections.flatMap((s, sectionIndex) =>
      s.fields.map((f) => ({
        key: f.key,
        sectionIndex,
        type: f.type,
        label: f.label.trim(),
        helpText: nullable(f.helpText),
        required: f.type === "INFO" ? false : f.required,
        options: isChoiceType(f.type) ? (f.options ?? []).map((o) => o.trim()) : null,
        validation: f.validation && Object.keys(f.validation).length > 0 ? f.validation : null,
        showIf: f.showIf,
        mapsTo: f.mapsTo,
      })),
    ),
  };
}

/** Assinatura para detectar "alterações não salvas". */
export const draftSignature = (draft: Draft): string => JSON.stringify(draft);

// ------------------------------------------------------------- consultas

export const allFields = (draft: Draft): BField[] => draft.sections.flatMap((s) => s.fields);

export function findField(
  draft: Draft,
  key: string,
): { field: BField; section: BSection; index: number } | null {
  for (const section of draft.sections) {
    const index = section.fields.findIndex((f) => f.key === key);
    if (index >= 0) return { field: section.fields[index]!, section, index };
  }
  return null;
}

/** Campos que vêm ANTES de `key` (candidatos a "Mostrar só se …") e que têm resposta comparável. */
export function conditionSources(draft: Draft, key: string): BField[] {
  const flat = allFields(draft);
  const at = flat.findIndex((f) => f.key === key);
  return flat
    .slice(0, at < 0 ? 0 : at)
    .filter((f) => f.type !== "INFO" && f.type !== "FILE" && f.type !== "CONSENT");
}

export const fieldCount = (draft: Draft): number => allFields(draft).length;
export const fileFieldCount = (draft: Draft): number =>
  allFields(draft).filter((f) => f.type === "FILE").length;

/** Quantos campos (de outras posições) dependem de `key` em "Mostrar só se". */
export const dependentsOf = (draft: Draft, key: string): BField[] =>
  allFields(draft).filter((f) => f.showIf?.fieldKey === key);

// ------------------------------------------------------------- mutações

function mapFields(draft: Draft, fn: (f: BField) => BField): Draft {
  return { ...draft, sections: draft.sections.map((s) => ({ ...s, fields: s.fields.map(fn) })) };
}

export function defaultField(type: FieldType, existingKeys: Iterable<string>): BField {
  const info = FIELD_TYPE_INFO[type];
  return {
    key: newFieldKey(existingKeys),
    type,
    label: type === "CONSENT" ? "Li e aceito os termos" : info.label,
    helpText: "",
    required: type === "CONSENT",
    options: isChoiceType(type) ? ["Opção 1", "Opção 2"] : null,
    validation: null,
    showIf: null,
    mapsTo: null,
  };
}

export function addSection(draft: Draft): Draft {
  return {
    ...draft,
    sections: [
      ...draft.sections,
      {
        cid: newCid(),
        title: `Seção ${String(draft.sections.length + 1)}`,
        description: "",
        fields: [],
      },
    ],
  };
}

export function updateSection(
  draft: Draft,
  cid: string,
  patch: Partial<Pick<BSection, "title" | "description">>,
): Draft {
  return {
    ...draft,
    sections: draft.sections.map((s) => (s.cid === cid ? { ...s, ...patch } : s)),
  };
}

/** Tira a condição "mostrar só se" que apontava para campos que não existem mais. */
function dropDanglingConditions(draft: Draft): Draft {
  const keys = new Set(allFields(draft).map((f) => f.key));
  return mapFields(draft, (f) =>
    f.showIf && !keys.has(f.showIf.fieldKey) ? { ...f, showIf: null } : f,
  );
}

export function removeSection(draft: Draft, cid: string): Draft {
  if (draft.sections.length <= 1) return draft;
  return dropDanglingConditions({
    ...draft,
    sections: draft.sections.filter((s) => s.cid !== cid),
  });
}

export function moveSection(draft: Draft, cid: string, direction: -1 | 1): Draft {
  const from = draft.sections.findIndex((s) => s.cid === cid);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= draft.sections.length) return draft;
  const sections = [...draft.sections];
  const [moved] = sections.splice(from, 1);
  sections.splice(to, 0, moved!);
  return { ...draft, sections };
}

export function addField(
  draft: Draft,
  cid: string,
  type: FieldType,
): { draft: Draft; key: string } {
  const field = defaultField(
    type,
    allFields(draft).map((f) => f.key),
  );
  return {
    key: field.key,
    draft: {
      ...draft,
      sections: draft.sections.map((s) =>
        s.cid === cid ? { ...s, fields: [...s.fields, field] } : s,
      ),
    },
  };
}

export function updateField(draft: Draft, key: string, patch: Partial<Omit<BField, "key">>): Draft {
  return mapFields(draft, (f) => (f.key === key ? { ...f, ...patch } : f));
}

export function removeField(draft: Draft, key: string): Draft {
  return dropDanglingConditions({
    ...draft,
    sections: draft.sections.map((s) => ({ ...s, fields: s.fields.filter((f) => f.key !== key) })),
  });
}

export function duplicateField(draft: Draft, key: string): { draft: Draft; key: string } | null {
  const found = findField(draft, key);
  if (!found) return null;
  const copy: BField = {
    ...found.field,
    key: newFieldKey(allFields(draft).map((f) => f.key)),
    label: `${found.field.label} (cópia)`,
    options: found.field.options ? [...found.field.options] : null,
    validation: found.field.validation ? { ...found.field.validation } : null,
    showIf: found.field.showIf ? { ...found.field.showIf } : null,
    mapsTo: null, // cada mapeamento (nome, CPF…) só pode existir uma vez
  };
  return {
    key: copy.key,
    draft: {
      ...draft,
      sections: draft.sections.map((s) => {
        if (s.cid !== found.section.cid) return s;
        const fields = [...s.fields];
        fields.splice(found.index + 1, 0, copy);
        return { ...s, fields };
      }),
    },
  };
}

/** ↑ / ↓: sobe/desce dentro da seção; na ponta, passa para a seção vizinha (fim da anterior / começo da seguinte). */
export function moveField(draft: Draft, key: string, direction: -1 | 1): Draft {
  const found = findField(draft, key);
  if (!found) return draft;
  const sections = draft.sections.map((s) => ({ ...s, fields: [...s.fields] }));
  const si = sections.findIndex((s) => s.cid === found.section.cid);
  const current = sections[si]!;
  const target = found.index + direction;
  if (target >= 0 && target < current.fields.length) {
    const [moved] = current.fields.splice(found.index, 1);
    current.fields.splice(target, 0, moved!);
    return { ...draft, sections };
  }
  const neighbour = sections[si + direction];
  if (!neighbour) return draft;
  const [moved] = current.fields.splice(found.index, 1);
  if (direction === -1) neighbour.fields.push(moved!);
  else neighbour.fields.unshift(moved!);
  return { ...draft, sections };
}

/** Pode subir/descer? (falso só no primeiro campo da primeira seção / no último da última). */
export function canMoveField(draft: Draft, key: string, direction: -1 | 1): boolean {
  const found = findField(draft, key);
  if (!found) return false;
  const inside =
    found.index + direction >= 0 && found.index + direction < found.section.fields.length;
  const si = draft.sections.findIndex((s) => s.cid === found.section.cid);
  return inside || draft.sections[si + direction] !== undefined;
}

export function moveFieldToSection(draft: Draft, key: string, cid: string): Draft {
  const found = findField(draft, key);
  if (!found || found.section.cid === cid) return draft;
  return {
    ...draft,
    sections: draft.sections.map((s) => {
      if (s.cid === found.section.cid)
        return { ...s, fields: s.fields.filter((f) => f.key !== key) };
      if (s.cid === cid) return { ...s, fields: [...s.fields, found.field] };
      return s;
    }),
  };
}

// ------------------------------------------------------------ opções

export function setValidation(
  field: BField,
  patch: Record<string, number | undefined>,
): Record<string, unknown> | null {
  const next: Record<string, unknown> = { ...(field.validation ?? {}) };
  for (const [name, value] of Object.entries(patch)) {
    if (value === undefined || Number.isNaN(value)) delete next[name];
    else next[name] = value;
  }
  return Object.keys(next).length > 0 ? next : null;
}

// ------------------------------------------------------------ validação

export interface Issue {
  /** Onde corrigir: aba do editor. */
  tab: "fields" | "settings";
  message: string;
  fieldKey?: string;
}

const PRICE_HINT = "Informe o valor em reais, ex.: 25,00.";

/** Validação no cliente (limites e regras do contrato). O servidor valida de novo; aqui o objetivo é avisar cedo. */
export function validateDraft(draft: Draft): Issue[] {
  const issues: Issue[] = [];
  const add = (tab: Issue["tab"], message: string, fieldKey?: string) =>
    issues.push(fieldKey ? { tab, message, fieldKey } : { tab, message });

  if (draft.title.trim().length < 2)
    add("settings", "Informe o título do formulário (mínimo 2 caracteres).");
  if (draft.bannerUrl.trim() && !isImageRef(draft.bannerUrl.trim()))
    add("settings", "O banner precisa ser uma imagem enviada ou um link http(s) válido.");

  if (draft.sections.length > LIMITS.sections)
    add("fields", `Use no máximo ${String(LIMITS.sections)} seções.`);
  const flat = allFields(draft);
  if (flat.length > LIMITS.fields) add("fields", `Use no máximo ${String(LIMITS.fields)} campos.`);
  if (fileFieldCount(draft) > LIMITS.files)
    add("fields", `Use no máximo ${String(LIMITS.files)} campos de envio de arquivo.`);

  draft.sections.forEach((section, i) => {
    if (!section.title.trim()) add("fields", `A seção ${String(i + 1)} precisa de um título.`);
  });

  const seenMaps = new Map<MapsTo, string>();
  const seenBefore = new Set<string>();
  for (const f of flat) {
    const name = f.label.trim() || FIELD_TYPE_INFO[f.type].label;
    if (!f.label.trim())
      add("fields", `Um campo (${FIELD_TYPE_INFO[f.type].label}) está sem rótulo.`, f.key);
    if (isChoiceType(f.type)) {
      const options = (f.options ?? []).map((o) => o.trim());
      if (options.length > LIMITS.options)
        add("fields", `"${name}": use no máximo ${String(LIMITS.options)} opções.`, f.key);
      if (options.length < 2) add("fields", `"${name}": informe pelo menos 2 opções.`, f.key);
      else if (options.some((o) => !o)) add("fields", `"${name}": há uma opção em branco.`, f.key);
      else if (new Set(options.map((o) => o.toLocaleLowerCase("pt-BR"))).size !== options.length) {
        add("fields", `"${name}": há opções repetidas.`, f.key);
      }
    }
    if (f.type === "NUMBER") {
      const min = f.validation?.["min"];
      const max = f.validation?.["max"];
      if (typeof min === "number" && typeof max === "number" && min > max)
        add("fields", `"${name}": o mínimo não pode ser maior que o máximo.`, f.key);
    }
    if (f.showIf) {
      if (!seenBefore.has(f.showIf.fieldKey))
        add(
          "fields",
          `"${name}": a condição precisa apontar para um campo que vem antes dele.`,
          f.key,
        );
      else if (!f.showIf.equals.trim())
        add("fields", `"${name}": escolha o valor da condição "mostrar só se".`, f.key);
      else {
        const source = flat.find((other) => other.key === f.showIf?.fieldKey);
        if (
          source?.options &&
          source.options.length > 0 &&
          !source.options.includes(f.showIf.equals)
        ) {
          add(
            "fields",
            `"${name}": o valor “${f.showIf.equals}” da condição não existe mais nas opções de “${source.label}”.`,
            f.key,
          );
        }
      }
    }
    if (f.mapsTo) {
      const other = seenMaps.get(f.mapsTo);
      if (other)
        add(
          "fields",
          `"${name}": o mapeamento "${mapsToLabel(f.mapsTo)}" já foi usado em "${other}".`,
          f.key,
        );
      else seenMaps.set(f.mapsTo, name);
    }
    seenBefore.add(f.key);
  }

  if (
    draft.maxSubmissions.trim() &&
    !(/^\d+$/.test(draft.maxSubmissions.trim()) && Number(draft.maxSubmissions) >= 1)
  ) {
    add(
      "settings",
      "Informe um número de vagas inteiro, de 1 em diante (ou deixe vazio para sem limite).",
    );
  }
  if (
    draft.retentionMonths.trim() &&
    !(
      /^\d+$/.test(draft.retentionMonths.trim()) &&
      Number(draft.retentionMonths) >= 1 &&
      Number(draft.retentionMonths) <= 120
    )
  ) {
    add("settings", "A retenção dos dados deve ser de 1 a 120 meses.");
  }
  if (draft.opensAt && draft.closesAt && draft.opensAt >= draft.closesAt) {
    add("settings", "O encerramento precisa ser depois da abertura.");
  }

  if (draft.paymentMode === "PIX_AUTO") {
    add(
      "settings",
      "O Pix automático ainda não está disponível. Escolha Pix manual ou Sem pagamento.",
    );
  } else if (draft.paymentMode === "PIX_MANUAL") {
    const cents = reaisToCents(draft.price);
    if (cents === null || cents <= 0) add("settings", `Pix manual: ${PRICE_HINT}`);
    if (!draft.pixKey.trim()) add("settings", "Pix manual: informe a chave Pix.");
    if (!draft.pixBeneficiary.trim()) add("settings", "Pix manual: informe o nome do favorecido.");
  }
  return issues;
}

export function mapsToLabel(value: MapsTo): string {
  return (
    {
      name: "Nome",
      nickname: "Apelido",
      birthDate: "Nascimento",
      document: "CPF",
      phone: "Telefone",
      email: "E-mail",
      city: "Cidade",
      group: "Grupo",
      teacher: "Professor",
      cord: "Graduação",
    } as const
  )[value];
}

// ------------------------------------------------- erros do servidor

export interface ServerIssue {
  path: string;
  message: string;
}

/**
 * Normaliza o `fields` do erro VALIDATION. Aceita objeto `{ "fields.2.label": "msg" }`, lista `[{ field|path, message }]`
 * ou lista de textos; sem `fields` usa `message` (texto ou lista).
 */
export function parseValidationIssues(body: Record<string, unknown> | undefined): ServerIssue[] {
  if (!body) return [];
  const out: ServerIssue[] = [];
  const text = (v: unknown): string =>
    Array.isArray(v) ? v.map(String).join(" ") : String(v ?? "");
  const raw = body["fields"];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string") out.push({ path: "", message: item });
      else if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        out.push({
          path: text(o["field"] ?? o["path"] ?? ""),
          message: text(o["message"] ?? o["error"] ?? ""),
        });
      }
    }
  } else if (raw && typeof raw === "object") {
    for (const [path, message] of Object.entries(raw as Record<string, unknown>))
      out.push({ path, message: text(message) });
  }
  if (out.length === 0) {
    const message = body["message"];
    if (Array.isArray(message)) for (const m of message) out.push({ path: "", message: String(m) });
    else if (typeof message === "string" && message) out.push({ path: "", message });
  }
  return out.filter((i) => i.message);
}

/**
 * Descobre a que campo do rascunho um caminho do servidor se refere. O backend real manda o erro de um campo pela
 * própria `key` (`{ "cpf": "…" }`) ou, quando a chave é inválida, por `fields[N]` (posição no PUT). Casa a chave INTEIRA
 * (ou `<key>.<propriedade>`): "title"/"pixKey" nunca podem cair num campo do usuário só porque o texto se parece.
 */
export function fieldKeyForPath(draft: Draft, path: string): string | undefined {
  const flat = allFields(draft);
  const byKey = flat.find((f) => path === f.key || path.startsWith(`${f.key}.`));
  if (byKey) return byKey.key;
  const match = /^fields[.[](\d+)/.exec(path);
  return match ? flat[Number(match[1])]?.key : undefined;
}
