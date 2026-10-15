import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { OrgRole, Prisma, UserType } from '@prisma/client';
import { AuthenticatedUser } from '../interfaces/jwt-payload.interface';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Autorizacao por UNIDADE (E08, projeto.txt secoes 21/58/59) — SSOT unico, reutilizado por students, classes,
 * lessons, attendance, events, announcements, units, dashboard e pelas rotas de aluno por id.
 *
 * Escopo de um usuario (`UnitScope`):
 *  - `'ALL'`: sem restricao de unidade (comportamento historico);
 *  - `number[]`: so as unidades da lista (UserUnitAccess do usuario na organizacao).
 *
 * Quem fica restrito (DECISAO): somente o PROFESSOR com 1+ registros em UserUnitAccess da organizacao.
 *  - MESTRE (e PLATFORM/super admin) = sempre 'ALL' (o Mestre ve o grupo consolidado, secao 14);
 *  - ALUNO/RESPONSAVEL = sempre 'ALL' aqui (o escopo deles e por vinculo — /me —, nao por unidade);
 *  - PROFESSOR SEM nenhum registro = 'ALL': mantem o comportamento anterior (ve tudo) para nao quebrar
 *    grupos que ja existem e nunca atribuiram unidades. Passa a ser restrito no PRIMEIRO registro; o Mestre
 *    volta a liberar tudo enviando a lista vazia (PUT /teachers/:id/units com unitIds: []).
 *  - As linhas contam mesmo que a unidade tenha sido inativada depois (inativar a unica unidade do professor
 *    NAO o transforma em "ve tudo"; ele continua enxergando os dados historicos dessa unidade).
 *
 * Registros SEM unidade (unitId nulo) continuam VISIVEIS e editaveis pelo professor restrito: aluno/turma/aula
 * "sem unidade" sao dados anteriores a atribuicao de unidades (nao pertencem a nenhuma filial, nao ha o que vazar)
 * e esconde-los faria sumir cadastro legado do professor. Em eventos e comunicados `unitId` nulo = grupo inteiro:
 * LEGIVEIS por todos, mas so o Mestre os altera (o restrito recebe 403). Criacao por restrito nunca gera registro
 * sem unidade (assume a unica unidade dele, ou 400 se ele tem varias). Aula sem unitId propria herda a unidade da
 * turma (unidade efetiva).
 *
 * Erros: registro existente fora do escopo = o MESMO 404 do inexistente (nao vaza existencia); unidade
 * informada no corpo fora do escopo = 403.
 */
export type UnitScope = number[] | 'ALL';

/** Papeis da equipe sujeitos ao escopo por unidade (Fase 3: INSTRUTOR e MONITOR seguem a mesma regra do PROFESSOR). */
export const SCOPED_STAFF_ROLES: OrgRole[] = [OrgRole.PROFESSOR, OrgRole.INSTRUTOR, OrgRole.MONITOR];

export const UNIT_ACCESS_DENIED = 'Você não tem acesso a esta unidade.';

export function isRestricted(scope: UnitScope): scope is number[] {
  return scope !== 'ALL';
}

/** O escopo permite o registro desta unidade? Restrito: so as suas unidades, ou registro sem unidade (legado). */
export function scopeAllows(scope: UnitScope, unitId: number | null | undefined): boolean {
  return !isRestricted(scope) || unitId === null || unitId === undefined || scope.includes(unitId);
}

/** O registro e DE uma das unidades do escopo (estrito: sem unidade NAO conta)? Sem restricao: sempre. */
export function scopeOwns(scope: UnitScope, unitId: number | null | undefined): boolean {
  return !isRestricted(scope) || (unitId !== null && unitId !== undefined && scope.includes(unitId));
}

/**
 * Fragmento `where` para entidades com coluna `unitId` propria (Student, Class): sem unidade ou uma das unidades do
 * escopo. `{}` sem restricao. Usa `OR`: nao espalhe junto de outro `OR` no mesmo objeto (use `AND: [filtro]`).
 */
export function unitScopeFilter(scope: UnitScope): { OR?: Array<{ unitId: null } | { unitId: { in: number[] } }> } {
  return isRestricted(scope) ? { OR: [{ unitId: null }, { unitId: { in: scope } }] } : {};
}

/** Aula: unidade efetiva = Lesson.unitId, ou (se nula) a unidade da turma; sem nenhuma das duas = visivel. */
export function lessonScopeFilter(scope: UnitScope): Prisma.LessonWhereInput {
  if (!isRestricted(scope)) return {};
  return { OR: [{ unitId: { in: scope } }, { unitId: null, class: unitScopeFilter(scope) }] };
}

