<script setup lang="ts">
const rodas = [
  { id: 1, cidade: 'Belo Horizonte - MG', data: 'Domingo, 18h', participantes: 24 },
  { id: 2, cidade: 'Contagem - MG', data: 'Sábado, 16h', participantes: 12 },
]
</script>

<template>
  <div class="flex flex-col gap-6 px-5 pb-6 pt-6">
    <header>
      <h1 class="text-xl font-semibold text-text">Rodas</h1>
      <p class="text-sm text-text-muted">Rodas da comunidade estadual</p>
    </header>

    <section class="flex flex-col gap-4">
      <article v-for="roda in rodas" :key="roda.id" class="rounded-card-lg bg-surface p-5">
        <h3 class="text-sm font-semibold text-text">{{ roda.cidade }}</h3>
        <p class="mt-1 text-xs text-text-muted">{{ roda.data }}</p>
        <p class="mt-2 text-xs font-medium text-accent">{{ roda.participantes }} confirmados</p>
      </article>
    </section>
  </div>
</template>
