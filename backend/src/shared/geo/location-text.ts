import { PrismaService } from '../prisma/prisma.service';

/**
 * Partes de texto para geocodificar o LOCAL de um evento/roda: o texto livre `location` + nome da cidade + UF
 * (State/City sao tabelas publicas). Sem `location` devolve [] de proposito: so' cidade/estado cairia no centro
 * da cidade, um ponto enganoso no mapa (o usuario pode informar as coordenadas na mao).
 */
export async function locationGeocodeParts(
  prisma: PrismaService,
  input: { location?: string | null; stateId?: number | null; cityId?: number | null },
): Promise<string[]> {
  const location = (input.location ?? '').trim();
  if (!location) return [];
  const [city, state] = await Promise.all([
    input.cityId != null ? prisma.city.findUnique({ where: { id: input.cityId }, include: { state: true } }) : null,
    input.stateId != null ? prisma.state.findUnique({ where: { id: input.stateId } }) : null,
  ]);
  return [location, city?.name ?? '', state?.uf ?? city?.state.uf ?? ''];
}
