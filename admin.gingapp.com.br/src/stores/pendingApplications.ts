import { ref } from 'vue'
import { defineStore } from 'pinia'
import { fetchPendingCount } from '@/utils/groupApplicationsApi'

/** Intervalo da atualização automática do contador enquanto a aba do navegador está visível. */
export const PENDING_POLL_INTERVAL_MS = 60_000

/**
 * Contador de pedidos de adesão pendentes (item do menu "Pedidos de adesão").
 * Compartilhado entre o menu (carrega ao abrir o admin) e a tela (atualiza após cada decisão e a cada 60 s).
 * `null` = desconhecido (ainda não carregou ou falhou): o menu mostra o item sem número.
 * Pedidos `UNVERIFIED` (e-mail não confirmado) NÃO entram na conta: o servidor já os exclui.
 */
export const usePendingApplicationsStore = defineStore('pendingApplications', () => {
  const count = ref<number | null>(null)

  async function refresh(): Promise<void> {
    const value = await fetchPendingCount()
    // Falha na contagem não apaga o último número bom: só ignora.
    if (value !== null) count.value = value
  }

  // --- atualização periódica -----------------------------------------------------------------
  // Só roda com a aba visível: oculta, o timer é desligado (sem requisições em segundo plano); ao voltar a ficar
  // visível atualiza na hora e religa. `startPolling` é idempotente; `stopPolling` limpa timer e listener.
  let timer: ReturnType<typeof setInterval> | null = null
  let polling = false

  const isHidden = (): boolean => typeof document !== 'undefined' && (document.hidden || document.visibilityState === 'hidden')

  function clearTimer(): void {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  function armTimer(): void {
    clearTimer()
    timer = setInterval(() => void refresh(), PENDING_POLL_INTERVAL_MS)
  }

  function onVisibilityChange(): void {
    if (!polling) return
    if (isHidden()) {
      clearTimer()
      return
    }
    void refresh()
    armTimer()
  }

  function startPolling(): void {
    if (polling) return
    polling = true
    document.addEventListener('visibilitychange', onVisibilityChange)
    if (!isHidden()) armTimer()
  }

  function stopPolling(): void {
    polling = false
    clearTimer()
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }

  return { count, refresh, startPolling, stopPolling }
})
