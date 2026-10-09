// SSOT da matriz base RolePermission (perfis de projeto.txt §18).
//
// Importada por prisma/seed.ts (desenvolvimento/e2e) E por prisma/bootstrap.ts (produção) —
// nunca duplicar estes valores em outro lugar. Correções de segurança em bancos JÁ existentes
// continuam sendo entregues por migrations de dados (20261009020000_restrict_professor_finance,
// 20261009030000_restrict_member_roles_least_privilege), que fazem UPSERT forçado das linhas
// afetadas; os valores destas migrations são exatamente os desta matriz (provado pelo spec
// test/bootstrap.e2e-spec.ts, que compara migrate+seed com migrate+bootstrap linha a linha).

import { OrgRole } from '@prisma/client';

type Perms = { view: boolean; create: boolean; edit: boolean; delete: boolean };

export interface PermissionRow {
  role: OrgRole;
  resource: string;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export const PERMISSION_RESOURCES: readonly string[] = [
  'students',
  'classes',
  'lessons',
  'attendance',
  'graduations',
  'finance',
  'events',
  'rodas',
  'announcements',
  'teachers',
  'dashboard',
  'certificates',
];

// Menor privilégio (LGPD): ALUNO/RESPONSAVEL NÃO têm nenhum recurso administrativo por padrão.
// As rotas administrativas (GET /students, /classes, /lessons, /attendance, /graduations...)
// devolvem dados do grupo INTEIRO (inclusive de menores: documento, telefone, e-mail,
// nascimento) — o app do capoeirista usa as rotas escopadas por vínculo (/students/me,
// /classes/me, /lessons/me, /attendance/me, /finance/me, /certificates/me, /passport/me) e
// GET /graduations/students/:id, que checa vínculo no service. Só o que é legitimamente
// visível a qualquer membro do grupo fica liberado (MEMBER_VISIBLE abaixo). Bancos já
// existentes: migration de dados 20261009030000_restrict_member_roles_least_privilege.
const NO_ACCESS: Perms = {
  view: false,
  create: false,
  edit: false,
  delete: false,
};
const MEMBER_VIEW_ONLY: Perms = {
  view: true,
  create: false,
  edit: false,
  delete: false,
};
const DEFAULT_MATRIX: Record<OrgRole, Perms> = {
  [OrgRole.MESTRE]: { view: true, create: true, edit: true, delete: true },
  [OrgRole.PROFESSOR]: { view: true, create: true, edit: true, delete: false },
  [OrgRole.ALUNO]: NO_ACCESS,
  [OrgRole.RESPONSAVEL]: NO_ACCESS,
};
const MEMBER_VISIBLE: Partial<Record<OrgRole, Perms>> = {
  [OrgRole.ALUNO]: MEMBER_VIEW_ONLY,
  [OrgRole.RESPONSAVEL]: MEMBER_VIEW_ONLY,
};
// "teachers" (equipe interna do grupo) é mais restrito que o padrão: só MESTRE gerencia,
// PROFESSOR só enxerga a lista de colegas, aluno/responsável não precisam disso.
const RESOURCE_OVERRIDES: Partial<
  Record<string, Partial<Record<OrgRole, Perms>>>
> = {
  // Visíveis a membros (só view): agenda de eventos do grupo (GET /events; a lista de
  // participantes anonimiza terceiros para quem não é MESTRE/PROFESSOR), comunicados do grupo
  // (GET /announcements) e rodas (GET /rodas é @Public de qualquer forma; "view" não guarda
  // nenhuma rota hoje — mantido como estava).
  events: MEMBER_VISIBLE,
  announcements: MEMBER_VISIBLE,
  rodas: MEMBER_VISIBLE,
  teachers: {
    [OrgRole.PROFESSOR]: {
      view: true,
      create: false,
      edit: false,
      delete: false,
    },
    [OrgRole.ALUNO]: { view: false, create: false, edit: false, delete: false },
    [OrgRole.RESPONSAVEL]: {
      view: false,
      create: false,
      edit: false,
      delete: false,
    },
  },
  // GET /finance retorna TODOS os registros financeiros da organização (não filtrado por
  // aluno) — dar view=true (padrão da matriz default) para ALUNO/RESPONSAVEL exporia a
  // situação financeira de outros alunos. Restrito até existir uma view "meu financeiro"
  // com filtro por studentId (Fase 2, PWA).
  // Decisão do dono: o financeiro do grupo (lista, totais, lançamentos) é SÓ do MESTRE —
  // PROFESSOR não vê nem cria/edita/apaga. Bancos já existentes são atualizados pela migration
  // de dados 20261009020000_restrict_professor_finance.
  finance: {
    [OrgRole.PROFESSOR]: {
      view: false,
      create: false,
      edit: false,
      delete: false,
    },
    [OrgRole.ALUNO]: { view: false, create: false, edit: false, delete: false },
    [OrgRole.RESPONSAVEL]: {
      view: false,
      create: false,
      edit: false,
      delete: false,
    },
  },
  // Dashboard administrativo (projeto.txt §30) é a visão do Mestre/Professor sobre o
  // grupo inteiro — não é a Home do capoeirista (essa é o app.gingapp.com.br, sem RBAC
  // desta matriz). create/edit/delete não existem para este recurso (só view).
  dashboard: {
    [OrgRole.ALUNO]: { view: false, create: false, edit: false, delete: false },
    [OrgRole.RESPONSAVEL]: {
      view: false,
      create: false,
      edit: false,
      delete: false,
    },
  },
  // GET /certificates lista TODOS os certificados da organização (não filtrado por aluno) —
  // mesmo motivo de "finance": view=true do padrão exporia certificados de outros alunos.
  // ALUNO/RESPONSAVEL usam /certificates/me (Fase 2, Jornada do Capoeirista).
  certificates: {
    [OrgRole.ALUNO]: { view: false, create: false, edit: false, delete: false },
    [OrgRole.RESPONSAVEL]: {
      view: false,
      create: false,
      edit: false,
      delete: false,
    },
  },
};

/** Matriz completa (todos os papéis × todos os recursos), na ordem papel → recurso. */
export function buildPermissionMatrix(): PermissionRow[] {
  const rows: PermissionRow[] = [];
  for (const role of Object.values(OrgRole)) {
    for (const resource of PERMISSION_RESOURCES) {
      const perms =
        RESOURCE_OVERRIDES[resource]?.[role] ?? DEFAULT_MATRIX[role];
      rows.push({
        role,
        resource,
        canView: perms.view,
        canCreate: perms.create,
        canEdit: perms.edit,
        canDelete: perms.delete,
      });
    }
  }
  return rows;
}
