import { Prisma } from '@prisma/client';

/** Nome que fica na inscricao anonimizada (protocolo, situacao, pagamento e datas continuam: contadores intactos). */
export const REMOVED_SUBMISSION_NAME = 'Inscrição removida';
/** guestName do participante do evento criado pela inscricao, depois da anonimizacao (a vaga/presenca continuam). */
export const ANONYMIZED_PARTICIPANT_NAME = 'Participante anonimizado';

/**
 * FORMS_RETENTION_PURGE: `true` apaga de verdade; `dry-run` (PADRAO, protecao contra perda de dados) so registra no
 * log o que faria; `false` desliga o job inteiro. SSOT do modo (o job, o aviso no boot e o resumo do painel leem daqui).
 */
export function formsRetentionMode(env: NodeJS.ProcessEnv = process.env): 'on' | 'off' | 'dry-run' {
  const v = env.FORMS_RETENTION_PURGE?.trim().toLowerCase();
  if (v === 'true' || v === 'on' || v === '1') return 'on';
  if (v === 'false' || v === 'off' || v === '0') return 'off';
  return 'dry-run';
}

/** Modo no formato do contrato do painel (`GET /event-forms/:id/summary` -> retention.mode). */
export function formsRetentionModeLabel(env: NodeJS.ProcessEnv = process.env): 'dry-run' | 'true' | 'false' {
  const mode = formsRetentionMode(env);
  return mode === 'on' ? 'true' : mode === 'off' ? 'false' : 'dry-run';
}

/**
 * ANONIMIZA as inscricoes que casam com `where` (ainda nao anonimizadas), dentro da transacao do chamador: respostas,
 * nome, contato, CPF (hash/cifra/4 ultimos), ipHash, user-agent e notas apagados; linhas de anexo removidas; o nome
 * copiado para o participante do evento (guestName, convidado sem ficha) vira "Participante anonimizado".
 * Devolve as chaves dos arquivos para o chamador apagar do disco DEPOIS do commit (deletePrivateFile).
 * Reaproveitado pela retencao (job FORMS_RETENTION_PURGE), pelo pedido de exclusao LGPD (AnonymizationService) e pela
 * anonimizacao manual do Mestre (POST /event-forms/:id/submissions/:sid/anonymize).
 */
export async function anonymizeSubmissions(
  tx: Prisma.TransactionClient,
  where: Prisma.RegistrationSubmissionWhereInput,
  now: Date,
): Promise<{ count: number; storageKeys: string[]; participants: number }> {
  const rows = await tx.registrationSubmission.findMany({
    where: { AND: [where, { anonymizedAt: null }] },
    select: { id: true, organizationId: true, eventParticipantId: true },
  });
  if (rows.length === 0) return { count: 0, storageKeys: [], participants: 0 };
  const ids = rows.map((r) => r.id);
  const files = await tx.registrationSubmissionFile.findMany({ where: { submissionId: { in: ids } }, select: { id: true, storageKey: true } });
  if (files.length > 0) await tx.registrationSubmissionFile.deleteMany({ where: { id: { in: files.map((f) => f.id) } } });
  // Participante criado pela inscricao (id guardado na propria inscricao, mesmo grupo): so o de CONVIDADO tem o nome
  // copiado (guestName); o ligado a um aluno usa o nome da ficha, que tem o proprio fluxo de exclusao.
  let participants = 0;
  for (const orgId of [...new Set(rows.map((r) => r.organizationId))]) {
    const pids = rows.filter((r) => r.organizationId === orgId && r.eventParticipantId).map((r) => r.eventParticipantId as number);
    if (pids.length === 0) continue;
    const updated = await tx.eventParticipant.updateMany({
      where: { id: { in: pids }, organizationId: orgId, studentId: null, guestName: { not: null } },
      data: { guestName: ANONYMIZED_PARTICIPANT_NAME },
    });
    participants += updated.count;
  }
  await tx.registrationSubmission.updateMany({
    where: { id: { in: ids } },
    data: {
      answers: {},
      name: REMOVED_SUBMISSION_NAME,
      email: null,
      emailKey: null,
      phone: null,
      documentHash: null,
      documentEnc: null,
      documentLast4: null,
      ipHash: null,
      userAgent: null,
      reviewNote: null,
      internalNote: null,
      personId: null,
      studentId: null,
      suggestedStudentId: null,
      anonymizedAt: now,
    },
  });
  return { count: ids.length, storageKeys: files.map((f) => f.storageKey), participants };
}

/** now >= base + N meses (calendario UTC). */
export function addMonths(base: Date, months: number): Date {
  const d = new Date(base.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

/**
 * Data de ENCERRAMENTO usada na retencao: a mais tardia entre prazo (closesAt), encerramento manual (closedAt),
 * arquivamento (archivedAt) e data do evento. null = ainda sem data de encerramento (formulario aberto sem prazo): nesse
 * caso a retencao conta POR INSCRICAO (createdAt + retentionMonths, ver retentionCutoffForUndated).
 */
export function retentionReference(form: {
  closesAt: Date | null;
  closedAt: Date | null;
  archivedAt: Date | null;
  event: { date: Date } | null;
}): Date | null {
  const dates = [form.closesAt, form.closedAt, form.archivedAt, form.event?.date ?? null].filter((d): d is Date => d instanceof Date);
  if (dates.length === 0) return null;
  return new Date(Math.max(...dates.map((d) => d.getTime())));
}

/** Formulario sem data de encerramento: inscricoes criadas ate este instante ja passaram da retencao. */
export function retentionCutoffForUndated(now: Date, retentionMonths: number): Date {
  return addMonths(now, -retentionMonths);
}
