import { createContext, useContext } from "react";

/**
 * Onde o atleta está: a foto PRÓPRIA dele (`GET /categories/:cid/competitors/:id/photo`) é buscada com o id do evento e
 * o da CATEGORIA do atleta (a rota confere os dois). Quem renderiza uma categoria (aba da categoria, mesa de controle)
 * fornece isto; sem escopo, só a foto do aluno (`photoUrl`) e as iniciais aparecem.
 */
export interface PhotoScopeValue {
  eventId: number;
  categoryId: number;
}

export const PhotoScopeContext = createContext<PhotoScopeValue | null>(null);

export const usePhotoScope = (): PhotoScopeValue | null => useContext(PhotoScopeContext);
