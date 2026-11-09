<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    confirmLabel: string
    cancelLabel?: string
    /** Botão de confirmar em vermelho (ação destrutiva). */
    danger?: boolean
    busy?: boolean
    error?: string
    /** Desabilita o "confirmar" (ex.: sem permissão). */
    confirmDisabled?: boolean
  }>(),
  { cancelLabel: 'Cancelar', danger: false, busy: false, error: '', confirmDisabled: false },
)

const emit = defineEmits<{ (event: 'confirm'): void; (event: 'cancel'): void }>()

const dialog = ref<HTMLElement | null>(null)
let previouslyFocused: HTMLElement | null = null

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
      await nextTick()
      // Foco inicial no "cancelar": o caminho seguro (Enter sem querer não confirma uma ação séria).
      dialog.value?.querySelector<HTMLElement>('[data-cancel]')?.focus()
    } else {
      previouslyFocused?.focus?.()
      previouslyFocused = null
    }
  },
)

onBeforeUnmount(() => previouslyFocused?.focus?.())

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && !props.busy) {
    event.stopPropagation()
    emit('cancel')
    return
  }
  if (event.key !== 'Tab' || !dialog.value) return
  const items = Array.from(dialog.value.querySelectorAll<HTMLElement>(FOCUSABLE))
  if (items.length === 0) return
  const first = items[0]!
  const last = items[items.length - 1]!
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4" @keydown="onKeydown">
    <div
      ref="dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      class="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl sm:p-6"
      data-testid="confirm-dialog"
    >
      <h2 id="confirm-dialog-title" class="text-lg font-extrabold text-slate-900">{{ title }}</h2>
      <div class="mt-3 space-y-3 text-sm text-slate-700">
        <slot />
      </div>
      <p v-if="error" role="alert" class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" data-testid="confirm-error">{{ error }}</p>
      <div class="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          data-cancel
          :disabled="busy"
          class="btn btn-ghost"
          @click="emit('cancel')"
        >
          {{ cancelLabel }}
        </button>
        <button
          type="button"
          data-testid="confirm-ok"
          :disabled="busy || confirmDisabled"
          class="btn"
          :class="danger ? 'btn-danger' : 'btn-primary'"
          @click="emit('confirm')"
        >
          {{ busy ? 'Aguarde…' : confirmLabel }}
        </button>
      </div>
    </div>
  </div>
</template>
