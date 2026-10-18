/**
 * Regras PURAS da definicao de um formulario de inscricao (sem Prisma/Nest): tipos de campo, limites, validacao da
 * definicao salva pelo construtor (PUT /event-forms/:id) e dos requisitos para publicar (POST /event-forms/:id/open).
 * docs/PLANO_FORMULARIOS_INSCRICAO.md, F1.
 */

export const FIELD_TYPES = [
  'SHORT_TEXT',
  'LONG_TEXT',
  'NUMBER',
  'EMAIL',
  'PHONE',
  'CPF',
  'DATE',
  'SINGLE_CHOICE',
  'MULTI_CHOICE',
  'SELECT',
  'CONSENT',
  'FILE',
  'INFO',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** Campos com lista de opcoes (2+ obrigatorias). */
export const CHOICE_TYPES: readonly FieldType[] = ['SINGLE_CHOICE', 'MULTI_CHOICE', 'SELECT'];

export const MAPS_TO = ['name', 'nickname', 'birthDate', 'document', 'phone', 'email', 'city', 'group', 'teacher', 'cord'] as const;
export type MapsTo = (typeof MAPS_TO)[number];

export const PIX_KEY_TYPES = ['CPF', 'CNPJ', 'EMAIL', 'PHONE', 'RANDOM'] as const;

export const FORM_LIMITS = {
  maxFields: 60,
  maxSections: 12,
  maxOptions: 40,
  maxFileFields: 5,
  titleMax: 150,
  introMax: 5000,
  sectionTitleMax: 150,
  sectionDescriptionMax: 1000,
  labelMax: 500,
  helpTextMax: 1000,
  optionMax: 200,
  confirmationMessageMax: 2000,
  consentTextMax: 10000,
  pixKeyMax: 140,
  pixBeneficiaryMax: 120,
  shortTextDefaultMax: 300,
  longTextDefaultMax: 5000,
} as const;

/**
 * Chave estavel do campo (as respostas sao guardadas por ela): letras, digitos, "_" e "-". Nomes de propriedades do
 * prototipo de Object (constructor, toString...) sao proibidos: `answers[key]` nunca pode ler o prototipo.
 */
export const FIELD_KEY_REGEX =
  /^(?!(?:constructor|prototype|toString|toLocaleString|valueOf|hasOwnProperty|isPrototypeOf|propertyIsEnumerable)$)[A-Za-z][A-Za-z0-9_-]{0,47}$/;

export interface ShowIf {
  fieldKey: string;
  equals: string | number | boolean;
}

export interface FieldValidation {
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
}

/** Campo ja normalizado (o que vai para o banco). */
export interface FieldDefinition {
  key: string;
  type: FieldType;
  label: string;
  helpText: string | null;
  required: boolean;
  options: string[] | null;
  validation: FieldValidation | null;
  showIf: ShowIf | null;
  mapsTo: MapsTo | null;
}

/** Entrada crua do construtor (DTO), antes da validacao. */
export interface RawFieldInput {
  key?: string;
  type?: string;
  label?: string;
  helpText?: string | null;
  required?: boolean;
  options?: unknown;
  validation?: unknown;
  showIf?: unknown;
  mapsTo?: string | null;
}

export type FieldErrors = Record<string, string>;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t === '' ? null : t;
}

/**
 * Valida e normaliza a lista de campos (na ORDEM recebida). `errorKey(i, key)` diz onde pendurar o erro (a chave do
 * campo quando valida, senao `fields[i]`). Nunca lanca: devolve os campos normalizados e os erros.
 */
