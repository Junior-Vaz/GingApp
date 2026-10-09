import { PageQueryDto } from '../../../../shared/pagination/pagination';

/** Filtros de GET /units: só paginação (limit/offset) e q (busca no nome). */
export class ListUnitsQueryDto extends PageQueryDto {}
