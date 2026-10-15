/**
 * Exclusao mutua POR CHAVE dentro do processo (ex.: 'pix:<recordId>', 'token:<orgId>'): chamadas com a mesma chave
 * rodam uma depois da outra. Cobre cliques duplos / requisicoes paralelas na MESMA instancia; entre replicas, a
 * chave de idempotencia enviada ao provedor e os filtros de status no WHERE seguram (PLANO_PROJETO.md 10.52).
 */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<unknown>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(fn);
    const tail = current.catch(() => undefined);
    this.tails.set(key, tail);
    try {
      return await current;
    } finally {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}
