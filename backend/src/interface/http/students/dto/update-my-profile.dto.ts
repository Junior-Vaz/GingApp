import { Type } from 'class-transformer';
import { IsOptional, IsUrl, ValidateNested } from 'class-validator';

/**
 * Redes sociais do praticante — conjunto fixo de plataformas (não é um JSON livre de chave
 * qualquer). Submeter `socialLinks` sempre SUBSTITUI o objeto inteiro (nunca faz merge parcial
 * com o que já estava salvo) — o formulário do PWA sempre envia todos os campos de uma vez.
 */
class SocialLinksDto {
  @IsOptional()
  @IsUrl()
  instagram?: string;

  @IsOptional()
  @IsUrl()
  youtube?: string;

  @IsOptional()
  @IsUrl()
  tiktok?: string;

  @IsOptional()
  @IsUrl()
  facebook?: string;

  @IsOptional()
  @IsUrl()
  whatsapp?: string;
}

/**
 * Auto-atendimento do próprio perfil (PATCH /students/me/profile) — só os campos que fazem
 * sentido o próprio aluno/responsável editar (foto, capa, redes sociais). Nunca os campos
 * administrativos de Student (name/status/document/...), que continuam exclusivos do painel via
 * PATCH /students/:id + @CanAccess.
 */
export class UpdateMyProfileDto {
  @IsOptional()
  @IsUrl()
  photo?: string;

  @IsOptional()
  @IsUrl()
  coverPhoto?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => SocialLinksDto)
  socialLinks?: SocialLinksDto;
}
