import { Injectable, Logger } from '@nestjs/common';
import { Person, Prisma, PrismaClient, RopeStyle, StudentStatus } from '@prisma/client';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { parseCpf, personDocumentKey, PersonDocumentKey } from '../../../shared/security/person-document';
import { ropeOf } from '../graduations/rope';
import { normalizeGingappCode } from './gingapp-code';
import { PersonErrorCode, PersonErrorCodeValue, personBadRequest, personConflict } from './person-errors';
import {
  createPersonRecord,
  Db,
  documentFields,
  findPersonByCode,
  findPersonByHash,
  findPersonByUser,
  linkStudentToPerson,
  namesLookAlike,
  STUDENT_IDENTITY_SELECT,
} from './person-linker';

/** Preview MINIMO de uma ficha existente (409 do cadastro): nada de historico, contato ou documento. */
export interface PersonPreview {
  personId: number;
  name: string;
  nickname: string | null;
  photo: string | null;
  currentGroups: { id: number; name: string; logoUrl: string | null }[];
  currentLevel: { name: string; style: RopeStyle; colors: string[] } | null;
}

/** Dados de identidade informados no cadastro de uma matricula (POST /students ou linha do CSV), ja validados. */
export interface EnrollmentIdentityInput {
  name: string;
  birthDate: Date | null;
  /** Digitos do CPF do proprio aluno. */
  cpf: string | null;
  /** Digitos do CPF do responsavel (crianca sem CPF; so vale com birthDate). */
  guardianCpf: string | null;
  /** Codigo GingApp canonico. */
  gingappCode: string | null;
  confirmNew: boolean;
}

export type EnrollmentResolution =
  | { kind: 'NEW'; key: PersonDocumentKey | null; confirmedMatches: number[] }
  | { kind: 'LINK'; person: Person; key: PersonDocumentKey | null }
  | { kind: 'ERROR'; status: 400 | 409; code: PersonErrorCodeValue; extra: Record<string, unknown> };

const MAX_POSSIBLE_MATCHES = 5;

/**
 * Identidade da FICHA UNICA na API: "essa pessoa ja existe?", criar/ligar Person ao cadastrar matricula, ligar o login
 * e sincronizar a identidade. Regras em docs/FICHA_UNICA.md (secao 5). Nao depende de StudentsService (sem ciclo).
 */
