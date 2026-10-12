import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** Teto de linhas por importacao (o painel parseia o CSV e manda JSON; arquivos maiores devem ser divididos). */
export const IMPORT_MAX_ROWS = 500;

/**
 * Uma linha do CSV como TEXTO CRU. So garante tipo/tamanho — as regras de negocio (nome obrigatorio, data valida,
 * CPF, e-mail, unidade...) sao validadas LINHA A LINHA no service para devolver todos os erros de uma vez, em vez
 * de o 400 do ValidationPipe barrar o arquivo inteiro no primeiro problema.
 */
export class ImportStudentRowDto {
  /** Numero da linha no arquivo (cabecalho = 1, primeira linha de dados = 2); sem ele usa indice + 2. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000000)
  line?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  birthDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  document?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  unit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  joinedAt?: string;
}

export class ImportStudentsDto {
  /** true = so valida e devolve o que aconteceria (nada e gravado). */
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsArray()
  @ArrayMinSize(1, { message: 'Nenhuma linha para importar.' })
  @ArrayMaxSize(IMPORT_MAX_ROWS, { message: `Envie no máximo ${IMPORT_MAX_ROWS} linhas por importação.` })
  @ValidateNested({ each: true })
  @Type(() => ImportStudentRowDto)
  rows!: ImportStudentRowDto[];
}
