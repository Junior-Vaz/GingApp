import { applyDecorators, NotFoundException } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

/**
 * Query opcional `?studentId=` das rotas "/me" do app (seletor de dependente do RESPONSAVEL):
 * escolhe UM dos alunos ligados ao usuário. Sem o parâmetro vale o comportamento histórico
 * (agregado dos alunos ligados). Com ele, o vínculo é SEMPRE conferido por
 * `StudentsService.resolveLink` (SSOT de "próprio ou dependente") via `requireLinkedStudent`.
 */
export const OptionalStudentId = () => applyDecorators(IsOptional(), Type(() => Number), IsInt(), Min(1));

/** Forma mínima do `StudentsService.resolveLink` (evita o shared depender de interface/http). */
interface LinkResolver<S> {
  resolveLink(
    organizationId: number,
    userId: number,
    studentId: number,
  ): Promise<{ student: S; linked: boolean } | null>;
}

/**
 * Garante que `studentId` é o próprio aluno do usuário ou um dependente dele e devolve o aluno.
 * Aluno inexistente, de outra organização OU sem vínculo => o MESMO 404 (não vaza a existência de
 * alunos de terceiros).
 */
export async function requireLinkedStudent<S>(
  students: LinkResolver<S>,
  organizationId: number,
  userId: number,
  studentId: number,
): Promise<S> {
  const link = await students.resolveLink(organizationId, userId, studentId);
  if (!link?.linked) {
    throw new NotFoundException('Aluno não encontrado.');
  }
  return link.student;
}
