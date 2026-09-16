<script setup lang="ts">
// Rota sensível: dados financeiros nunca são cacheados agressivamente pelo
// service worker (ver vite.config.ts → workbox.runtimeCaching e
// navigateFallbackDenylist para /app/financeiro — PLANO_PROJETO.md §6).
const cobrancas = [
  { id: 1, mes: 'Setembro/2026', valor: 'R$ 120,00', status: 'Pago' },
  { id: 2, mes: 'Outubro/2026', valor: 'R$ 120,00', status: 'Em aberto' },
]
</script>

<template>
  <div class="flex flex-col gap-6 px-5 pb-6 pt-6">
    <header>
      <h1 class="text-xl font-semibold text-text">Financeiro</h1>
      <p class="text-sm text-text-muted">Mensalidades e pagamentos</p>
    </header>

    <section class="flex flex-col gap-3">
      <article
        v-for="cobranca in cobrancas"
        :key="cobranca.id"
        class="flex items-center justify-between rounded-card bg-surface p-4"
      >
        <div>
          <p class="text-sm font-semibold text-text">{{ cobranca.mes }}</p>
          <p class="text-xs text-text-muted">{{ cobranca.valor }}</p>
        </div>
        <span
          class="rounded-full px-3 py-1 text-xs font-semibold"
          :class="cobranca.status === 'Pago' ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'"
        >
          {{ cobranca.status }}
        </span>
      </article>
    </section>

    <p class="text-center text-xs text-text-faint">
      Dados sempre buscados online — esta tela não fica disponível offline.
    </p>
  </div>
</template>