export function validateFields(raw: RawFieldInput[]): { fields: FieldDefinition[]; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const fields: FieldDefinition[] = [];
  const seen = new Set<string>();
  if (raw.length > FORM_LIMITS.maxFields) {
    errors.fields = `No máximo ${FORM_LIMITS.maxFields} campos por formulário.`;
  }
  let fileCount = 0;

  raw.forEach((input, index) => {
    const key = typeof input.key === 'string' ? input.key.trim() : '';
    const where = key && FIELD_KEY_REGEX.test(key) ? key : `fields[${index}]`;
    const fail = (msg: string) => {
      if (!errors[where]) errors[where] = msg;
    };

    if (!FIELD_KEY_REGEX.test(key)) return fail('Chave do campo inválida (use letras, números, "_" ou "-", até 48).');
    if (seen.has(key)) return fail('Chave de campo repetida no formulário.');
    seen.add(key);

    const type = input.type as FieldType;
    if (!FIELD_TYPES.includes(type)) return fail('Tipo de campo inválido.');

    const label = cleanText(input.label);
    if (!label) return fail('Informe o texto (rótulo) do campo.');
    if (label.length > (type === 'CONSENT' || type === 'INFO' ? FORM_LIMITS.consentTextMax : FORM_LIMITS.labelMax)) {
      return fail('Texto do campo longo demais.');
    }
    const helpText = cleanText(input.helpText);
    if (helpText && helpText.length > FORM_LIMITS.helpTextMax) return fail('Texto de ajuda longo demais.');

    // Opcoes: so para escolha (2..40, unicas, nao vazias).
    let options: string[] | null = null;
    if (CHOICE_TYPES.includes(type)) {
      if (!Array.isArray(input.options)) return fail('Informe as opções (pelo menos 2).');
      const opts = input.options.map((o) => (typeof o === 'string' ? o.trim() : ''));
      if (opts.length < 2) return fail('Informe pelo menos 2 opções.');
      if (opts.length > FORM_LIMITS.maxOptions) return fail(`No máximo ${FORM_LIMITS.maxOptions} opções.`);
      if (opts.some((o) => o === '' || o.length > FORM_LIMITS.optionMax)) return fail('Opção vazia ou longa demais.');
      if (new Set(opts).size !== opts.length) return fail('Opções repetidas.');
      options = opts;
    } else if (input.options !== undefined && input.options !== null && !(Array.isArray(input.options) && input.options.length === 0)) {
      return fail('Este tipo de campo não tem opções.');
    }

    // Validacao extra (tamanho do texto / faixa do numero).
    let validation: FieldValidation | null = null;
    if (input.validation !== undefined && input.validation !== null) {
      if (!isPlainObject(input.validation)) return fail('Validação inválida.');
      const allowed =
        type === 'NUMBER' ? ['min', 'max'] : type === 'SHORT_TEXT' || type === 'LONG_TEXT' ? ['minLength', 'maxLength'] : [];
      const v: FieldValidation = {};
      for (const [k, val] of Object.entries(input.validation)) {
        if (val === null || val === undefined) continue;
        if (!allowed.includes(k)) return fail(`Validação "${k}" não se aplica a este tipo de campo.`);
        if (typeof val !== 'number' || !Number.isFinite(val)) return fail('Validação deve ser numérica.');
        if ((k === 'minLength' || k === 'maxLength') && (!Number.isInteger(val) || val < 0 || val > FORM_LIMITS.longTextDefaultMax)) {
          return fail('Tamanho mínimo/máximo inválido.');
        }
        (v as Record<string, number>)[k] = val;
      }
      if (v.minLength !== undefined && v.maxLength !== undefined && v.minLength > v.maxLength) return fail('Tamanho mínimo maior que o máximo.');
      if (v.min !== undefined && v.max !== undefined && v.min > v.max) return fail('Valor mínimo maior que o máximo.');
      validation = Object.keys(v).length > 0 ? v : null;
    }

    // Condicional: so referencia campo ANTERIOR existente (sem ciclos por construcao).
    let showIf: ShowIf | null = null;
    if (input.showIf !== undefined && input.showIf !== null) {
      if (!isPlainObject(input.showIf)) return fail('Condição de exibição inválida.');
      const ref = input.showIf.fieldKey;
      const equals = input.showIf.equals;
      if (typeof ref !== 'string' || !fields.some((f) => f.key === ref)) {
        return fail('A condição de exibição deve apontar para um campo ANTERIOR do formulário.');
      }
      if (!['string', 'number', 'boolean'].includes(typeof equals)) return fail('Valor da condição inválido.');
      if (typeof equals === 'string' && equals.length > FORM_LIMITS.optionMax) return fail('Valor da condição longo demais.');
      const refField = fields.find((f) => f.key === ref)!;
      if (refField.type === 'INFO' || refField.type === 'FILE') return fail('A condição não pode depender de um campo informativo ou de arquivo.');
      showIf = { fieldKey: ref, equals: equals as string | number | boolean };
    }

    let mapsTo: MapsTo | null = null;
    if (input.mapsTo !== undefined && input.mapsTo !== null && input.mapsTo !== '') {
      if (!MAPS_TO.includes(input.mapsTo as MapsTo)) return fail('Mapeamento (mapsTo) inválido.');
      mapsTo = input.mapsTo as MapsTo;
    }

    if (type === 'FILE') {
      fileCount += 1;
      if (fileCount > FORM_LIMITS.maxFileFields) return fail(`No máximo ${FORM_LIMITS.maxFileFields} campos de arquivo.`);
    }

    fields.push({
      key,
      type,
      label,
      helpText,
      // Campo informativo nunca e obrigatorio (nao tem resposta).
      required: type === 'INFO' ? false : input.required === true,
      options,
      validation,
      showIf,
      mapsTo,
    });
  });

  // mapsTo de identificacao: no maximo um campo por destino.
  const mapped = new Map<string, string>();
  for (const f of fields) {
    if (!f.mapsTo) continue;
    if (mapped.has(f.mapsTo) && !errors[f.key]) errors[f.key] = `Já existe outro campo mapeado para "${f.mapsTo}".`;
    mapped.set(f.mapsTo, f.key);
  }
  return { fields, errors };
}

