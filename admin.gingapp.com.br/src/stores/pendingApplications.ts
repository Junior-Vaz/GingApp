import { ref } from 'vue'
import { defineStore } from 'pinia'
import { fetchPendingCount } from '@/utils/groupApplicationsApi'

/**
 * Contador de pedidos de adesão pendentes (item do menu "Pedidos de adesão").
 * Compartilhado entre o menu (carrega ao abrir o admin) e a tela (atualiza após cada decisão).
 * `null` = desconhecido (ainda não carregou ou falhou): o menu mostra o item sem número.
 */
export const usePendingApplicationsStore = defineStore('pendingApplications', () => {
  const count = ref<number | null>(null)

  async function refresh(): Promise<void> {
    const value = await fetchPendingCount()
    // Falha na contagem não apaga o último número bom: só ignora.
    if (value !== null) count.value = value
  }

  return { count, refresh }
})
