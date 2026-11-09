<script setup lang="ts">
import { nextTick, reactive, ref, watch } from 'vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import FieldShell from '@/components/sponsors/FieldShell.vue'
import {
  APPLICATION_LIMITS,
  APPROVE_WARNING,
  approvePayload,
  decisionServerErrors,
  validateApproveForm,
  type ApproveFieldErrors,
  type GroupApplication,
} from '@/utils/groupApplications'
import { ApiError } from '@/utils/api'

/** Aprovar um pedido: slug opcional + nota interna. O pai faz a chamada (`confirm`) e devolve `busy`/`error`. */
const props = defineProps<{ application: GroupApplication | null; busy: boolean; error: string; serverError?: unknown }>()

const emit = defineEmits<{ (event: 'confirm', body: { slug?: string; internalNote?: string }): void; (event: 'cancel'): void }>()

const FIELDS = ['slug', 'internalNote'] as const
const form = reactive({ slug: '', internalNote: '' })
const fieldErrors = reactive<ApproveFieldErrors>({})
const slugInput = ref<HTMLInputElement | null>(null)

const inputClass =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-600 focus:ring-2 focus:ring-slate-400 aria-[invalid=true]:border-red-600'

function clearErrors(): void {
  for (const key of FIELDS) delete fieldErrors[key]
}

watch(
  () => props.application?.id ?? null,
  async (id) => {
    if (id === null) return
    form.slug = ''
    form.internalNote = ''
    clearErrors()
    // O ConfirmDialog põe o foco no "Cancelar" (caminho seguro); aqui o foco útil é o campo do endereço.
    await nextTick()
    await nextTick()
    slugInput.value?.focus()
  },
  { immediate: true },
)

// 400 do servidor (validação) -> mensagens no campo certo.
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
  const problems = validateApproveForm(form)
  if (Object.keys(problems).length > 0) {
    Object.assign(fieldErrors, problems)
    return
  }
  emit('confirm', approvePayload(form))
}
</script>

<template>
  <ConfirmDialog
    :open="application !== null"
    title="Aprovar este pedido?"
    confirm-label="Aprovar e criar o grupo"
    :busy="busy"
    :error="error"
    @cancel="emit('cancel')"
    @confirm="onConfirm"
  >
    <template v-if="application">
      <p>
        Grupo <strong data-testid="approve-group">{{ application.groupName }}</strong> ({{ application.city }}/{{ application.state }}), pedido de
        <strong>{{ application.applicantName }}</strong>.
      </p>
      <p class="rounded-md bg-amber-50 px-3 py-2 text-amber-900" data-testid="approve-warning">{{ APPROVE_WARNING }}</p>
      <FieldShell
        id="approve-slug"
        label="Endereço do grupo (slug)"
        hint="Opcional. Letras minúsculas, números e hífens, de 2 a 60 caracteres (ex.: grupo-ginga). Em branco, é gerado a partir do nome."
        :error="fieldErrors.slug"
        v-slot="{ describedby, invalid }"
      >
        <input
          id="approve-slug"
          ref="slugInput"
          v-model="form.slug"
          type="text"
          :maxlength="APPLICATION_LIMITS.slugMax"
          autocomplete="off"
          spellcheck="false"
          :disabled="busy"
          :aria-describedby="describedby"
          :aria-invalid="invalid"
          :class="inputClass"
          data-testid="approve-slug"
        />
      </FieldShell>
      <FieldShell
        id="approve-note"
        label="Nota interna"
        hint="Opcional. Só a equipe vê; o solicitante não recebe este texto."
        :error="fieldErrors.internalNote"
        :counter="`${form.internalNote.trim().length}/${APPLICATION_LIMITS.internalNoteMax}`"
        :counter-over="form.internalNote.trim().length > APPLICATION_LIMITS.internalNoteMax"
        v-slot="{ describedby, invalid }"
      >
        <textarea
          id="approve-note"
          v-model="form.internalNote"
          rows="3"
          :disabled="busy"
          :aria-describedby="describedby"
          :aria-invalid="invalid"
          :class="inputClass"
          data-testid="approve-note"
        ></textarea>
      </FieldShell>
    </template>
  </ConfirmDialog>
</template>
