<script setup lang="ts">
import { computed } from 'vue'
import AppIcon, { type IconName } from '../icons/AppIcon.vue'

/**
 * Card de estatística/atalho reutilizável (PLANO_PROJETO.md §10.20): ícone num círculo colorido
 * + valor em destaque + rótulo pequeno. Cobre dois usos — atalho navegável (Home) e estatística
 * pura (Passaporte) — pela mesma marcação, só troca a tag raiz (`<router-link>` com `to`, senão
 * `<div>`).
 */
export type StatTone = 'accent' | 'warning' | 'neutral'

const props = withDefaults(
  defineProps<{
    icon: IconName
    label: string
    value?: string | number
    to?: string
    tone?: StatTone
    /** 'surface' (branco, para tiles soltos direto no fundo da página) ou 'elevated' (cinza
     * clarinho, para tiles aninhados dentro de outro card branco — evita "branco sobre
     * branco" sem contraste). */
    surface?: 'surface' | 'elevated'
  }>(),
  { tone: 'accent', value: undefined, to: undefined, surface: 'surface' },
)

const toneClasses: Record<StatTone, string> = {
  accent: 'bg-accent-soft text-accent',
  warning: 'bg-warning/15 text-warning',
  neutral: 'bg-surface text-text-muted',
}

const iconWrapClass = computed(() => toneClasses[props.tone])
const rootTag = computed(() => (props.to ? 'router-link' : 'div'))
const surfaceClass = computed(() => (props.surface === 'elevated' ? 'bg-bg-elevated' : 'bg-surface'))
</script>

<template>
  <component
    :is="rootTag"
    :to="to"
    class="flex flex-col items-center gap-2.5 rounded-card px-3 py-4 text-center transition-transform active:scale-[0.97]"
    :class="surfaceClass"
  >
    <span class="flex h-11 w-11 items-center justify-center rounded-full" :class="iconWrapClass">
      <AppIcon :name="icon" :size="20" />
    </span>
    <span v-if="value !== undefined" class="text-lg font-semibold leading-none text-text">{{ value }}</span>
    <span class="text-[11px] font-medium leading-tight text-text-muted">{{ label }}</span>
  </component>
</template>
