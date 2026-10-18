import { IsBoolean, IsInt, IsNumber, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * Corpo do envio publico. O DTO so garante os TIPOS de topo; o conteudo de `answers` e validado campo a campo no
 * servico (answer-validation.ts) contra a definicao do formulario — nunca confiar no cliente.
 */
export class SubmitRegistrationDto {
  @IsObject()
  answers!: Record<string, unknown>;

  /** Precisa ser `true` (o servico devolve o erro em `fields.consent`). */
  @IsOptional()
  @IsBoolean()
  consent?: boolean;

  /** Honeypot: campo invisivel na pagina; robo preenche, pessoa nao. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  hp?: string;

  /**
   * Token devolvido por GET /public/forms/:slug (HMAC do instante do SERVIDOR + slug): tempo minimo/maximo de
   * preenchimento medido pelo relogio do servidor. Substitui `startedAt`.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  startedToken?: string;

  /** LEGADO (app antigo em cache): epoch ms do navegador. Ignorado quando ha `startedToken`; ver FORMS_PUBLIC_LEGACY. */
  @IsOptional()
  @IsNumber()
  startedAt?: number;

  /** Versao do termo de consentimento EXIBIDA (GET .consent.version). Diferente da vigente = 409 CONSENT_OUTDATED. */
  @IsOptional()
  @IsInt()
  @Min(1)
  consentVersion?: number;
}

export class LookupRegistrationDto {
  @IsString()
  @MaxLength(20)
  protocol!: string;

  @IsOptional()
  @IsString()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  document?: string;
}

export class UploadRegistrationFileDto {
  @IsString()
  @MaxLength(48)
  fieldKey!: string;
}