/**
 * PROFESSOR, INSTRUTOR e MONITOR so trabalham as aulas DELES (docs/FICHA_UNICA.md secao 12; estendido de MONITOR para
 * toda a equipe nao-Mestre apos o bug da chamada rapida mostrar turmas de outros professores): aula atribuida a ele
 * (Lesson.teacherUserId) ou de turma em que ele e o responsavel (Class.teacherUserId). Mestre/PLATFORM/super admin/
 * ALUNO/RESPONSAVEL/`user` omitido (chamada interna) = sem esse filtro (o Mestre ve o grupo; os demais papeis tem outro
 * escopo, por vinculo). Soma-se ao escopo de unidade. Aula fora disso = o mesmo 404 do inexistente. Combine com AND.
 * Turma sem responsavel so aparece para o Mestre.
 */
export function ownLessonFilter(user: AuthenticatedUser | undefined): Prisma.LessonWhereInput {
  if (!user || user.userType !== UserType.MEMBER || user.isSuperAdmin || !SCOPED_STAFF_ROLES.includes(user.role as OrgRole)) return {};
  return { OR: [{ teacherUserId: user.id }, { class: { teacherUserId: user.id } }] };
}

/** @deprecated nome antigo (so MONITOR); use `ownLessonFilter` (PROFESSOR/INSTRUTOR/MONITOR). */
export const monitorLessonFilter = ownLessonFilter;

/** Eventos/comunicados: `unitId` nulo = grupo inteiro (legivel a todos) ou uma das unidades do escopo. */
export function groupWideOrUnitFilter(scope: UnitScope): { OR?: Array<{ unitId: null } | { unitId: { in: number[] } }> } {
  return unitScopeFilter(scope);
}

/** Registro existente fora do escopo => 404 (mesma mensagem do inexistente). */
export function assertUnitAccess(scope: UnitScope, unitId: number | null | undefined, notFoundMessage: string): void {
  if (!scopeAllows(scope, unitId)) throw new NotFoundException(notFoundMessage);
}

/** Unidade de DESTINO (vinda do corpo) fora do escopo => 403. */
export function assertUnitTarget(scope: UnitScope, unitId: number | null | undefined): void {
  if (!scopeAllows(scope, unitId)) throw new ForbiddenException(UNIT_ACCESS_DENIED);
}

/** Registro que o restrito so pode alterar se for DE uma das suas unidades (evento/comunicado do grupo inteiro => 403). */
export function assertUnitOwned(scope: UnitScope, unitId: number | null | undefined): void {
  if (!scopeOwns(scope, unitId)) throw new ForbiddenException(UNIT_ACCESS_DENIED);
}

/**
 * Unidade a gravar na CRIACAO. Sem restricao: o que veio (pode ser nulo). Restrito: a informada tem de estar no
 * escopo (403); omitida/nula assume a unica unidade do professor, ou 400 se ele tem varias (tem de escolher).
 */
export function resolveWriteUnit(scope: UnitScope, unitId: number | null | undefined): number | undefined {
  if (!isRestricted(scope)) return unitId ?? undefined;
  if (unitId !== null && unitId !== undefined) {
    assertUnitOwned(scope, unitId);
    return unitId;
  }
  if (scope.length === 1) return scope[0];
  throw new BadRequestException('Informe a unidade (você atua em mais de uma).');
}

/**
 * Unidade informada numa ATUALIZACAO: `undefined` = nao mexe. Restrito: nao pode mover o registro para fora do
 * escopo nem limpar a unidade (null) — ambos 403.
 */
export function assertUnitUpdate(scope: UnitScope, unitId: number | null | undefined): void {
  if (!isRestricted(scope) || unitId === undefined) return;
  assertUnitOwned(scope, unitId);
}

@Injectable()
export class UnitScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Escopo do usuario na organizacao (ver as regras no topo do arquivo). `user` ausente (chamada interna entre
   * services) = 'ALL'.
   */
  async resolve(user: AuthenticatedUser | undefined, organizationId: number): Promise<UnitScope> {
    if (!user || user.userType !== UserType.MEMBER || user.isSuperAdmin || !SCOPED_STAFF_ROLES.includes(user.role as OrgRole)) {
      return 'ALL';
    }
    const rows = await this.prisma.userUnitAccess.findMany({
      where: { userId: user.id, organizationId },
      select: { unitId: true },
    });
    return rows.length === 0 ? 'ALL' : rows.map((r) => r.unitId);
  }

  /** `where` pronto (`{ unitId: { in } }` ou `{}`) para Student/Class do usuario na organizacao. */
  async unitScopeWhere(user: AuthenticatedUser | undefined, organizationId: number) {
    return unitScopeFilter(await this.resolve(user, organizationId));
  }

  /** 404 se o registro (de unidade `unitId`) esta fora do escopo do usuario. */
  async assertUnitAccess(
    user: AuthenticatedUser | undefined,
    organizationId: number,
    unitId: number | null | undefined,
    notFoundMessage: string,
  ): Promise<void> {
    assertUnitAccess(await this.resolve(user, organizationId), unitId, notFoundMessage);
  }
}
