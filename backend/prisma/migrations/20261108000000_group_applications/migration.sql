-- Adesao de grupos (docs/CONTRATO_ADESAO_GRUPOS.md secao 2): pedido PUBLICO de cadastro de grupo, aprovado ou rejeitado
-- pela equipe da plataforma. Nenhuma conta nem grupo existe antes da aprovacao: so esta linha, com a senha ja em hash
-- bcrypt (apagada ao decidir/expirar) e o SHA-256 do token de acompanhamento (o token em claro nunca e gravado).
-- Nenhuma coluna de IP/User-Agent. So ADICIONA: nenhuma tabela existente muda (a FK fica do lado do pedido).
-- Escrita a mao (sem BOM). O indice UNICO PARCIAL em lower(email) e os CHECKs nao sao modelados pelo Prisma.

-- CreateEnum
CREATE TYPE "GroupApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ApplicantRole" AS ENUM ('MESTRE', 'CONTRAMESTRE', 'PROFESSOR', 'INSTRUTOR', 'MONITOR', 'OUTRO');

-- CreateTable
CREATE TABLE "GroupApplication" (
    "id" SERIAL NOT NULL,
    "status" "GroupApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "applicantName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT,
    "claimedRole" "ApplicantRole" NOT NULL,
    "groupName" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "estimatedStudents" INTEGER,
    "message" TEXT,
    "termsVersion" TEXT NOT NULL,
    "termsAcceptedAt" TIMESTAMP(3) NOT NULL,
    "adultDeclaredAt" TIMESTAMP(3) NOT NULL,
    "statusTokenHash" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" INTEGER,
    "rejectionReason" TEXT,
    "internalNote" TEXT,
    "organizationId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupApplication_pkey" PRIMARY KEY ("id"),
    -- Defesa em profundidade (o DTO ja valida a sigla contra a lista de UFs): 2 letras maiusculas.
    CONSTRAINT "GroupApplication_state_check" CHECK ("state" ~ '^[A-Z]{2}$'),
    -- Pedido PENDENTE sempre tem a senha (em hash) para criar a conta na aprovacao; decidido/expirado pode (e deve) ter null.
    CONSTRAINT "GroupApplication_pending_password_check" CHECK ("status" <> 'PENDING' OR "passwordHash" IS NOT NULL)
);

-- CreateIndex
CREATE UNIQUE INDEX "GroupApplication_statusTokenHash_key" ON "GroupApplication"("statusTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "GroupApplication_organizationId_key" ON "GroupApplication"("organizationId");

-- CreateIndex
CREATE INDEX "GroupApplication_status_createdAt_idx" ON "GroupApplication"("status", "createdAt");

-- CreateIndex (manual): no maximo 1 pedido PENDENTE por e-mail (sem diferenciar maiusculas); dois POSTs simultaneos com o
-- mesmo e-mail = um grava, o outro recebe P2002 e responde o mesmo 201 sem gravar (sem enumeracao de contas).
CREATE UNIQUE INDEX "GroupApplication_email_pending_key" ON "GroupApplication"(lower("email")) WHERE "status" = 'PENDING';

-- AddForeignKey
ALTER TABLE "GroupApplication" ADD CONSTRAINT "GroupApplication_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
