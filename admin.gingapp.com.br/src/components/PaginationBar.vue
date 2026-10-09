<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  total: number
  offset: number
  limit: number
  disabled?: boolean
}>()

const emit = defineEmits<{ (event: 'update:offset', value: number): void }>()

const from = computed(() => (props.total === 0 ? 0 : props.offset + 1))
const to = computed(() => Math.min(props.offset + props.limit, props.total))
const hasPrevious = computed(() => props.offset > 0)
const hasNext = computed(() => props.offset + props.limit < props.total)
</script>

<template>
  <div class="flex items-center justify-between border-t border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
    <span data-testid="page-range">{{ from }}–{{ to }} de {{ total }}</span>
    <div class="flex gap-2">
      <button
        type="button"
        data-testid="page-prev"
        :disabled="disabled || !hasPrevious"
        class="rounded-md border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        @click="emit('update:offset', Math.max(0, offset - limit))"
      >
        Anterior
      </button>
      <button
        type="button"
        data-testid="page-next"
        :disabled="disabled || !hasNext"
        class="rounded-md border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        @click="emit('update:offset', offset + limit)"
      >
        Próxima
      </button>
    </div>
  </div>
</template>
