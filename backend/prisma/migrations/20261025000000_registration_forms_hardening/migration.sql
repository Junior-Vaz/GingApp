-- Formularios de inscricao (F1) - endurecimento pos-auditoria (PLANO_PROJETO.md 10.64, docs/PLANO_FORMULARIOS_INSCRICAO.md
-- secao 6): sugestao de aluno (o envio anonimo nunca liga a ficha sozinho), chave normalizada do e-mail (duplicidade e
-- limite de e-mails por destinatario), ipHash nos anexos pendentes (teto por IP) e snapshot do texto de consentimento.

-- AlterTable
ALTER TABLE "RegistrationSubmission" ADD COLUMN "suggestedStudentId" INTEGER;
ALTER TABLE "RegistrationSubmission" ADD COLUMN "emailKey" TEXT;

-- Linhas antigas (so ambiente de desenvolvimento ate aqui): chave = e-mail ja normalizado (minusculas).
UPDATE "RegistrationSubmission" SET "emailKey" = lower("email") WHERE "email" IS NOT NULL;

-- AlterTable
ALTER TABLE "RegistrationSubmissionFile" ADD COLUMN "ipHash" TEXT;

-- CreateTable
CREATE TABLE "RegistrationConsentVersion" (
    "id" SERIAL NOT NULL,
    "formId" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "textHash" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegistrationConsentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationConsentVersion_formId_version_key" ON "RegistrationConsentVersion"("formId", "version");

-- CreateIndex
CREATE INDEX "RegistrationSubmission_formId_emailKey_idx" ON "RegistrationSubmission"("formId", "emailKey");

-- CreateIndex
CREATE INDEX "RegistrationSubmission_emailKey_createdAt_idx" ON "RegistrationSubmission"("emailKey", "createdAt");

-- CreateIndex
CREATE INDEX "RegistrationSubmission_formId_ipHash_createdAt_idx" ON "RegistrationSubmission"("formId", "ipHash", "createdAt");

-- CreateIndex
CREATE INDEX "RegistrationSubmissionFile_formId_ipHash_idx" ON "RegistrationSubmissionFile"("formId", "ipHash");

-- CreateIndex
CREATE INDEX "RegistrationSubmissionFile_organizationId_submissionId_idx" ON "RegistrationSubmissionFile"("organizationId", "submissionId");

-- AddForeignKey
ALTER TABLE "RegistrationConsentVersion" ADD CONSTRAINT "RegistrationConsentVersion_formId_fkey" FOREIGN KEY ("formId") REFERENCES "RegistrationForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;
