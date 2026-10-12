/**
 * Ciclo de vida de um pedido de exclusao/anonimizacao (LGPD). A coluna `status` e' texto livre de proposito; estes sao
 * os valores validos. Marcar DONE apenas REGISTRA que a equipe tratou o pedido: NADA e' apagado automaticamente (o
 * processo e' manual e esta documentado em docs/EASYPANEL.md, "Pedidos de exclusao de dados (LGPD)").
 */
export const DELETION_REQUEST_STATUSES = ['PENDING', 'IN_PROGRESS', 'DONE', 'REJECTED'] as const;
export type DeletionRequestStatus = (typeof DELETION_REQUEST_STATUSES)[number];

/** Pedido "aberto" (ainda sem decisao): o usuario nao pode abrir outro enquanto houver um assim. */
export const OPEN_DELETION_STATUSES: readonly string[] = ['PENDING', 'IN_PROGRESS'];

/** Estados terminais: gravam resolvedAt. */
export const FINAL_DELETION_STATUSES: readonly string[] = ['DONE', 'REJECTED'];
