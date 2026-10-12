import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, StudentStatus } from '@prisma/client';
import { buildCsv, EXPORT_MAX_ROWS } from '../../../shared/csv/csv';
import { formatCivilDateBR } from '../../../shared/dates/format-br';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { ImportStudentsDto } from './dto/import-students.dto';
import { ListStudentsQueryDto } from './dto/list-students-query.dto';
import {
  civilKey,
  normalizeText,
  ParsedStudentRow,
  parseStudentRow,
  STUDENT_STATUS_LABEL_BR,
  UnitRef,
} from './student-import';
import { StudentsService } from './students.service';

export type ImportAction = 'CREATE' | 'IGNORE' | 'ERROR';

export interface ImportItem {
  /** Linha no arquivo (cabeçalho = 1). */
  line: number;
  name: string;
  /** CREATE = criado (ou, no dryRun, seria criado); IGNORE = já existe (idempotência); ERROR = linha inválida. */
  action: ImportAction;
  /** ERROR: todas as falhas da linha. IGNORE: o motivo. */
  messages: string[];
}

export interface ImportResult {
  dryRun: boolean;
  total: number;
  created: number;
  ignored: number;
  failed: number;
  /** Limite do plano (null = sem limite): alunos ATIVOS já cadastrados e vagas que sobravam ANTES da importação. */
  plan: { maxStudents: number; planName: string; activeStudents: number; availableSlots: number } | null;
  items: ImportItem[];
}

export const STUDENT_CSV_HEADERS = [
  'Nome',
  'Data de nascimento',
  'E-mail',
  'Telefone',
  'CPF',
  'Unidade',
  'Situação',
  'Data de ingresso',
] as const;

/**
 * Importação e exportação CSV de alunos. A IMPORTAÇÃO recebe as linhas já parseadas pelo painel (JSON, máx. 500),
 * valida cada uma (erros por linha), é IDEMPOTENTE (não duplica quem já existe por e-mail OU por nome + nascimento,
 * nem repetidos dentro do próprio arquivo), respeita Plan.maxStudents e grava numa única transação. A EXPORTAÇÃO usa o
 * mesmo `where` da lista (StudentsService.listWhere): filtros da tela + escopo por unidade do professor.
 */
@Injectable()
export class StudentTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly students: StudentsService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  async importRows(organizationId: number, dto: ImportStudentsDto, now: Date = new Date()): Promise<ImportResult> {
    const dryRun = dto.dryRun === true;
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    // Unidades do grupo por nome normalizado (se houver duas com o mesmo nome, a ATIVA vence).
    const unitRows = await this.prisma.unit.findMany({
      where: { organizationId },
      select: { id: true, name: true, status: true },
      orderBy: { id: 'asc' },
    });
    const units = new Map<string, UnitRef>();
    for (const u of unitRows) {
      const key = normalizeText(u.name);
      const ref: UnitRef = { id: u.id, name: u.name, active: u.status === 'ACTIVE' };
      const current = units.get(key);
      if (!current || (!current.active && ref.active)) units.set(key, ref);
    }

    const items: ImportItem[] = [];
    const valid: { index: number; row: ParsedStudentRow }[] = [];
    dto.rows.forEach((raw, index) => {
      const line = raw.line ?? index + 2;
      const parsed = parseStudentRow(raw, units, today);
      if (parsed.ok) {
        valid.push({ index, row: parsed.row });
        items.push({ line, name: parsed.row.name, action: 'CREATE', messages: [] });
      } else {
        items.push({ line, name: (raw.name ?? '').trim(), action: 'ERROR', messages: parsed.errors });
      }
    });

    // Idempotência: já existe no grupo (e-mail, ou nome + nascimento) ou repetido antes no próprio arquivo.
    const existing = await this.findExisting(
      organizationId,
      valid.map((v) => v.row),
    );
    const seenEmail = new Map<string, number>();
    const seenNameBirth = new Map<string, number>();
    const toCreate: ParsedStudentRow[] = [];
    for (const { index, row } of valid) {
      const item = items[index]!;
      const emailKey = row.email;
      const nameBirthKey = row.birthDate ? `${normalizeText(row.name)}|${civilKey(row.birthDate)}` : null;
      let reason: string | null = null;
      if (emailKey && existing.emails.has(emailKey)) reason = 'Já existe um aluno com este e-mail.';
      else if (nameBirthKey && existing.nameBirth.has(nameBirthKey)) reason = 'Já existe um aluno com este nome e data de nascimento.';
      else if (emailKey && seenEmail.has(emailKey)) reason = `E-mail repetido na linha ${items[seenEmail.get(emailKey)!]!.line} do arquivo.`;
      else if (nameBirthKey && seenNameBirth.has(nameBirthKey)) {
        reason = `Nome e nascimento repetidos na linha ${items[seenNameBirth.get(nameBirthKey)!]!.line} do arquivo.`;
      }
      if (reason) {
        item.action = 'IGNORE';
        item.messages = [reason];
        continue;
      }
      if (emailKey) seenEmail.set(emailKey, index);
      if (nameBirthKey) seenNameBirth.set(nameBirthKey, index);
      toCreate.push(row);
    }

