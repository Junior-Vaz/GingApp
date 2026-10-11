import { IsInt, IsString, Matches, Max, Min, ValidateIf } from 'class-validator';

const INT4_MAX = 2147483647;

/**
 * PUT /finance/billing/:studentId — valor da mensalidade (centavos) e dia de vencimento do aluno.
 * As duas chaves são obrigatórias no corpo: os dois números DEFINEM a cobrança; os dois `null`
 * REMOVEM (o aluno deixa de entrar na geração mensal). Um número e um null => 400 (regra no service).
 */
export class UpsertStudentBillingDto {
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(INT4_MAX)
  monthlyFeeCents!: number | null;

  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(31)
  dueDay!: number | null;
}

/** GET /finance/billing?studentIds=1,2,3 — lista (até 200 ids) as cobranças dos alunos pedidos. */
export class ListStudentBillingQueryDto {
  @IsString()
  @Matches(/^\d{1,10}(,\d{1,10}){0,199}$/, { message: 'studentIds deve ser uma lista de até 200 ids separados por vírgula.' })
  studentIds!: string;
}
