-- E07: cobranca de mensalidade (valor/dia por aluno, competencia, baixa com forma de pagamento, "como pagar").

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'PIX', 'CARD', 'TRANSFER', 'OTHER');

-- AlterTable
ALTER TABLE "FinancialRecord" ADD COLUMN     "competence" TEXT,
ADD COLUMN     "paidCents" INTEGER,
ADD COLUMN     "paymentMethod" "PaymentMethod";

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "paymentInstructions" TEXT;

-- CreateTable
CREATE TABLE "StudentBilling" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "studentId" INTEGER NOT NULL,
    "monthlyFeeCents" INTEGER NOT NULL,
    "dueDay" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentBilling_pkey" PRIMARY KEY ("id"),
    -- Defesa em profundidade: a API ja valida (DTO), o banco recusa o resto.
    CONSTRAINT "StudentBilling_monthlyFeeCents_check" CHECK ("monthlyFeeCents" >= 1),
    CONSTRAINT "StudentBilling_dueDay_check" CHECK ("dueDay" BETWEEN 1 AND 31)
);

-- CreateIndex
CREATE UNIQUE INDEX "StudentBilling_studentId_key" ON "StudentBilling"("studentId");

-- CreateIndex
CREATE INDEX "StudentBilling_organizationId_idx" ON "StudentBilling"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialRecord_studentId_competence_type_key" ON "FinancialRecord"("studentId", "competence", "type");

-- AddForeignKey
ALTER TABLE "StudentBilling" ADD CONSTRAINT "StudentBilling_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentBilling" ADD CONSTRAINT "StudentBilling_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
