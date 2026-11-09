<script setup lang="ts">
// Cabeçalho padrão das telas: título (h1), descrição e ações à direita (quebram abaixo no celular).
defineProps<{ title: string; description?: string }>()
</script>

<template>
  <header class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
    <div class="min-w-0">
      <h1 class="text-slate-900">{{ title }}</h1>
      <p v-if="description || $slots.description" class="mt-1 max-w-3xl text-sm text-slate-600">
        <slot name="description">{{ description }}</slot>
      </p>
    </div>
    <div v-if="$slots.default" class="flex shrink-0 flex-wrap items-center gap-2">
      <slot />
    </div>
  </header>
</template>
