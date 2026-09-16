<script setup lang="ts">
const notificacoes = [
  { id: 1, texto: 'Sua mensalidade de outubro está em aberto.', tempo: 'há 2h' },
  { id: 2, texto: 'Nova data de roda confirmada para domingo.', tempo: 'há 1 dia' },
]
</script>

<template>
  <div class="flex flex-col gap-6 px-5 pb-6 pt-6">
    <header>
      <h1 class="text-xl font-semibold text-text">Notificações</h1>
      <p class="text-sm text-text-muted">Avisos do seu grupo e da plataforma</p>
    </header>

    <section class="flex flex-col gap-3">
      <article
        v-for="n in notificacoes"
        :key="n.id"
        class="flex items-start gap-3 rounded-card bg-surface p-4"
      >
        <span class="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-accent" />
        <div>
          <p class="text-sm text-text">{{ n.texto }}</p>
          <p class="mt-1 text-xs text-text-faint">{{ n.tempo }}</p>
        </div>
      </article>
    </section>
  </div>
</template>
