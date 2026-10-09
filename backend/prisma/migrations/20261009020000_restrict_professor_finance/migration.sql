-- Dados: o financeiro do grupo passa a ser SÓ do MESTRE (decisão do dono).
-- PROFESSOR perde view/create/edit/delete em "finance". RolePermission é global (role x resource,
-- não por organização), então este UPSERT vale para todas as organizações. Idempotente: pode
-- rodar várias vezes e também cria a linha se o banco ainda não tiver sido semeado.
INSERT INTO "RolePermission" ("role", "resource", "canView", "canCreate", "canEdit", "canDelete")
VALUES ('PROFESSOR', 'finance', false, false, false, false)
ON CONFLICT ("role", "resource") DO UPDATE
SET "canView" = false, "canCreate" = false, "canEdit" = false, "canDelete" = false;
