-- Dados (LGPD, menor privilégio): ALUNO e RESPONSAVEL deixam de ter acesso às rotas
-- ADMINISTRATIVAS que devolvem dados do grupo inteiro (GET /students, /students/:id, /classes,
-- /lessons, /attendance, /attendance/lessons/:id, /graduations...) — inclusive documento,
-- telefone, e-mail e nascimento de menores. O app do capoeirista usa as rotas escopadas por
-- vínculo (/students/me, /classes/me, /lessons/me, /attendance/me, /finance/me,
-- /certificates/me, /passport/me) e GET /graduations/students/:id, que passou a checar o
-- vínculo (próprio aluno ou dependente) no service, sem depender desta matriz.
--
-- finance/teachers/dashboard/certificates já eram false no seed; entram aqui só para corrigir
-- qualquer banco que tenha divergido. events/announcements/rodas (view) NÃO são tocados: são
-- legitimamente visíveis a membros (a lista de participantes de evento/roda anonimiza
-- terceiros no service). MESTRE/PROFESSOR não são tocados.
--
-- RolePermission é global (role x resource, não por organização): vale para todas as
-- organizações. Idempotente (mesmo padrão de 20261009020000_restrict_professor_finance): pode
-- rodar várias vezes e também cria a linha se o banco ainda não tiver sido semeado.
INSERT INTO "RolePermission" ("role", "resource", "canView", "canCreate", "canEdit", "canDelete")
SELECT r.role::"OrgRole", res.resource, false, false, false, false
FROM (VALUES ('ALUNO'), ('RESPONSAVEL')) AS r(role)
CROSS JOIN (
  VALUES ('students'), ('classes'), ('lessons'), ('attendance'), ('graduations'),
         ('finance'), ('teachers'), ('dashboard'), ('certificates')
) AS res(resource)
ON CONFLICT ("role", "resource") DO UPDATE
SET "canView" = false, "canCreate" = false, "canEdit" = false, "canDelete" = false;
