import { Person, Prisma, PrismaClient } from '@prisma/client';
import { parseCpf, personDocumentKey, PersonDocumentKey } from '../../../shared/security/person-document';
import { normalizeText } from '../students/student-import';
import { generateGingappCode } from './gingapp-code';

/**
 * Nucleo da FICHA UNICA (sem Nest): criar Person, seguir a cadeia de mescla e ligar uma matricula (Student) a sua
 * Person. Usado pela API (PersonIdentityService), pelo backfill (prisma/person-backfill.ts) e pelos specs - uma unica
 * regra de "quem e a mesma pessoa" (SSOT).
 */
export type Db = PrismaClient | Prisma.TransactionClient;

const MAX_MERGE_HOPS = 10;

/** Segue mergedIntoId ate a ficha VIGENTE (a que nao foi mesclada em outra). */
export async function canonicalPerson(db: Db, person: Person | null): Promise<Person | null> {
  let current = person;
  for (let hop = 0; current?.mergedIntoId && hop < MAX_MERGE_HOPS; hop++) {
    current = await db.person.findUnique({ where: { id: current.mergedIntoId } });
  }
  return current;
}

export async function findPersonByHash(db: Db, hash: string): Promise<Person | null> {
  return canonicalPerson(db, await db.person.findUnique({ where: { documentHash: hash } }));
}

export async function findPersonByCode(db: Db, code: string): Promise<Person | null> {
  return canonicalPerson(db, await db.person.findUnique({ where: { gingappCode: code } }));
}

export async function findPersonByUser(db: Db, userId: number): Promise<Person | null> {
  return canonicalPerson(db, await db.person.findUnique({ where: { userId } }));
}

/** Codigo GingApp ainda livre (colisao e astronomicamente rara; o unique do banco e a garantia final). */
export async function freeGingappCode(db: Db): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = generateGingappCode();
    if (!(await db.person.findUnique({ where: { gingappCode: code }, select: { id: true } }))) return code;
  }
  throw new Error('Nao foi possivel gerar um codigo GingApp livre.');
}

export interface NewPersonData {
  name: string;
  birthDate?: Date | null;
  photo?: string | null;
  phone?: string | null;
  email?: string | null;
  userId?: number | null;
  key?: PersonDocumentKey | null;
}

export function documentFields(key: PersonDocumentKey | null | undefined) {
  return key
    ? { documentHash: key.hash, documentEnc: key.enc, documentLast4: key.last4, documentKind: key.kind }
    : {};
}

export async function createPersonRecord(db: Db, data: NewPersonData): Promise<Person> {
  return db.person.create({
    data: {
      gingappCode: await freeGingappCode(db),
      name: data.name,
      birthDate: data.birthDate ?? null,
      photo: data.photo ?? null,
      phone: data.phone ?? null,
      email: data.email ?? null,
      userId: data.userId ?? null,
      ...documentFields(data.key),
    },
  });
}

/** Mesmo nome (sem acento/caixa/espacos extras) OU mesmo primeiro e ultimo nome. Similaridade simples, sem libs. */
export function namesLookAlike(a: string, b: string): boolean {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = na.split(' ');
  const tb = nb.split(' ');
  return ta.length > 1 && tb.length > 1 && ta[0] === tb[0] && ta[ta.length - 1] === tb[tb.length - 1];
}

export type LinkOutcome = 'CREATED' | 'LINKED_BY_USER' | 'LINKED_BY_DOCUMENT' | 'ALREADY_LINKED';

export interface LinkResult {
  personId: number;
  outcome: LinkOutcome;
  /** Observacoes para o relatorio do backfill (conflitos que impediram de gravar o CPF/login na ficha). */
  notes: string[];
}

export interface StudentIdentityRow {
  id: number;
  organizationId: number;
  userId: number | null;
  personId: number | null;
  name: string;
  birthDate: Date | null;
  photo: string | null;
  phone: string | null;
  email: string | null;
  document: string | null;
}

export const STUDENT_IDENTITY_SELECT = {
  id: true,
  organizationId: true,
  userId: true,
  personId: true,
  name: true,
  birthDate: true,
  photo: true,
  phone: true,
  email: true,
  document: true,
} as const;

