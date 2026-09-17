<script setup lang="ts">
/** Pill de status — antes cada view repetia "rounded-full px-2 py-0.5 text-xs font-medium" +
 * um par de classes de cor à mão. Centralizado aqui (SSOT) pro redesign de tema claro v2
 * (PLANO_PROJETO.md §10.20): 4 tons cobrem todo status do produto (confirmado/pago = success,
 * pendente = warning, cancelado/recusado = danger, neutro = sem status forte). */
export type BadgeTone = 'success' | 'warning' | 'danger' | 'neutral'

withDefaults(defineProps<{ tone?: BadgeTone }>(), { tone: 'neutral' })

const TONE_CLASSES: Record<BadgeTone, string> = {
  success: 'bg-success/12 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/12 text-danger',
  neutral: 'bg-bg-elevated text-text-muted',
}
</script>

<template>
  <span
    class="inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[11px] font-semibold"
    :class="TONE_CLASSES[tone]"
  >
    <slot />
  </span>
</template>
