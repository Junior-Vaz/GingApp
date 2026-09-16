<script setup lang="ts">
const eventos = [
  { id: 1, nome: 'Batizado e Troca de Cordas', data: '12/12/2026', local: 'Ginásio Municipal' },
  { id: 2, nome: 'Workshop de Berimbau', data: '20/10/2026', local: 'Sede do Grupo' },
]
</script>

<template>
  <div class="flex flex-col gap-6 px-5 pb-6 pt-6">
    <header>
      <h1 class="text-xl font-semibold text-text">Eventos</h1>
      <p class="text-sm text-text-muted">Próximos eventos do seu grupo</p>
    </header>

    <section class="flex flex-col gap-4">
      <article v-for="evento in eventos" :key="evento.id" class="rounded-card-lg bg-surface p-5">
        <p class="text-xs font-semibold text-accent">{{ evento.data }}</p>
        <h3 class="mt-1 text-sm font-semibold text-text">{{ evento.nome }}</h3>
        <p class="mt-1 text-xs text-text-muted">{{ evento.local }}</p>
      </article>
    </section>
  </div>
</template>
