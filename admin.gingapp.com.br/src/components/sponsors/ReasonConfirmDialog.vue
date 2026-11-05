<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { REASON_LIMITS, reasonError } from '@/utils/sponsorGroups'

/** Confirmação com MOTIVO obrigatório (3..300) e contador: suspender campanha de grupo e bloquear grupo. */
const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    confirmLabel: string
    label?: string
    danger?: boolean
    busy?: boolean
    error?: string
  }>(),
  { label: 'Motivo', danger: true, busy: false, error: '' },
)

const emit = defineEmits<{ (event: 'confirm', reason: string): void; (event: 'cancel'): void }>()

const reason = ref('')
const touched = ref(false)
const input = ref<HTMLTextAreaElement | null>(null)

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) return
    reason.value = ''
    touched.value = false
    // O ConfirmDialog põe o foco no "Cancelar" (caminho seguro); aqui o foco útil é o campo do motivo.
    await nextTick()
    await nextTick()
    input.value?.focus()
  },
)

const problem = computed(() => reasonError(reason.value))
const shownProblem = computed(() => (touched.value ? problem.value : ''))
const counter = computed(() => `${reason.value.trim().length}/${REASON_LIMITS.max}`)

function onConfirm(): void {
  touched.value = true
  if (problem.value || props.busy) return
  emit('confirm', reason.value.trim())
}
</script>

<template>
  <ConfirmDialog
    :open="open"
    :title="title"
    :confirm-label="confirmLabel"
    :danger="danger"
    :busy="busy"
    :error="error"
    :confirm-disabled="problem !== ''"
    @cancel="emit('cancel')"
    @confirm="onConfirm"
  >
    <slot />
    <div>
      <div class="mb-1 flex items-baseline justify-between gap-2">
        <label for="reason-input" class="block text-sm font-medium text-slate-800">{{ label }} <span class="text-red-700" aria-hidden="true">*</span></label>
        <span class="text-xs tabular-nums" :class="reason.trim().length > REASON_LIMITS.max ? 'font-semibold text-red-700' : 'text-slate-600'" data-testid="reason-counter">{{ counter }}</span>
      </div>
      <textarea
        id="reason-input"
        ref="input"
        v-model="reason"
        rows="3"
        :maxlength="REASON_LIMITS.max"
        :disabled="busy"
        required
        aria-required="true"
        :aria-invalid="shownProblem ? 'true' : undefined"
        :aria-describedby="shownProblem ? 'reason-error' : 'reason-hint'"
        class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-600 focus:ring-2 focus:ring-slate-400 aria-[invalid=true]:border-red-600"
        data-testid="reason-input"
        @blur="touched = true"
        @input="touched = true"
      ></textarea>
      <p id="reason-hint" class="mt-1 text-xs text-slate-600">Obrigatório: de {{ REASON_LIMITS.min }} a {{ REASON_LIMITS.max }} caracteres. Fica registrado na auditoria.</p>
      <p v-if="shownProblem" id="reason-error" role="alert" class="mt-1 text-xs font-medium text-red-700" data-testid="reason-error">{{ shownProblem }}</p>
    </div>
  </ConfirmDialog>
</template>
