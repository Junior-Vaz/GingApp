<script setup lang="ts">
const historico = [
  { id: 1, data: '14/09/2026', status: 'Presente' },
  { id: 2, data: '10/09/2026', status: 'Presente' },
  { id: 3, data: '07/09/2026', status: 'Falta' },
]
</script>

<template>
  <div class="flex flex-col gap-6 px-5 pb-6 pt-6">
    <header>
      <h1 class="text-xl font-semibold text-text">Frequência</h1>
      <p class="text-sm text-text-muted">Seu histórico de presença nas aulas</p>
    </header>

    <section class="flex items-center gap-6 rounded-card-lg bg-surface p-5">
      <div class="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-full border-4 border-accent text-lg font-semibold text-accent">
        87%
      </div>
      <div>
        <p class="text-sm font-medium text-text">Assiduidade nos últimos 30 dias</p>
        <p class="text-xs text-text-muted">13 de 15 aulas</p>
      </div>
    </section>

    <section class="flex flex-col gap-3">
      <h2 class="text-sm font-medium text-text-muted">Histórico recente</h2>
      <div
        v-for="item in historico"
        :key="item.id"
        class="flex items-center justify-between rounded-card bg-surface px-4 py-3"
      >
        <span class="text-sm text-text">{{ item.data }}</span>
        <span
          class="text-xs font-semibold"
          :class="item.status === 'Presente' ? 'text-success' : 'text-danger'"
        >
          {{ item.status }}
        </span>
      </div>
    </section>
  </div>
</template>
