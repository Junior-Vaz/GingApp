<script setup lang="ts">
import { computed } from 'vue'

/** Rótulo + controle + contador + dica + erro, com os vínculos de acessibilidade (label for, aria-describedby, aria-invalid). */
const props = defineProps<{
  id: string
  label: string
  required?: boolean
  hint?: string
  error?: string
  /** Texto do contador, ex.: "12/60". */
  counter?: string
  /** Contador estourou o limite (fica vermelho). */
  counterOver?: boolean
}>()

const describedby = computed(() => [props.hint ? `${props.id}-hint` : '', props.error ? `${props.id}-error` : ''].filter(Boolean).join(' ') || undefined)
const invalid = computed<'true' | undefined>(() => (props.error ? 'true' : undefined))
</script>

<template>
  <div>
    <div class="mb-1 flex items-baseline justify-between gap-2">
      <label :for="id" class="block text-sm font-medium text-slate-800">
        {{ label }}<span v-if="required" class="text-red-700" aria-hidden="true"> *</span>
      </label>
      <span v-if="counter" class="text-xs tabular-nums" :class="counterOver ? 'font-semibold text-red-700' : 'text-slate-600'" :data-testid="`${id}-counter`">{{ counter }}</span>
    </div>
    <slot :describedby="describedby" :invalid="invalid" />
    <p v-if="hint" :id="`${id}-hint`" class="mt-1 text-xs text-slate-600">{{ hint }}</p>
    <p v-if="error" :id="`${id}-error`" role="alert" class="mt-1 text-xs font-medium text-red-700" :data-testid="`${id}-error`">{{ error }}</p>
  </div>
</template>
