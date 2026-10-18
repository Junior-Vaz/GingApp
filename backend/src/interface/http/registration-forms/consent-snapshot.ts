import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { effectiveConsentText } from './form-common';

type Db = Pick<Prisma.TransactionClient, 'registrationForm' | 'registrationConsentVersion'>;

/**
 * Garante o SNAPSHOT do texto de consentimento efetivo do formulario (RegistrationConsentVersion) e devolve a versao
 * VIGENTE. Sem snapshot ainda (formulario novo/antigo): grava o atual com a versao que o formulario ja tem. Texto efetivo
 * diferente do ultimo snapshot (SHA-256): versao + 1 (formulario e snapshot andam juntos). Chamado na mesma transacao de
 * quem muda o texto (criar/salvar/duplicar) e do envio publico (linha do formulario ja travada), entao nao ha corrida.
 */
export async function syncConsentSnapshot(db: Db, formId: number): Promise<{ version: number; bumped: boolean }> {
  const form = await db.registrationForm.findUniqueOrThrow({
    where: { id: formId },
    select: {
      consentText: true,
      retentionMonths: true,
      consentVersion: true,
      fields: { where: { archived: false }, orderBy: [{ order: 'asc' }, { id: 'asc' }], select: { key: true, type: true, label: true, required: true } },
    },
  });
  const text = effectiveConsentText(form, form.fields);
  const textHash = createHash('sha256').update(text).digest('hex');
  const latest = await db.registrationConsentVersion.findFirst({ where: { formId }, orderBy: { version: 'desc' } });
  if (latest && latest.textHash === textHash) {
    if (latest.version !== form.consentVersion) await db.registrationForm.update({ where: { id: formId }, data: { consentVersion: latest.version } });
    return { version: latest.version, bumped: false };
  }
  const version = latest ? Math.max(latest.version, form.consentVersion) + 1 : form.consentVersion;
  await db.registrationConsentVersion.create({ data: { formId, version, textHash, text } });
  if (version !== form.consentVersion) await db.registrationForm.update({ where: { id: formId }, data: { consentVersion: version } });
  return { version, bumped: latest !== null };
}
