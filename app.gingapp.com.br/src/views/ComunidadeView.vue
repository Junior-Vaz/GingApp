<script setup lang="ts">
const posts = [
  { id: 1, autor: 'Grupo Raiz Forte', texto: 'Roda linda esse fim de semana!' },
  { id: 2, autor: 'Comunidade MG', texto: 'Inscrições abertas para o encontro estadual.' },
]
</script>

<template>
  <div class="flex flex-col gap-6 pb-6 pt-6">
    <header class="px-5">
      <h1 class="text-xl font-semibold text-text">Comunidade</h1>
      <p class="text-sm text-text-muted">O que está rolando na capoeira</p>
    </header>

    <section class="flex flex-col gap-4 px-5">
      <article
        v-for="post in posts"
        :key="post.id"
        class="overflow-hidden rounded-card-lg bg-surface shadow-md shadow-black/10"
      >
        <div class="flex h-40 items-center justify-center bg-gradient-to-br from-accent/30 to-bg-elevated text-4xl">
          📸
        </div>
        <div class="flex flex-col gap-1 p-4">
          <p class="text-sm font-semibold text-text">{{ post.autor }}</p>
          <p class="text-xs text-text-muted">{{ post.texto }}</p>
        </div>
      </article>
    </section>
  </div>
</template>
