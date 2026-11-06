<script setup lang="ts">
import { computed } from 'vue'
import FieldShell from '@/components/sponsors/FieldShell.vue'
import { formatCents, normalizeMoneyText, parseReaisToCents, sanitizeMoneyInput } from '@/utils/finance'

/**
 * Campo de valor em reais. O usuário digita "1.234,56" (ou "1234,5"); o componente limpa o que não é valor,
 * ao sair do campo reescreve no formato canônico e mostra, ao vivo, como o valor foi entendido ("= R$ 1.234,56").
 * O modelo continua sendo TEXTO; quem salva converte com `parseReaisToCents` (centavos inteiros, sem float).
 */
const props = defineProps<{
  id: string
  label: string
  modelValue: string
  required?: boolean
  hint?: string
  error?: string
  disabled?: boolean
  testid: string
}>()

const emit = defineEmits<{ (event: 'update:modelValue', value: string): void }>()

const cents = computed(() => parseReaisToCents(props.modelValue))
const understood = computed(() => (props.modelValue.trim() !== '' && cents.value !== null ? `= ${formatCents(cents.value)}` : ''))

function onInput(event: Event): void {
  const input = event.target as HTMLInputElement
  const clean = sanitizeMoneyInput(input.value)
  if (clean !== input.value) input.value = clean
  emit('update:modelValue', clean)
}

function onBlur(): void {
  const normalized = normalizeMoneyText(props.modelValue)
  if (normalized !== props.modelValue) emit('update:modelValue', normalized)
}

const inputClass =
  'w-full rounded-md border border-slate-300 py-2 pl-10 pr-3 text-sm tabular-nums text-slate-900 outline-none focus:border-slate-600 focus:ring-2 focus:ring-slate-400 aria-[invalid=true]:border-red-600 disabled:bg-slate-100 disabled:text-slate-600'
</script>

<template>
  <FieldShell :id="id" :label="label" :required="required" :hint="hint" :error="error" v-slot="{ describedby, invalid }">
    <div class="relative">
      <span aria-hidden="true" class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-600">R$</span>
      <input
        :id="id"
        :value="modelValue"
        type="text"
        inputmode="decimal"
        autocomplete="off"
        placeholder="0,00"
        :disabled="disabled"
        :aria-describedby="describedby"
        :aria-invalid="invalid"
        :class="inputClass"
        :data-testid="testid"
        @input="onInput"
        @blur="onBlur"
      />
    </div>
    <p v-if="understood" class="mt-1 text-xs text-slate-600" :data-testid="`${testid}-understood`">{{ understood }}</p>
  </FieldShell>
</template>