export interface PublishCheckInput {
  title: string;
  paymentMode: 'NONE' | 'PIX_MANUAL' | 'PIX_AUTO';
  priceCents: number | null;
  pixKey: string | null;
  pixKeyType: string | null;
  pixBeneficiary: string | null;
  closesAt: Date | null;
  fields: Array<{ type: string; archived?: boolean }>;
}

/** Requisitos para o formulario ficar OPEN. Devolve os erros por campo de configuracao (vazio = pode publicar). */
export function publishErrors(form: PublishCheckInput, now: Date = new Date()): FieldErrors {
  const errors: FieldErrors = {};
  if (!form.title || form.title.trim().length < 2) errors.title = 'Informe o título do formulário.';
  const answerable = form.fields.filter((f) => !f.archived && f.type !== 'INFO');
  if (answerable.length === 0) errors.fields = 'Adicione pelo menos um campo para a pessoa responder.';
  if (form.paymentMode === 'PIX_MANUAL') {
    if (!form.priceCents || form.priceCents <= 0) errors.priceCents = 'Informe o valor da inscrição.';
    if (!form.pixKey) errors.pixKey = 'Informe a chave Pix.';
    if (!form.pixKeyType) errors.pixKeyType = 'Informe o tipo da chave Pix.';
    if (!form.pixBeneficiary) errors.pixBeneficiary = 'Informe o nome de quem recebe o Pix.';
  }
  if (form.closesAt && form.closesAt.getTime() <= now.getTime()) errors.closesAt = 'O prazo de inscrição já passou.';
  return errors;
}

/** Texto padrao de consentimento (LGPD) quando o formulario nao define o seu. */
export function defaultConsentText(retentionMonths: number): string {
  return (
    'Ao enviar esta inscrição, você concorda que os dados informados sejam usados pelo grupo organizador somente ' +
    'para gerenciar esta inscrição e o evento, conforme a Lei Geral de Proteção de Dados (LGPD - Lei 13.709/2018). ' +
    `Os dados e os anexos serão apagados ou anonimizados ${retentionMonths} ${retentionMonths === 1 ? 'mês' : 'meses'} depois do ` +
    'encerramento das inscrições (ou do envio, quando o formulário não tem data de encerramento). Para pedir acesso, ' +
    'correção ou exclusão dos seus dados, solicite ao organizador do formulário.'
  );
}
