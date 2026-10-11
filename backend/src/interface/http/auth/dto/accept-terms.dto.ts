import { IsString, MaxLength, MinLength } from 'class-validator';

/** POST /auth/accept-terms: a versão dos textos que o usuário leu (GET /legal -> version). */
export class AcceptTermsDto {
  @IsString({ message: 'Informe a versão dos termos.' })
  @MinLength(1, { message: 'Informe a versão dos termos.' })
  @MaxLength(64, { message: 'Versão inválida.' })
  version!: string;
}