@Injectable()
export class PersonIdentityService {
  private readonly logger = new Logger(PersonIdentityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Valida os campos crus do DTO e devolve a entrada normalizada (400 INVALID_CPF etc.). */
  parseInput(raw: {
    name: string;
    birthDate?: string | Date | null;
    document?: string | null;
    guardianDocument?: string | null;
    gingappCode?: string | null;
    confirmNew?: boolean;
  }): EnrollmentIdentityInput {
    const birthDate = raw.birthDate ? new Date(raw.birthDate) : null;
    let cpf: string | null = null;
    if (raw.document && raw.document.trim()) {
      cpf = parseCpf(raw.document);
      if (!cpf) throw personBadRequest(PersonErrorCode.INVALID_CPF, { field: 'document' });
    }
    let guardianCpf: string | null = null;
    if (raw.guardianDocument && raw.guardianDocument.trim()) {
      guardianCpf = parseCpf(raw.guardianDocument);
      if (!guardianCpf) throw personBadRequest(PersonErrorCode.INVALID_CPF, { field: 'guardianDocument' });
      if (!birthDate) throw personBadRequest(PersonErrorCode.BIRTHDATE_REQUIRED_FOR_GUARDIAN_DOCUMENT);
    }
    let gingappCode: string | null = null;
    if (raw.gingappCode && raw.gingappCode.trim()) {
      gingappCode = normalizeGingappCode(raw.gingappCode);
      if (!gingappCode) throw personBadRequest(PersonErrorCode.GINGAPP_CODE_NOT_FOUND);
    }
    return { name: raw.name, birthDate, cpf, guardianCpf, gingappCode, confirmNew: raw.confirmNew === true };
  }

  keyOf(input: Pick<EnrollmentIdentityInput, 'cpf' | 'guardianCpf' | 'birthDate'>): PersonDocumentKey | null {
    if (input.cpf) return personDocumentKey('CPF', input.cpf);
    if (input.guardianCpf && input.birthDate) return personDocumentKey('GUARDIAN_CPF', input.guardianCpf, input.birthDate);
    return null;
  }

  /**
   * "Esta pessoa ja tem ficha?" para uma NOVA matricula no grupo `organizationId`. Nao grava nada (exceto auditoria
   * das consultas que encontraram alguem). Ordem: codigo GingApp > CPF (ou CPF do responsavel + nascimento) >
   * nome + nascimento (so sugestao).
   */
  async resolveForEnrollment(organizationId: number, input: EnrollmentIdentityInput, db: Db = this.prisma): Promise<EnrollmentResolution> {
    const key = this.keyOf(input);
    const error = (status: 400 | 409, code: PersonErrorCodeValue, extra: Record<string, unknown> = {}): EnrollmentResolution => ({
      kind: 'ERROR',
      status,
      code,
      extra,
    });

    let byCode: Person | null = null;
    if (input.gingappCode) {
      byCode = await findPersonByCode(db, input.gingappCode);
      if (!byCode) return error(400, PersonErrorCode.GINGAPP_CODE_NOT_FOUND);
    }
    const byKey = key ? await findPersonByHash(db, key.hash) : null;
    if (byCode && byKey && byCode.id !== byKey.id) return error(400, PersonErrorCode.IDENTITY_MISMATCH);
    const person = byCode ?? byKey;

    if (person) {
      // Crianca pelo CPF do responsavel: a chave e "responsavel + nascimento" - gemeos colidem. Nome diferente =
      // so suspeita (POSSIBLE_DUPLICATE); confirmando, cria ficha nova SEM essa chave.
      if (!byCode && key?.kind === 'GUARDIAN_CPF' && !namesLookAlike(person.name, input.name)) {
        if (input.confirmNew) return { kind: 'NEW', key: null, confirmedMatches: [person.id] };
        return error(409, PersonErrorCode.POSSIBLE_DUPLICATE, {
          canConfirmNew: true,
          possibleMatches: await this.previews([person.id], db),
        });
      }
      const here = await db.student.findFirst({
        where: { personId: person.id, organizationId },
        select: { id: true, status: true },
        orderBy: { id: 'asc' },
      });
      if (here) return error(409, PersonErrorCode.PERSON_ALREADY_IN_GROUP, { studentId: here.id, studentStatus: here.status });
      const elsewhere = await db.student.count({ where: { personId: person.id } });
      if (elsewhere > 0) {
        const [preview] = await this.previews([person.id], db);
        return error(409, PersonErrorCode.PERSON_EXISTS_ELSEWHERE, { transferAvailable: false, person: preview });
      }
      // Ficha sem nenhuma matricula (ex.: todas as matriculas foram removidas): reaproveita, nunca duplica.
      return { kind: 'LINK', person, key: person.documentHash ? null : key };
    }

    const matches = input.birthDate ? await this.possibleMatches(organizationId, input, key, db) : [];
    if (matches.length > 0 && !input.confirmNew) {
      return error(409, PersonErrorCode.POSSIBLE_DUPLICATE, { canConfirmNew: true, possibleMatches: await this.previews(matches, db) });
    }
    return { kind: 'NEW', key, confirmedMatches: input.confirmNew ? matches : [] };
  }

  /** Lanca a excecao HTTP de uma resolucao de erro (POST /students). */
  throwIfError(resolution: EnrollmentResolution): asserts resolution is Exclude<EnrollmentResolution, { kind: 'ERROR' }> {
    if (resolution.kind !== 'ERROR') return;
    throw resolution.status === 400
      ? personBadRequest(resolution.code, resolution.extra)
      : personConflict(resolution.code, resolution.extra);
  }

  /** Fichas de OUTROS grupos com nome parecido e mesmo nascimento (max. 5). CPF proprio diferente = outra pessoa. */
  private async possibleMatches(
    organizationId: number,
    input: EnrollmentIdentityInput,
    key: PersonDocumentKey | null,
    db: Db,
  ): Promise<number[]> {
    const candidates = await db.person.findMany({
      where: {
        mergedIntoId: null,
        birthDate: input.birthDate!,
        students: { some: { organizationId: { not: organizationId } } },
      },
      select: { id: true, name: true, documentKind: true, documentHash: true },
      orderBy: { id: 'asc' },
      take: 200,
    });
    return candidates
      .filter((p) => namesLookAlike(p.name, input.name))
      .filter((p) => !(key?.kind === 'CPF' && p.documentKind === 'CPF' && p.documentHash && p.documentHash !== key.hash))
      .slice(0, MAX_POSSIBLE_MATCHES)
      .map((p) => p.id);
  }

  /** Preview minimo (ver PersonPreview). Grupos atuais = matriculas ATIVAS; corda = graduacao mais recente. */
  async previews(personIds: number[], db: Db = this.prisma): Promise<PersonPreview[]> {
    if (personIds.length === 0) return [];
    const people = await db.person.findMany({
      where: { id: { in: personIds } },
      select: {
        id: true,
        name: true,
        nickname: true,
        photo: true,
        students: {
          select: {
            status: true,
            organization: { select: { id: true, name: true, logo: true } },
            graduations: {
              select: { graduatedAt: true, id: true, graduationLevel: { select: { name: true, style: true, colors: true, color: true } } },
              orderBy: [{ graduatedAt: 'desc' }, { id: 'desc' }],
              take: 1,
            },
          },
        },
      },
    });
    const byId = new Map(people.map((p) => [p.id, p]));
    return personIds
      .map((id) => byId.get(id))
      .filter((p): p is NonNullable<typeof p> => !!p)
      .map((p) => {
        const groups = new Map<number, { id: number; name: string; logoUrl: string | null }>();
        for (const s of p.students) {
          if (s.status === StudentStatus.ACTIVE) {
            groups.set(s.organization.id, { id: s.organization.id, name: s.organization.name, logoUrl: s.organization.logo ?? null });
          }
        }
        const latest = p.students
          .flatMap((s) => s.graduations)
          .sort((a, b) => b.graduatedAt.getTime() - a.graduatedAt.getTime() || b.id - a.id)[0];
        const level = latest?.graduationLevel;
        return {
          personId: p.id,
          name: p.name,
          nickname: p.nickname,
          photo: p.photo,
          currentGroups: [...groups.values()],
          currentLevel: level ? { name: level.name, style: ropeOf(level).style, colors: ropeOf(level).colors } : null,
        };
      });
  }

  /** Cria (NEW) ou reaproveita (LINK) a Person da nova matricula, dentro da transacao do chamador. */
  async personIdFor(
    tx: Prisma.TransactionClient,
    resolution: Exclude<EnrollmentResolution, { kind: 'ERROR' }>,
    data: { name: string; birthDate: Date | null; photo?: string | null; phone?: string | null; email?: string | null },
  ): Promise<{ id: number; gingappCode: string }> {
    if (resolution.kind === 'LINK') {
      const update: Prisma.PersonUpdateInput = { ...documentFields(resolution.key) };
      if (!resolution.person.birthDate && data.birthDate) update.birthDate = data.birthDate;
      if (Object.keys(update).length > 0) await tx.person.update({ where: { id: resolution.person.id }, data: update });
      return { id: resolution.person.id, gingappCode: resolution.person.gingappCode };
    }
    const person = await createPersonRecord(tx, { ...data, key: resolution.key });
    return { id: person.id, gingappCode: person.gingappCode };
  }

  /** Auditoria das consultas de identidade que acharam alguem (LGPD: rastro de quem consultou CPF de quem). */
  async auditResolution(organizationId: number, resolution: EnrollmentResolution, via: 'create' | 'import'): Promise<void> {
    if (resolution.kind === 'ERROR' && resolution.status === 409) {
      const extra = resolution.extra as { person?: PersonPreview; possibleMatches?: PersonPreview[]; studentId?: number };
      await this.audit.record({
        organizationId,
        action: AuditAction.PERSON_LOOKUP_MATCH,
        entity: AuditEntity.PERSON,
        entityId: extra.person?.personId ?? null,
        meta: {
          via,
          code: resolution.code,
          studentId: extra.studentId ?? null,
          matches: (extra.possibleMatches ?? []).map((m) => m.personId),
        },
      });
    } else if (resolution.kind === 'NEW' && resolution.confirmedMatches.length > 0) {
      await this.audit.record({
        organizationId,
        action: AuditAction.PERSON_DUPLICATE_CONFIRMED,
        entity: AuditEntity.PERSON,
        meta: { via, possibleMatches: resolution.confirmedMatches },
      });
    }
  }

  /** Garante a ficha de uma matricula antiga/criada fora da API (mesmas regras do backfill). */
  async ensurePersonForStudent(studentId: number): Promise<number> {
    const student = await this.prisma.student.findUniqueOrThrow({ where: { id: studentId }, select: STUDENT_IDENTITY_SELECT });
    if (student.personId) return student.personId;
    return (await linkStudentToPerson(this.prisma, student)).personId;
  }

  /**
   * Identidade compartilhada: a matricula so empurra nome/nascimento/foto/contato para a Person quando ela e a UNICA
   * matricula da pessoa (o grupo e o unico "dono" da ficha). Com matriculas em varios grupos, cada grupo edita so a
   * sua copia (Student) e a ficha fica como esta (edicao da identidade pela propria pessoa: fase 2).
   */
  async syncFromStudent(studentId: number): Promise<void> {
    const student = await this.prisma.student.findUnique({ where: { id: studentId }, select: STUDENT_IDENTITY_SELECT });
    if (!student?.personId) return;
    const enrollments = await this.prisma.student.count({ where: { personId: student.personId } });
    if (enrollments !== 1) return;
    await this.prisma.person.update({
      where: { id: student.personId },
      data: { name: student.name, birthDate: student.birthDate, photo: student.photo, phone: student.phone, email: student.email },
    });
  }

  /**
   * PATCH do CPF de uma matricula existente. `null`/vazio limpa so a matricula (e a ficha, se for a unica matricula).
   * Devolve o valor a gravar em Student.document. Conflitos: CPF de outra ficha (409) ou ficha multi-grupo (409).
   */
  async applyDocumentChange(studentId: number, current: string | null, next: string | null): Promise<string | null | undefined> {
    const currentCpf = parseCpf(current) ?? (current?.replace(/\D/g, '') || null);
    if (next === null || next.trim() === '') {
      if (!current) return undefined;
      const personId = await this.ensurePersonForStudent(studentId);
      const enrollments = await this.prisma.student.count({ where: { personId } });
      if (enrollments === 1) {
        await this.prisma.person.updateMany({
          where: { id: personId, documentKind: 'CPF' },
          data: { documentHash: null, documentEnc: null, documentLast4: null, documentKind: null },
        });
      }
      return null;
    }
    const cpf = parseCpf(next);
    if (cpf && cpf === currentCpf) return undefined; // mesmo CPF (talvez com outra mascara): nada muda
    if (!cpf) {
      // Valor legado nao-CPF reenviado igual pelo formulario: nao e uma mudanca.
      if (current !== null && next.trim() === current.trim()) return undefined;
      throw personBadRequest(PersonErrorCode.INVALID_CPF, { field: 'document' });
    }
    const personId = await this.ensurePersonForStudent(studentId);
    const key = personDocumentKey('CPF', cpf);
    const owner = await findPersonByHash(this.prisma, key.hash);
    if (owner && owner.id !== personId) throw personConflict(PersonErrorCode.DOCUMENT_BELONGS_TO_OTHER_PERSON);
    if (!owner) {
      const person = await this.prisma.person.findUniqueOrThrow({ where: { id: personId } });
      const enrollments = await this.prisma.student.count({ where: { personId } });
      if (person.documentHash && enrollments > 1) throw personConflict(PersonErrorCode.PERSON_DOCUMENT_LOCKED);
      await this.prisma.person.update({ where: { id: personId }, data: documentFields(key) });
    }
    return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
  }

  /**
   * Login criado/vinculado para a matricula (POST /students/:id/account): a ficha passa a ter esse User. Se o User ja
   * tem OUTRA ficha (a mesma pessoa cadastrada sem CPF em outro grupo), a ficha desta matricula e mesclada nela
   * (regra "mesmo login = mesma pessoa"), salvo conflito - entao so audita. Nunca derruba a criacao do acesso.
   */
  async attachUser(studentId: number, userId: number): Promise<void> {
    try {
      const personId = await this.ensurePersonForStudent(studentId);
      const person = await this.prisma.person.findUniqueOrThrow({ where: { id: personId } });
      if (person.userId === userId) return;
      const owner = await findPersonByUser(this.prisma, userId);
      if (!owner) {
        if (person.userId === null) await this.prisma.person.update({ where: { id: personId }, data: { userId } });
        else await this.auditLinkConflict(studentId, personId, userId, 'PERSON_HAS_OTHER_USER');
        return;
      }
      if (owner.id === personId) return;
      const outcome = await mergePersons(this.prisma, owner.id, personId);
      if (outcome.ok) {
        await this.audit.record({
          action: AuditAction.PERSON_MERGE,
          entity: AuditEntity.PERSON,
          entityId: owner.id,
          meta: { mergedPersonId: personId, movedStudents: outcome.movedStudents, via: 'account-link', studentId },
        });
      } else {
        await this.auditLinkConflict(studentId, personId, userId, outcome.code);
      }
    } catch (error) {
      this.logger.error(`Falha ao ligar o login ${userId} a ficha do aluno ${studentId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async auditLinkConflict(studentId: number, personId: number, userId: number, reason: string): Promise<void> {
    await this.audit.record({
      action: AuditAction.PERSON_LINK_CONFLICT,
      entity: AuditEntity.PERSON,
      entityId: personId,
      meta: { studentId, userId, reason },
    });
  }
}

export type MergeOutcome =
  | { ok: true; movedStudents: number; keep: Person }
  | { ok: false; code: PersonErrorCodeValue; extra?: Record<string, unknown> };

/**
 * Mescla `mergeId` em `keepId` (SSOT: POST /people/merge e ligacao de login). Nada e apagado: as matriculas passam
 * para a ficha mantida, a mesclada ganha mergedIntoId (codigo e CPF antigos continuam achando a mantida) e a mantida
 * herda o que nao tem (login, CPF, nascimento, foto, apelido, contato). Conflitos devolvem `ok:false` sem gravar.
 */
export async function mergePersons(prisma: PrismaClient, keepId: number, mergeId: number): Promise<MergeOutcome> {
  const run = async (tx: Prisma.TransactionClient): Promise<MergeOutcome> => {
    if (keepId === mergeId) return { ok: false, code: PersonErrorCode.SAME_PERSON };
    const [keep, merge] = await Promise.all([
      tx.person.findUnique({ where: { id: keepId } }),
      tx.person.findUnique({ where: { id: mergeId } }),
    ]);
    if (!keep || !merge) return { ok: false, code: PersonErrorCode.PERSON_NOT_FOUND };
    if (keep.mergedIntoId || merge.mergedIntoId) return { ok: false, code: PersonErrorCode.PERSON_ALREADY_MERGED };
    if (keep.userId && merge.userId && keep.userId !== merge.userId) return { ok: false, code: PersonErrorCode.PERSON_MERGE_USER_CONFLICT };

    const [keepOrgs, mergeStudents] = await Promise.all([
      tx.student.findMany({ where: { personId: keepId }, select: { organizationId: true } }),
      tx.student.findMany({ where: { personId: mergeId }, select: { id: true, organizationId: true, organization: { select: { id: true, name: true } } } }),
    ]);
    const keepOrgIds = new Set(keepOrgs.map((s) => s.organizationId));
    const clash = mergeStudents.filter((s) => keepOrgIds.has(s.organizationId));
    if (clash.length > 0) {
      return {
        ok: false,
        code: PersonErrorCode.PERSON_MERGE_SAME_GROUP,
        extra: { organizations: [...new Map(clash.map((s) => [s.organization.id, s.organization])).values()] },
      };
    }

    const moved = await tx.student.updateMany({ where: { personId: mergeId }, data: { personId: keepId } });
    // Libera os uniques da mesclada antes de passa-los a mantida.
    const takeUser = !keep.userId && merge.userId ? merge.userId : null;
    const takeDoc = !keep.documentHash && merge.documentHash;
    await tx.person.update({
      where: { id: mergeId },
      data: {
        mergedIntoId: keepId,
        mergedAt: new Date(),
        ...(takeUser ? { userId: null } : {}),
        ...(takeDoc ? { documentHash: null } : {}),
      },
    });
    const data: Prisma.PersonUpdateInput = {};
    if (takeUser) data.user = { connect: { id: takeUser } };
    if (takeDoc) {
      Object.assign(data, {
        documentHash: merge.documentHash,
        documentEnc: merge.documentEnc,
        documentLast4: merge.documentLast4,
        documentKind: merge.documentKind,
      });
    }
    for (const field of ['birthDate', 'photo', 'nickname', 'gender', 'email', 'phone'] as const) {
      if (keep[field] === null && merge[field] !== null) (data as Record<string, unknown>)[field] = merge[field];
    }
    const updated = Object.keys(data).length > 0 ? await tx.person.update({ where: { id: keepId }, data }) : keep;
    // Fichas que ja tinham sido mescladas na "mesclada" passam a apontar direto para a mantida.
    await tx.person.updateMany({ where: { mergedIntoId: mergeId }, data: { mergedIntoId: keepId } });
    return { ok: true, movedStudents: moved.count, keep: updated };
  };
  return prisma.$transaction(run);
}
