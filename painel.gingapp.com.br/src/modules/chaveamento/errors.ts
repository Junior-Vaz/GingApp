import { ApiError } from "@/lib/api";

/**
 * Códigos de erro de negócio do chaveamento (corpo `{ statusCode, message, code }`, docs/CONTRATO_CHAVEAMENTO.md 4 e
 * backend `tournament-rules.ts`). Cada um tem uma mensagem em português, clara e acionável (o que fazer agora).
 * Erros de validação do DTO chegam SEM `code`: nesse caso vale a mensagem do servidor (já em português).
 */
export const TOURNAMENT_ERROR_MESSAGES = {
  TOURNAMENT_NOT_FOUND: "Este evento ainda não tem chaveamento. Crie o chaveamento para começar.",
  TOURNAMENT_EXISTS: "Este evento já tem um chaveamento. Atualize a página para vê-lo.",
  EVENT_NOT_TOURNAMENT: "O chaveamento só existe para eventos do tipo Campeonato. Mude o tipo do evento em Eventos > Editar.",
  EVENT_NOT_FOUND: "Evento não encontrado. Volte para a lista de eventos e abra o evento de novo.",
  CATEGORY_NOT_FOUND: "Categoria não encontrada. Ela pode ter sido excluída por outra pessoa; atualize a página.",
  COMPETITOR_NOT_FOUND: "Atleta não encontrado nesta categoria. Atualize a página e tente de novo.",
  MATCH_NOT_FOUND: "Luta não encontrada. A chave pode ter sido sorteada de novo; atualize a página.",
  CATEGORY_LIMIT: "Este campeonato já tem o máximo de 40 categorias. Exclua uma que não será usada.",
  CATEGORY_NAME_TAKEN: "Já existe uma categoria com esse nome neste campeonato. Escolha outro nome.",
  CATEGORY_FULL: "A categoria já tem o máximo de 128 atletas. Crie outra categoria para os demais.",
  NOT_IN_SETUP: "A chave desta categoria já foi gerada, então não dá mais para mudar atletas ou o formato. Só nome, grupo, graduação e foto podem ser corrigidos.",
  COMPETITOR_EXISTS: "Este atleta já está nesta categoria.",
  SEED_TAKEN: "Outro atleta já usa essa semente nesta categoria. Escolha outro número ou limpe a semente do outro atleta.",
  ALREADY_GENERATED: "A chave já foi gerada. Use \"Sortear de novo\" se quiser refazer o sorteio.",
  HAS_RESULTS: "Há lutas em andamento ou já encerradas, então não dá para refazer o sorteio nem excluir a categoria. Desfaça os resultados (na ordem inversa) e tente de novo.",
  NOT_ENOUGH_COMPETITORS: "Cadastre pelo menos 2 atletas antes de gerar a chave.",
  NOT_GENERATED: "A chave desta categoria ainda não foi gerada. Faça o sorteio primeiro.",
  SWAP_NOT_ALLOWED: "Não dá para trocar esses atletas: a troca só vale na 1ª rodada de uma eliminatória e antes de qualquer luta começar.",
  MATCH_ALREADY_FINISHED: "Esta luta já tem resultado. Desfaça a luta antes de registrar outro resultado.",
  MATCH_NOT_READY: "A luta ainda não tem os dois atletas. Termine as lutas anteriores primeiro.",
  MATCH_IS_BYE: "Esta luta é uma folga (só um atleta): não há resultado para registrar nem desfazer.",
  NOTHING_TO_UNDO: "Esta luta ainda não foi iniciada, então não há o que desfazer.",
  DEPENDENT_MATCH_PLAYED: "A próxima luta já começou. Desfaça as lutas seguintes primeiro, na ordem inversa.",
  INCONSISTENT_STATE: "A chave ficou em um estado inesperado. Atualize a página e tente de novo; se repetir, avise o suporte.",
  INVALID_GROUP_CONFIG: "A configuração de grupos não combina com o número de atletas. Revise a quantidade de grupos e de classificados por grupo (cada grupo precisa de atletas suficientes e o mata-mata, de pelo menos 2 classificados).",
  INVALID_RESULT: "Resultado inválido. Escolha o vencedor entre os dois atletas; o placar vai de 0 a 999 e, em empate, os dois lados devem ser iguais. Empate só vale na fase de grupos.",
  INVALID_COMPETITOR: "Atleta inválido. Escolha dois atletas diferentes desta categoria.",
  AGE_GROUP_FROM_STUDENT: "A faixa etária deste atleta vem do cadastro do aluno e não pode ser alterada aqui.",
  INVALID_PHOTO_URL: "Endereço de foto inválido. Use um link que comece com https:// ou uma foto enviada pelo GingApp.",
  PARTICIPANT_NOT_ELIGIBLE: "Só participantes confirmados ou com presença registrada podem entrar na chave. Confirme a inscrição em Eventos > Participantes.",
  STUDENT_NOT_ELIGIBLE: "Este aluno não pode entrar na chave (cadastro inativo ou de outro grupo). Confira o cadastro do aluno.",
  TOO_MANY_VIEWERS: "Muitas pessoas estão assistindo agora. Tente de novo em instantes.",
} as const;

export type TournamentErrorCode = keyof typeof TOURNAMENT_ERROR_MESSAGES;

export const TOURNAMENT_ERROR_CODES = Object.keys(TOURNAMENT_ERROR_MESSAGES) as TournamentErrorCode[];

export function isTournamentErrorCode(code: string | undefined): code is TournamentErrorCode {
  return code !== undefined && Object.prototype.hasOwnProperty.call(TOURNAMENT_ERROR_MESSAGES, code);
}

/** Código de negócio do erro, quando é um dos conhecidos do chaveamento. */
export function tournamentErrorCode(error: unknown): TournamentErrorCode | undefined {
  return error instanceof ApiError && isTournamentErrorCode(error.code) ? error.code : undefined;
}

/**
 * Mensagem para o operador: o mapa por `code`; sem `code` conhecido, o texto do servidor (validação de DTO já vem em
 * português); sem nada disso (rede, 5xx sem corpo), o `fallback`.
 */
export function chaveamentoErrorMessage(error: unknown, fallback = "Não foi possível concluir a ação. Tente de novo."): string {
  const code = tournamentErrorCode(error);
  if (code) return TOURNAMENT_ERROR_MESSAGES[code];
  if (error instanceof ApiError) {
    if (error.status === 403) return "Você não tem permissão para alterar o chaveamento. Peça a um professor ou ao mestre.";
    if (error.status === 401) return error.message;
    if (error.status >= 500) return fallback;
    return error.message || fallback;
  }
  return fallback;
}
