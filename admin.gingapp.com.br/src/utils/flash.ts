/**
 * Aviso de uso único que atravessa UMA navegação do SPA (ex.: "Grupo criado" na tela de lista →
 * mostrado na tela de detalhe). Vive só em memória: some ao recarregar a página e é consumido (lido
 * e apagado) por quem o exibe, então nunca reaparece nem vai parar na URL ou no localStorage.
 */
let pending = ''

export function setFlash(message: string): void {
  pending = message
}

/** Devolve o aviso pendente (ou '') e o apaga. */
export function takeFlash(): string {
  const message = pending
  pending = ''
  return message
}