    // Limite do plano: só alunos ATIVOS ocupam vaga (mesma regra de StudentsService.create). Quem passa do limite
    // vira erro da linha (as anteriores entram) — nunca estoura o plano.
    const subscription = await this.subscriptions.findOpenForOrganization(organizationId);
    const maxStudents = subscription?.plan.maxStudents ?? null;
    let plan: ImportResult['plan'] = null;
    let creatable = toCreate;
    if (maxStudents) {
      const activeStudents = await this.prisma.student.count({ where: { organizationId, status: StudentStatus.ACTIVE } });
      let slots = Math.max(0, maxStudents - activeStudents);
      plan = { maxStudents, planName: subscription!.plan.name, activeStudents, availableSlots: slots };
      creatable = [];
      const kept = new Set<ParsedStudentRow>();
      for (const row of toCreate) {
        if (row.status === StudentStatus.ACTIVE) {
          if (slots <= 0) continue;
          slots--;
        }
        kept.add(row);
        creatable.push(row);
      }
      for (const { index, row } of valid) {
        const item = items[index]!;
        if (item.action === 'CREATE' && !kept.has(row)) {
          item.action = 'ERROR';
          item.messages = [`Limite de ${maxStudents} alunos do plano "${plan.planName}" atingido. Faça upgrade do plano.`];
        }
      }
    }

    if (!dryRun && creatable.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        // Reconfere o limite DENTRO da transação (outra criação pode ter ocupado vagas desde a leitura acima).
        if (maxStudents) {
          const activeNow = await tx.student.count({ where: { organizationId, status: StudentStatus.ACTIVE } });
          const newActive = creatable.filter((r) => r.status === StudentStatus.ACTIVE).length;
          if (activeNow + newActive > maxStudents) {
            throw new ConflictException('O limite de alunos do plano mudou durante a importação. Tente novamente.');
          }
        }
        await tx.student.createMany({
          data: creatable.map((r) => ({
            organizationId,
            unitId: r.unitId,
            name: r.name,
            birthDate: r.birthDate,
            document: r.document,
            phone: r.phone,
            email: r.email,
            status: r.status,
            joinedAt: r.joinedAt,
          })),
        });
      });
    }

    const count = (action: ImportAction) => items.filter((i) => i.action === action).length;
    return {
      dryRun,
      total: items.length,
      created: count('CREATE'),
      ignored: count('IGNORE'),
      failed: count('ERROR'),
      plan,
      items,
    };
  }

  /** Alunos do grupo que colidem com as linhas: e-mails (sem diferenciar maiúsculas) e nome normalizado + nascimento. */
  private async findExisting(
    organizationId: number,
    rows: ParsedStudentRow[],
  ): Promise<{ emails: Set<string>; nameBirth: Set<string> }> {
    const emails = [...new Set(rows.map((r) => r.email).filter((e): e is string => !!e))];
    const births = [...new Map(rows.filter((r) => r.birthDate).map((r) => [civilKey(r.birthDate!), r.birthDate!])).values()];
    const or: Prisma.StudentWhereInput[] = [];
    if (emails.length > 0) or.push(...emails.map((email) => ({ email: { equals: email, mode: 'insensitive' as const } })));
    if (births.length > 0) or.push({ birthDate: { in: births } });
    const result = { emails: new Set<string>(), nameBirth: new Set<string>() };
    if (or.length === 0) return result;
    const found = await this.prisma.student.findMany({
      where: { organizationId, OR: or },
      select: { name: true, email: true, birthDate: true },
    });
    for (const s of found) {
      if (s.email) result.emails.add(s.email.toLowerCase());
      if (s.birthDate) result.nameBirth.add(`${normalizeText(s.name)}|${civilKey(s.birthDate)}`);
    }
    return result;
  }

  /** CSV dos alunos (mesmas colunas do modelo de importação) sob os filtros da lista e o escopo do usuário. */
  async exportCsv(
    organizationId: number,
    query: ListStudentsQueryDto,
    user: AuthenticatedUser,
  ): Promise<{ csv: string; total: number }> {
    const where = await this.students.listWhere(organizationId, query, user);
    const [rows, total, units] = await Promise.all([
      this.prisma.student.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: EXPORT_MAX_ROWS }),
      this.prisma.student.count({ where }),
      this.prisma.unit.findMany({ where: { organizationId }, select: { id: true, name: true } }),
    ]);
    const unitName = new Map(units.map((u) => [u.id, u.name]));
    const csv = buildCsv(
      STUDENT_CSV_HEADERS,
      rows.map((s) => [
        s.name,
        s.birthDate ? formatCivilDateBR(s.birthDate) : '',
        s.email ?? '',
        s.phone ?? '',
        s.document ?? '',
        s.unitId !== null ? (unitName.get(s.unitId) ?? '') : '',
        STUDENT_STATUS_LABEL_BR[s.status],
        s.joinedAt ? formatCivilDateBR(s.joinedAt) : '',
      ]),
    );
    return { csv, total };
  }
}