/**
 * Liga UMA matricula sem ficha a sua Person (regras do backfill, docs/FICHA_UNICA.md secao 6):
 *  1. mesmo login (Student.userId): a Person desse User, ou a de outra matricula do mesmo User;
 *  2. senao, mesmo CPF valido (Student.document): a Person com esse hash - EXCETO se ela ja tem matricula neste
 *     mesmo grupo (cadastro duplicado dentro do grupo: nao junta sozinho, cria outra ficha sem o CPF e anota);
 *  3. senao cria uma Person nova (codigo GingApp, nome, nascimento, foto, contato, CPF cifrado se valido).
 * NUNCA junta por nome + nascimento (isso so vira sugestao em GET /people/duplicates).
 * Idempotente: matricula ja ligada nao muda. Concorrencia: a gravacao de Student.personId e condicional (personId nulo).
 */
export async function linkStudentToPerson(prisma: PrismaClient, student: StudentIdentityRow): Promise<LinkResult> {
  if (student.personId) return { personId: student.personId, outcome: 'ALREADY_LINKED', notes: [] };
  return prisma.$transaction(async (tx) => {
    const notes: string[] = [];
    const cpf = parseCpf(student.document);
    if (student.document && student.document.trim() && !cpf) notes.push('INVALID_DOCUMENT');
    const key = cpf ? personDocumentKey('CPF', cpf) : null;

    let person: Person | null = null;
    let outcome: LinkOutcome = 'CREATED';
    if (student.userId) {
      person = await findPersonByUser(tx, student.userId);
      if (!person) {
        const sibling = await tx.student.findFirst({
          where: { userId: student.userId, personId: { not: null }, id: { not: student.id } },
          select: { personId: true },
          orderBy: { id: 'asc' },
        });
        if (sibling?.personId) person = await canonicalPerson(tx, await tx.person.findUnique({ where: { id: sibling.personId } }));
      }
      if (person) outcome = 'LINKED_BY_USER';
    }
    if (!person && key) {
      const byDoc = await findPersonByHash(tx, key.hash);
      if (byDoc) {
        const sameGroup = await tx.student.count({ where: { personId: byDoc.id, organizationId: student.organizationId } });
        if (sameGroup > 0) notes.push('SAME_GROUP_DOCUMENT_CONFLICT');
        else {
          person = byDoc;
          outcome = 'LINKED_BY_DOCUMENT';
        }
      }
    }

    if (person) {
      // Completa a ficha encontrada com o que ela nao tem (nunca sobrescreve).
      const data: Prisma.PersonUpdateInput = {};
      if (!person.birthDate && student.birthDate) data.birthDate = student.birthDate;
      if (!person.photo && student.photo) data.photo = student.photo;
      if (!person.phone && student.phone) data.phone = student.phone;
      if (!person.email && student.email) data.email = student.email;
      if (!person.userId && student.userId) {
        if (await tx.person.findUnique({ where: { userId: student.userId }, select: { id: true } })) notes.push('USER_ON_OTHER_PERSON');
        else data.user = { connect: { id: student.userId } };
      }
      if (!person.documentHash && key) {
        if (await tx.person.findUnique({ where: { documentHash: key.hash }, select: { id: true } })) notes.push('DOCUMENT_ON_OTHER_PERSON');
        else Object.assign(data, documentFields(key));
      }
      if (Object.keys(data).length > 0) await tx.person.update({ where: { id: person.id }, data });
    } else {
      const docFree = key && !(await tx.person.findUnique({ where: { documentHash: key.hash }, select: { id: true } }));
      const userFree =
        student.userId && !(await tx.person.findUnique({ where: { userId: student.userId }, select: { id: true } }));
      person = await createPersonRecord(tx, {
        name: student.name,
        birthDate: student.birthDate,
        photo: student.photo,
        phone: student.phone,
        email: student.email,
        userId: userFree ? student.userId : null,
        key: docFree ? key : null,
      });
      outcome = 'CREATED';
    }

    const { count } = await tx.student.updateMany({ where: { id: student.id, personId: null }, data: { personId: person.id } });
    if (count !== 1) {
      // Outra requisicao ligou primeiro: desfaz esta transacao e devolve o vinculo que venceu.
      throw new AlreadyLinkedError();
    }
    return { personId: person.id, outcome, notes };
  }).catch(async (error: unknown) => {
    if (error instanceof AlreadyLinkedError) {
      const row = await prisma.student.findUniqueOrThrow({ where: { id: student.id }, select: { personId: true } });
      return { personId: row.personId!, outcome: 'ALREADY_LINKED' as const, notes: [] };
    }
    throw error;
  });
}

class AlreadyLinkedError extends Error {}

