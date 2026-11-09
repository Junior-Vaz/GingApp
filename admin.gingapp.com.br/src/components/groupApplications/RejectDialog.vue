<script setup lang="ts">
import { nextTick, reactive, ref, watch } from 'vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import FieldShell from '@/components/sponsors/FieldShell.vue'
import {
  APPLICATION_LIMITS,
  REJECT_WARNING,
  decisionServerErrors,
  rejectPayload,
  validateRejectForm,
  type GroupApplication,
  type RejectFieldErrors,
} from '@/utils/groupApplications'
import { ApiError } from '@/utils/api'

/** Não aprovar um pedido: motivo obrigatório (3..300, vai ao solicitante) + nota interna opcional. */
const props = defineProps<{ application: GroupApplication | null; busy: boolean; error: string; serverError?: unknown }>()

const emit = defineEmits<{ (event: 'confirm', body: { reason: string; internalNote?: string }): void; (event: 'cancel'): void }>()

const FIELDS = ['reason', 'internalNote'] as const
const form = reactive({ reason: '', internalNote: '' })
const fieldErrors = reactive<RejectFieldErrors>({})
const reasonInput = ref<HTMLTextAreaElement | null>(null)

const inputClass =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-600 focus:ring-2 focus:ring-slate-400 aria-[invalid=true]:border-red-600'

function clearErrors(): void {
  for (const key of FIELDS) delete fieldErrors[key]
}

watch(
  () => props.application?.id ?? null,
  async (id) => {
    if (id === null) return
    form.reason = ''
    form.internalNote = ''
    clearErrors()
    await nextTick()
    await nextTick()
    reasonInput.value?.focus()
  },
  { immediate: true },
)

watch(
  () => props.serverError,
  (error) => {
    if (error instanceof ApiError && error.status === 400) {
      clearErrors()
      Object.assign(fieldErrors, decisionServerErrors(error, FIELDS).fields)
    }
  },
)

function onConfirm(): void {
  if (props.busy) return
  clearErrors()
  const problems = validateRejectForm(form)
  if (Object.keys(problems).length > 0) {
    Object.assign(fieldErrors, problems)
    return
  }
  emit('confirm', rejectPayload(form))
}
</script>

<template>
  <ConfirmDialog
    :open="application !== null"
    title="Não aprovar este pedido?"
    confirm-label="Não aprovar"
    danger
    :busy="busy"
    :error="error"
    @cancel="emit('cancel')"
    @confirm="onConfirm"
  >
    <template v-if="application">
      <p>
        Grupo <strong data-testid="reject-group">{{ application.groupName }}</strong> ({{ application.city }}/{{ application.state }}), pedido de
        <strong>{{ application.applicantName }}</strong>.
      </p>
      <p class="rounded-md bg-amber-50 px-3 py-2 text-amber-900" data-testid="reject-warning">{{ REJECT_WARNING }}</p>
      <FieldShell
        id="reject-reason"
        label="Motivo (visível ao solicitante)"
        required
        :hint="`Obrigatório: de ${APPLICATION_LIMITS.reasonMin} a ${APPLICATION_LIMITS.reasonMax} caracteres. Escreva de forma educada e objetiva.`"
        :error="fieldErrors.reason"
        :counter="`${form.reason.trim().length}/${APPLICATION_LIMITS.reasonMax}`"
        :counter-over="form.reason.trim().length > APPLICATION_LIMITS.reasonMax"
        v-slot="{ describedby, invalid }"
      >
        <textarea
          id="reject-reason"
          ref="reasonInput"
          v-model="form.reason"
          rows="3"
          required
          aria-required="true"
          :disabled="busy"
          :aria-describedby="describedby"
          :aria-invalid="invalid"
          :class="inputClass"
          data-testid="reject-reason"
        ></textarea>
      </FieldShell>
      <FieldShell
        id="reject-note"
        label="Nota interna"
        hint="Opcional. Só a equipe vê; o solicitante não recebe este texto."
        :error="fieldErrors.internalNote"
        :counter="`${form.internalNote.trim().length}/${APPLICATION_LIMITS.internalNoteMax}`"
        :counter-over="form.internalNote.trim().length > APPLICATION_LIMITS.internalNoteMax"
        v-slot="{ describedby, invalid }"
      >
        <textarea
          id="reject-note"
          v-model="form.internalNote"
          rows="2"
          :disabled="busy"
          :aria-describedby="describedby"
          :aria-invalid="invalid"
          :class="inputClass"
          data-testid="reject-note"
        ></textarea>
      </FieldShell>
    </template>
  </ConfirmDialog>
</template>
