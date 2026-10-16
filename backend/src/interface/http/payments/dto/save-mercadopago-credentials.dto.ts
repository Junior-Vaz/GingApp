import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** So ASCII visivel: sem espacos/quebras internas nem caracteres de controle (o token vai num cabecalho HTTP). */
const VISIBLE_ASCII = /^[\x21-\x7E]+$/;

/**
 * PUT /payments/mercadopago/credentials (modo MANUAL, PLANO_PROJETO.md 10.55): o Mestre cola as credenciais da PROPRIA
 * conta Mercado Pago do grupo. Atualizacao PARCIAL: campo ausente nao muda; `publicKey`/`webhookSecret` = '' limpam;
 * `null` e recusado (400). `accessToken` e obrigatorio quando o grupo ainda nao tem conta (ACCESS_TOKEN_REQUIRED, no
 * servico). Nada daqui volta em resposta, log ou auditoria (o status so traz os 4 ultimos caracteres do token).
 */
export class SaveMercadoPagoCredentialsDto {
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trim)
  @IsString({ message: 'accessToken deve ser texto.' })
  @MinLength(10, { message: 'accessToken muito curto.' })
  @MaxLength(512, { message: 'accessToken muito longo.' })
  @Matches(VISIBLE_ASCII, { message: 'accessToken não pode ter espaços, quebras de linha ou caracteres especiais.' })
  accessToken?: string;

  @ValidateIf((_, value) => value !== undefined)
  @Transform(trim)
  @IsString({ message: 'publicKey deve ser texto.' })
  @MaxLength(256, { message: 'publicKey muito longa.' })
  @ValidateIf((_, value) => value !== '')
  @Matches(VISIBLE_ASCII, { message: 'publicKey não pode ter espaços, quebras de linha ou caracteres especiais.' })
  publicKey?: string;

  @ValidateIf((_, value) => value !== undefined)
  @Transform(trim)
  @IsString({ message: 'webhookSecret deve ser texto.' })
  @MaxLength(256, { message: 'webhookSecret muito longo.' })
  @ValidateIf((_, value) => value !== '')
  @Matches(VISIBLE_ASCII, { message: 'webhookSecret não pode ter espaços, quebras de linha ou caracteres especiais.' })
  webhookSecret?: string;

  /**
   * Senha ATUAL do Mestre (reautenticacao - PLANO_PROJETO.md 10.56, M6): obrigatoria quando `accessToken` vem (definir ou
   * trocar a conta que recebe o dinheiro). Sem trim (a senha e comparada como digitada). Nunca vai para log/auditoria.
   */
  @ValidateIf((_, value) => value !== undefined)
  @IsString({ message: 'currentPassword deve ser texto.' })
  @MaxLength(200, { message: 'currentPassword muito longa.' })
  currentPassword?: string;

  /** Codigo do app autenticador (TOTP), exigido junto da senha quando o Mestre tem 2FA ativo. */
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trim)
  @IsString({ message: 'twoFactorCode deve ser texto.' })
  @Matches(/^\d{6,8}$/, { message: 'twoFactorCode deve ter 6 a 8 dígitos.' })
  twoFactorCode?: string;
}
