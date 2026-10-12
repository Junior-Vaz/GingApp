import { Injectable } from '@nestjs/common';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { maskPersonDocument } from '../../../shared/security/person-document';
import { personBadRequest, personConflict, PersonErrorCode, personNotFound } from './person-errors';
import { mergePersons } from './person-identity.service';
import { findDuplicateGroups } from './person-linker';

const DUPLICATE_GROUPS_LIMIT = 100;

/** Ferramentas do SUPER ADMIN da plataforma sobre fichas: candidatos a duplicata e mescla. */
@Injectable()
export class PeopleAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Grupos de fichas com mesmo nome normalizado + nascimento (max. 100 grupos). Nunca devolve CPF (so a mascara). */
  async duplicates() {
    const groups = await findDuplicateGroups(this.prisma, DUPLICATE_GROUPS_LIMIT);
    const ids = groups.flatMap((g) => g.personIds);
    const people = await this.prisma.person.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        gingappCode: true,
        name: true,
        birthDate: true,
        documentKind: true,
        documentLast4: true,
        userId: true,
        createdAt: true,
        students: {
          select: { id: true, status: true, organization: { select: { id: true, name: true } } },
          orderBy: { id: 'asc' },
        },
      },
    });
    const byId = new Map(people.map((p) => [p.id, p]));
    return {
      total: groups.length,
      groups: groups.map((g) => ({
        key: g.key,
        birthDate: g.birthDate,
        people: g.personIds
          .map((id) => byId.get(id)!)
          .map((p) => ({
            id: p.id,
            gingappCode: p.gingappCode,
            name: p.name,
            birthDate: p.birthDate,
            documentKind: p.documentKind,
            documentMasked: maskPersonDocument(p.documentLast4),
            hasLogin: p.userId !== null,
            createdAt: p.createdAt,
            enrollments: p.students.map((s) => ({ studentId: s.id, status: s.status, organization: s.organization })),
          })),
      })),
    };
  }

  async merge(keepId: number, mergeId: number) {
    if (keepId === mergeId) throw personBadRequest(PersonErrorCode.SAME_PERSON);
    const outcome = await mergePersons(this.prisma, keepId, mergeId);
    if (!outcome.ok) {
      if (outcome.code === PersonErrorCode.PERSON_NOT_FOUND) throw personNotFound();
      if (outcome.code === PersonErrorCode.SAME_PERSON) throw personBadRequest(outcome.code);
      throw personConflict(outcome.code, outcome.extra);
    }
    await this.audit.record({
      organizationId: null,
      action: AuditAction.PERSON_MERGE,
      entity: AuditEntity.PERSON,
      entityId: keepId,
      meta: { mergedPersonId: mergeId, movedStudents: outcome.movedStudents, via: 'admin' },
    });
    return {
      person: { id: outcome.keep.id, gingappCode: outcome.keep.gingappCode, name: outcome.keep.name },
      mergedPersonId: mergeId,
      movedStudents: outcome.movedStudents,
    };
  }
}
