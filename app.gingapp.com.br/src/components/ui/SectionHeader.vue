<script setup lang="ts">
/** Cabeçalho de seção padrão (título + ação opcional à direita) — antes cada view escrevia
 * "flex items-center justify-between" com um h2 solto; centralizado pro redesign v2
 * (PLANO_PROJETO.md §10.20). */
withDefaults(defineProps<{ title: string; actionLabel?: string; actionTo?: string }>(), {
  actionLabel: undefined,
  actionTo: undefined,
})
</script>

<template>
  <div class="flex items-center justify-between">
    <h2 class="text-[15px] font-semibold text-text">{{ title }}</h2>
    <router-link v-if="actionTo && actionLabel" :to="actionTo" class="text-xs font-medium text-accent">
      {{ actionLabel }} ›
    </router-link>
    <span v-else-if="actionLabel" class="text-xs font-medium text-text-faint">{{ actionLabel }}</span>
  </div>
</template>
