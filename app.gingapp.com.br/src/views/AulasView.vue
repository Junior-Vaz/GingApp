<script setup lang="ts">
const aulas = [
  { id: 1, turma: 'Infantil', dia: 'Segunda e Quarta', hora: '18h00' },
  { id: 2, turma: 'Cordas', dia: 'Sexta', hora: '19h30' },
  { id: 3, turma: 'Grupo A', dia: 'Sábado', hora: '10h00' },
]
</script>

<template>
  <div class="flex flex-col gap-6 px-5 pb-6 pt-6">
    <header>
      <h1 class="text-xl font-semibold text-text">Aulas</h1>
      <p class="text-sm text-text-muted">Turmas e horários do seu grupo</p>
    </header>

    <section class="flex flex-col gap-3">
      <article
        v-for="aula in aulas"
        :key="aula.id"
        class="flex items-center justify-between rounded-card bg-surface p-4"
      >
        <div>
          <p class="text-sm font-semibold text-text">{{ aula.turma }}</p>
          <p class="text-xs text-text-muted">{{ aula.dia }}</p>
        </div>
        <span class="rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent">
          {{ aula.hora }}
        </span>
      </article>
    </section>
  </div>
</template>
