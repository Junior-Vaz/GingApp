<script setup lang="ts">
import { computed } from 'vue'
import { formatInt } from '@/utils/format'

/** Gráfico de barras simples em SVG (sem biblioteca). Cada barra tem <title> com o valor; a tabela equivalente fica ao lado. */
const props = defineProps<{
  title: string
  points: ReadonlyArray<{ label: string; value: number }>
  /** Cor da barra (classe de texto do Tailwind; a barra usa currentColor). */
  colorClass: string
  testid: string
}>()

const WIDTH = 640
const HEIGHT = 160
const LEFT = 36
const BOTTOM = 18
const TOP = 8

const max = computed(() => Math.max(0, ...props.points.map((p) => p.value)))
const innerW = WIDTH - LEFT
const innerH = HEIGHT - BOTTOM - TOP
const slot = computed(() => innerW / Math.max(1, props.points.length))
const barW = computed(() => Math.max(1, Math.min(28, slot.value * 0.7)))

const bars = computed(() =>
  props.points.map((p, i) => {
    const h = max.value > 0 ? (p.value / max.value) * innerH : 0
    return {
      key: p.label,
      x: LEFT + i * slot.value + (slot.value - barW.value) / 2,
      y: TOP + innerH - h,
      h,
      label: p.label,
      value: p.value,
    }
  }),
)

/** Rótulos do eixo X: primeiro, meio e último (evita sobreposição). */
const ticks = computed(() => {
  const n = props.points.length
  if (n === 0) return []
  const idx = Array.from(new Set([0, Math.floor((n - 1) / 2), n - 1]))
  return idx.map((i) => ({ x: LEFT + i * slot.value + slot.value / 2, label: props.points[i]!.label }))
})

const summary = computed(() => `${props.title}: ${props.points.length} dias, máximo de ${formatInt(max.value)} em um dia.`)
</script>

<template>
  <figure class="m-0" :data-testid="testid">
    <figcaption class="mb-1 text-sm font-medium text-slate-800">{{ title }}</figcaption>
    <svg :viewBox="`0 0 ${WIDTH} ${HEIGHT}`" class="h-auto w-full" :class="colorClass" role="img" :aria-label="summary" preserveAspectRatio="xMidYMid meet">
      <line :x1="LEFT" :x2="WIDTH" :y1="TOP + innerH" :y2="TOP + innerH" stroke="#94a3b8" stroke-width="1" />
      <line :x1="LEFT" :x2="WIDTH" :y1="TOP" :y2="TOP" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="3 3" />
      <text :x="LEFT - 4" :y="TOP + 4" text-anchor="end" font-size="10" fill="#475569">{{ formatInt(max) }}</text>
      <text :x="LEFT - 4" :y="TOP + innerH" text-anchor="end" font-size="10" fill="#475569">0</text>
      <rect v-for="bar in bars" :key="bar.key" :x="bar.x" :y="bar.y" :width="barW" :height="bar.h" fill="currentColor" rx="1.5" :data-value="bar.value">
        <title>{{ bar.label }}: {{ formatInt(bar.value) }}</title>
      </rect>
      <text v-for="tick in ticks" :key="tick.label" :x="tick.x" :y="HEIGHT - 4" text-anchor="middle" font-size="10" fill="#475569">{{ tick.label }}</text>
    </svg>
  </figure>
</template>
