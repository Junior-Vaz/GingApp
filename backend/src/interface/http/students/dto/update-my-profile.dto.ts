import { Type } from 'class-transformer';
import { IsObject, IsOptional, IsUrl, ValidateNested } from 'class-validator';

/**
 * Redes sociais do praticante — conjunto fixo de plataformas (não é um JSON livre de chave
 * qualquer). Submeter `socialLinks` sempre SUBSTITUI o objeto inteiro (nunca faz merge parcial
 * com o que já estava salvo): para remover uma rede, reenvie o objeto sem a chave. Dentro do
 * objeto, `null` numa rede equivale a omiti-la (o service descarta); string vazia não é aceita
 * (400, não é URL).
 */
class SocialLinksDto {
  @IsOptional()
  @IsUrl()
  instagram?: string | null;

  @IsOptional()
  @IsUrl()
  youtube?: string | null;

  @IsOptional()
  @IsUrl()
  tiktok?: string | null;

  @IsOptional()
  @IsUrl()
  facebook?: string | null;

  @IsOptional()
  @IsUrl()
  whatsapp?: string | null;
}

/**
 * Auto-atendimento do próprio perfil (PATCH /students/me/profile) — só os campos que fazem
 * sentido o próprio aluno/responsável editar (foto, capa, redes sociais). Nunca os campos
 * administrativos de Student (name/status/document/...), que continuam exclusivos do painel via
 * PATCH /students/:id + @CanAccess.
 *
 * Semântica de PATCH (a mesma de UpdateStudentDto): campo ausente = não mexe; `null` = LIMPA a
 * coluna (todas as três colunas são nullable no schema, então `@IsOptional()` — que deixa `null`
 * e `undefined` passarem — é o decorator certo aqui). String vazia NÃO limpa: é 400 (não é URL).
 */
export class UpdateMyProfileDto {
  @IsOptional()
  @IsUrl()
  photo?: string | null;

  @IsOptional()
  @IsUrl()
  coverPhoto?: string | null;

  /** `null` ou `{}` (sem nenhuma rede) => coluna volta a NULL; objeto com redes => substitui por inteiro. */
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => SocialLinksDto)
  socialLinks?: SocialLinksDto | null;
}
