import { ArrayMaxSize, ArrayUnique, IsArray, IsInt, Min } from 'class-validator';

/**
 * PUT /teachers/:id/units — substitui o CONJUNTO de unidades de atuação do professor (E08). Lista vazia = sem
 * restrição (o professor volta a ver todas as unidades do grupo, comportamento padrão de quem nunca recebeu
 * unidades). Ids repetidos são recusados (400); ids de outro grupo, também (400, mesmo erro de inexistente).
 */
export class SetTeacherUnitsDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  unitIds!: number[];
}
