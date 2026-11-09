<script setup lang="ts">
// Chip de status com tons padronizados (fundo claro + texto escuro, contraste AA). O texto vem do chamador.
export type ChipTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

withDefaults(defineProps<{ tone?: ChipTone }>(), { tone: 'neutral' })
</script>

<template>
  <span class="chip" :class="`chip-${tone}`"><slot /></span>
</template>
