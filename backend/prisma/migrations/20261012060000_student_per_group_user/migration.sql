-- Um usuario pode ser ALUNO em mais de um grupo (um Student por organizacao): Student.userId deixa de ser
-- unico global e passa a ser unico por (organizationId, userId). NULLs (aluno sem login) seguem repetiveis.
-- DropIndex
DROP INDEX "Student_userId_key";

-- CreateIndex
CREATE INDEX "Student_userId_idx" ON "Student"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Student_organizationId_userId_key" ON "Student"("organizationId", "userId");