export interface BackfillReport {
  scanned: number;
  personsCreated: number;
  linkedByUser: number;
  linkedByDocument: number;
  alreadyLinked: number;
  invalidDocuments: number;
  sameGroupDocumentConflicts: number;
  otherConflicts: number;
  failed: number;
  /** Fichas (vigentes, com matricula) com mesmo nome normalizado + nascimento: candidatas a mescla manual. */
  possibleDuplicateGroups: number;
  possibleDuplicatePersons: number;
  remainingWithoutPerson: number;
}

/** Backfill idempotente: liga TODA matricula sem ficha. Sequencial (seguro; volume de alunos e pequeno). */
export async function backfillPersons(
  prisma: PrismaClient,
  log: (msg: string) => void = () => undefined,
  /** Restringe a alguns grupos (specs: nunca tocar no seed/demo). Omitido = todos. */
  options: { organizationIds?: number[] } = {},
): Promise<BackfillReport> {
  const scope: Prisma.StudentWhereInput = options.organizationIds ? { organizationId: { in: options.organizationIds } } : {};
  const report: BackfillReport = {
    scanned: 0,
    personsCreated: 0,
    linkedByUser: 0,
    linkedByDocument: 0,
    alreadyLinked: 0,
    invalidDocuments: 0,
    sameGroupDocumentConflicts: 0,
    otherConflicts: 0,
    failed: 0,
    possibleDuplicateGroups: 0,
    possibleDuplicatePersons: 0,
    remainingWithoutPerson: 0,
  };
  let cursor = 0;
  for (;;) {
    const batch = await prisma.student.findMany({
      where: { ...scope, personId: null, id: { gt: cursor } },
      select: STUDENT_IDENTITY_SELECT,
      orderBy: { id: 'asc' },
      take: 200,
    });
    if (batch.length === 0) break;
    for (const student of batch) {
      cursor = student.id;
      report.scanned++;
      try {
        const result = await linkStudentToPerson(prisma, student);
        if (result.outcome === 'CREATED') report.personsCreated++;
        else if (result.outcome === 'LINKED_BY_USER') report.linkedByUser++;
        else if (result.outcome === 'LINKED_BY_DOCUMENT') report.linkedByDocument++;
        else report.alreadyLinked++;
        for (const note of result.notes) {
          if (note === 'INVALID_DOCUMENT') report.invalidDocuments++;
          else if (note === 'SAME_GROUP_DOCUMENT_CONFLICT') report.sameGroupDocumentConflicts++;
          else report.otherConflicts++;
        }
      } catch (error) {
        report.failed++;
        log(`aluno ${student.id}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
      }
    }
  }
  const dup = await findDuplicateGroups(prisma, 1000);
  report.possibleDuplicateGroups = dup.length;
  report.possibleDuplicatePersons = dup.reduce((n, g) => n + g.personIds.length, 0);
  report.remainingWithoutPerson = await prisma.student.count({ where: { ...scope, personId: null } });
  return report;
}

export interface DuplicateGroup {
  key: string;
  birthDate: Date;
  personIds: number[];
}

/**
 * Candidatos a mescla: fichas VIGENTES com pelo menos uma matricula, mesma data de nascimento e mesmo nome
 * normalizado. Fichas com CPFs DIFERENTES nunca sao candidatas entre si (sao pessoas distintas).
 */
export async function findDuplicateGroups(db: Db, limit: number): Promise<DuplicateGroup[]> {
  const people = await db.person.findMany({
    where: { mergedIntoId: null, birthDate: { not: null }, students: { some: {} } },
    select: { id: true, name: true, birthDate: true, documentHash: true, documentKind: true },
    orderBy: { id: 'asc' },
  });
  const buckets = new Map<string, typeof people>();
  for (const p of people) {
    const key = `${normalizeText(p.name)}|${p.birthDate!.toISOString().slice(0, 10)}`;
    const list = buckets.get(key) ?? [];
    list.push(p);
    buckets.set(key, list);
  }
  const groups: DuplicateGroup[] = [];
  for (const [key, list] of buckets) {
    if (list.length < 2) continue;
    const cpfs = new Set(list.filter((p) => p.documentKind === 'CPF' && p.documentHash).map((p) => p.documentHash));
    if (cpfs.size === list.length) continue; // todos com CPF proprio e distintos: pessoas diferentes
    groups.push({ key, birthDate: list[0]!.birthDate!, personIds: list.map((p) => p.id) });
    if (groups.length >= limit) break;
  }
  return groups;
}
