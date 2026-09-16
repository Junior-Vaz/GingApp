<script setup lang="ts">
const graduations = [
  { id: 1, name: 'Crua', date: 'Início', done: true },
  { id: 2, name: 'Corda Amarela', date: 'Mar/2024', done: true },
  { id: 3, name: 'Corda Amarela e Azul', date: 'Nov/2024', done: true },
  { id: 4, name: 'Corda Azul', date: 'Prevista — Dez/2026', done: false },
]
</script>

<template>
  <div class="flex flex-col gap-6 px-5 pb-6 pt-6">
    <header>
      <h1 class="text-xl font-semibold text-text">Jornada</h1>
      <p class="text-sm text-text-muted">Sua evolução e graduações no grupo</p>
    </header>

    <section class="rounded-card-lg bg-surface p-5">
      <p class="text-xs text-text-muted">Graduação atual</p>
      <p class="mt-1 text-lg font-semibold text-accent">Corda Amarela e Azul</p>
    </section>

    <section class="flex flex-col gap-4">
      <h2 class="text-sm font-medium text-text-muted">Linha do tempo</h2>
      <ol class="flex flex-col gap-5">
        <li v-for="grad in graduations" :key="grad.id" class="flex items-start gap-4">
          <span
            class="mt-1 flex h-3 w-3 flex-shrink-0 rounded-full"
            :class="grad.done ? 'bg-accent' : 'bg-border'"
          />
          <div class="flex-1 rounded-card bg-surface px-4 py-3">
            <p class="text-sm font-medium text-text">{{ grad.name }}</p>
            <p class="text-xs text-text-muted">{{ grad.date }}</p>
          </div>
        </li>
      </ol>
    </section>
  </div>
</template>
