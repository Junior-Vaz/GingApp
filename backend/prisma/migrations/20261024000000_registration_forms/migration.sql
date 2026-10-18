-- Formularios de inscricao publicos (docs/PLANO_FORMULARIOS_INSCRICAO.md, F1): formulario + secoes + campos,
-- inscricoes anonimas (CPF com hash + AES-GCM da ficha unica, IP so como HMAC) e anexos PRIVADOS.

-- CreateEnum
CREATE TYPE "RegistrationFormStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RegistrationPaymentMode" AS ENUM ('NONE', 'PIX_MANUAL', 'PIX_AUTO');

-- CreateEnum
CREATE TYPE "RegistrationSubmissionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'WAITLIST', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RegistrationPaymentStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'CONFIRMED');

-- CreateTable
CREATE TABLE "RegistrationForm" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "eventId" INTEGER,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "intro" TEXT,
    "bannerUrl" TEXT,
    "status" "RegistrationFormStatus" NOT NULL DEFAULT 'DRAFT',
    "opensAt" TIMESTAMP(3),
    "closesAt" TIMESTAMP(3),
    "maxSubmissions" INTEGER,
    "allowWaitlist" BOOLEAN NOT NULL DEFAULT false,
    "paymentMode" "RegistrationPaymentMode" NOT NULL DEFAULT 'NONE',
    "priceCents" INTEGER,
    "pixKey" TEXT,
    "pixKeyType" TEXT,
    "pixBeneficiary" TEXT,
    "requireApproval" BOOLEAN NOT NULL DEFAULT false,
    "confirmationMessage" TEXT,
    "consentText" TEXT,
    "consentVersion" INTEGER NOT NULL DEFAULT 1,
    "retentionMonths" INTEGER NOT NULL DEFAULT 12,
    "publishedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "purgedAt" TIMESTAMP(3),
    "lastNotifiedAt" TIMESTAMP(3),
    "pendingNotifyCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegistrationForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistrationFormSection" (
    "id" SERIAL NOT NULL,
    "formId" INTEGER NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegistrationFormSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistrationFormField" (
    "id" SERIAL NOT NULL,
    "formId" INTEGER NOT NULL,
    "sectionId" INTEGER,
    "key" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "helpText" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" JSONB,
    "validation" JSONB,
    "showIf" JSONB,
    "mapsTo" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegistrationFormField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistrationSubmission" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "formId" INTEGER NOT NULL,
    "protocol" TEXT NOT NULL,
    "status" "RegistrationSubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "paymentStatus" "RegistrationPaymentStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "answers" JSONB NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "documentHash" TEXT,
    "documentEnc" TEXT,
    "documentLast4" TEXT,
    "consentAt" TIMESTAMP(3) NOT NULL,
    "consentVersion" INTEGER NOT NULL,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "eventParticipantId" INTEGER,
    "personId" INTEGER,
    "studentId" INTEGER,
    "reviewedById" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "internalNote" TEXT,
    "anonymizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegistrationSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistrationSubmissionFile" (
    "id" SERIAL NOT NULL,
    "submissionId" INTEGER,
    "formId" INTEGER NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "pendingToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegistrationSubmissionFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationForm_slug_key" ON "RegistrationForm"("slug");

-- CreateIndex
CREATE INDEX "RegistrationForm_organizationId_status_idx" ON "RegistrationForm"("organizationId", "status");

-- CreateIndex
CREATE INDEX "RegistrationForm_eventId_idx" ON "RegistrationForm"("eventId");

-- CreateIndex
CREATE INDEX "RegistrationFormSection_formId_order_idx" ON "RegistrationFormSection"("formId", "order");

-- CreateIndex
CREATE INDEX "RegistrationFormField_formId_order_idx" ON "RegistrationFormField"("formId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationFormField_formId_key_key" ON "RegistrationFormField"("formId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationSubmission_protocol_key" ON "RegistrationSubmission"("protocol");

-- CreateIndex
CREATE INDEX "RegistrationSubmission_formId_status_idx" ON "RegistrationSubmission"("formId", "status");

-- CreateIndex
CREATE INDEX "RegistrationSubmission_formId_createdAt_idx" ON "RegistrationSubmission"("formId", "createdAt");

-- CreateIndex
CREATE INDEX "RegistrationSubmission_formId_documentHash_idx" ON "RegistrationSubmission"("formId", "documentHash");

-- CreateIndex
CREATE INDEX "RegistrationSubmission_formId_email_idx" ON "RegistrationSubmission"("formId", "email");

-- CreateIndex
CREATE INDEX "RegistrationSubmission_organizationId_idx" ON "RegistrationSubmission"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationSubmissionFile_storageKey_key" ON "RegistrationSubmissionFile"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationSubmissionFile_pendingToken_key" ON "RegistrationSubmissionFile"("pendingToken");

-- CreateIndex
CREATE INDEX "RegistrationSubmissionFile_submissionId_idx" ON "RegistrationSubmissionFile"("submissionId");

-- CreateIndex
CREATE INDEX "RegistrationSubmissionFile_formId_expiresAt_idx" ON "RegistrationSubmissionFile"("formId", "expiresAt");

-- AddForeignKey
ALTER TABLE "RegistrationForm" ADD CONSTRAINT "RegistrationForm_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationForm" ADD CONSTRAINT "RegistrationForm_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationFormSection" ADD CONSTRAINT "RegistrationFormSection_formId_fkey" FOREIGN KEY ("formId") REFERENCES "RegistrationForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationFormField" ADD CONSTRAINT "RegistrationFormField_formId_fkey" FOREIGN KEY ("formId") REFERENCES "RegistrationForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationFormField" ADD CONSTRAINT "RegistrationFormField_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "RegistrationFormSection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationSubmission" ADD CONSTRAINT "RegistrationSubmission_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationSubmission" ADD CONSTRAINT "RegistrationSubmission_formId_fkey" FOREIGN KEY ("formId") REFERENCES "RegistrationForm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationSubmissionFile" ADD CONSTRAINT "RegistrationSubmissionFile_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "RegistrationSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationSubmissionFile" ADD CONSTRAINT "RegistrationSubmissionFile_formId_fkey" FOREIGN KEY ("formId") REFERENCES "RegistrationForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationSubmissionFile" ADD CONSTRAINT "RegistrationSubmissionFile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
