import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { TournamentsService } from '../../interface/http/tournaments/tournaments.service';

export interface CompetitorAnonymizationInput {
  /** Alunos (matriculas) anonimizados: os atletas ligados a eles perdem foto e nome. */
  studentIds?: number[];
  /** Participantes de evento (convidados) cuja inscricao foi anonimizada. */
  eventParticipantIds?: number[];
}

/**
 * Ponte da anonimizacao LGPD para o chaveamento (docs/CONTRATO_FOTO_UPLOAD_CAMERA.md secao 3): os atletas do chaveamento
 * ligados ao aluno/participante anonimizado perdem a foto propria (arquivo apagado), viram 'Atleta removido',
 * `photoAuthorized=false`, `revision` sobe e o hub e notificado - tudo dentro de `TournamentsService.anonymizeCompetitors`.
 *
 * O `TournamentsService` e resolvido sob demanda (`ModuleRef`, fora do grafo de modulos) para NAO criar dependencia
 * circular entre os modulos (o chaveamento importa o modulo de formularios). Chamar DEPOIS do commit da anonimizacao.
 * NUNCA lanca: falha vira log `warn` sem dados pessoais (a anonimizacao dos dados pessoais ja foi confirmada; o GC/expiracao do chaveamento recolhe o resto).
 */
@Injectable()
export class CompetitorAnonymizer {
  private readonly logger = new Logger(CompetitorAnonymizer.name);

  constructor(private readonly moduleRef: ModuleRef) {}

  async anonymize(input: CompetitorAnonymizationInput): Promise<void> {
    const studentIds = [...new Set(input.studentIds ?? [])];
    const eventParticipantIds = [...new Set(input.eventParticipantIds ?? [])];
    if (studentIds.length === 0 && eventParticipantIds.length === 0) return;
    try {
      // A guarda cobre o servico ausente (modulo do chaveamento fora do app) e uma versao sem o metodo.
      const tournaments = this.moduleRef.get(TournamentsService, { strict: false }) as TournamentsService | undefined;
      if (!tournaments || typeof tournaments.anonymizeCompetitors !== 'function') {
        this.logger.warn(
          `Atletas do chaveamento NÃO anonimizados (motivo: TournamentsService.anonymizeCompetitors indisponível; alunos=${studentIds.length}, participantes=${eventParticipantIds.length}). Pendente de reconciliação.`,
        );
        return;
      }
      await tournaments.anonymizeCompetitors({ studentIds, eventParticipantIds });
    } catch (error) {
      // Sem dados pessoais no log: so o tipo do erro e as contagens (a mensagem do erro pode ecoar valores de consulta).
      const reason = error instanceof Error ? `${error.name}${(error as { code?: unknown }).code ? ` ${String((error as { code?: unknown }).code)}` : ''}` : 'erro desconhecido';
      this.logger.warn(
        `Atletas do chaveamento NÃO anonimizados (motivo: ${reason}; alunos=${studentIds.length}, participantes=${eventParticipantIds.length}). Pendente de reconciliação.`,
      );
    }
  }
}
