<script setup lang="ts">
import AppIcon, { type IconName } from '../icons/AppIcon.vue'

/** Estado vazio ilustrado (ícone grande + mensagem) — substitui os antigos parágrafos soltos
 * "Nenhum X ainda" espalhados pelas views (redesign v2, PLANO_PROJETO.md §10.20). */
withDefaults(defineProps<{ icon: IconName; message: string }>(), {})
</script>

<template>
  <div class="flex flex-col items-center gap-3 rounded-card-lg bg-surface px-6 py-10 text-center">
    <span class="flex h-14 w-14 items-center justify-center rounded-full bg-bg-elevated text-text-faint">
      <AppIcon :name="icon" :size="26" />
    </span>
    <p class="text-sm text-text-muted">{{ message }}</p>
  </div>
</template>
