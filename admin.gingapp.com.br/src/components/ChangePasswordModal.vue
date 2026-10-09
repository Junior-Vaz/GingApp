<script setup lang="ts">
import { reactive, ref } from 'vue'
import {
  CHANGE_PASSWORD_SUCCESS,
  NEW_PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_BYTES,
  changePassword,
  changePasswordProblem,
  passwordErrorMessage,
} from '@/utils/password'

const emit = defineEmits<{ close: [] }>()

const form = reactive({ current: '', next: '', confirm: '' })
const isSubmitting = ref(false)
const error = ref('')
const done = ref(false)

function clearFields(): void {
  form.current = ''
  form.next = ''
  form.confirm = ''
}

function close(): void {
  // Nunca deixa uma senha digitada na memória do formulário depois de enviada/cancelada.
  clearFields()
  emit('close')
}

async function submit(): Promise<void> {
  if (isSubmitting.value) return // Enter repetido durante o envio não envia duas vezes
  error.value = ''
  const problem = changePasswordProblem(form.current, form.next, form.confirm)
  if (problem) {
    error.value = problem
    return
  }

  isSubmitting.value = true
  try {
    await changePassword(form.current, form.next)
    clearFields()
    done.value = true
  } catch (failure) {
    // Erro do servidor (ex.: 400 "Senha atual incorreta."): mostra a mensagem e mantém a sessão. As
    // senhas digitadas não ficam no formulário.
    clearFields()
    error.value = passwordErrorMessage(failure, 'Não foi possível alterar a senha.')
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
    <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="change-password-title">
      <h2 id="change-password-title" class="text-lg font-semibold text-slate-900">Alterar minha senha</h2>

      <div v-if="done">
        <p role="status" class="mt-4 text-sm text-emerald-700">{{ CHANGE_PASSWORD_SUCCESS }}</p>
        <p class="mt-1 text-xs text-slate-500">As demais sessões abertas com esta conta foram encerradas.</p>
        <div class="mt-4 flex justify-end">
          <button type="button" class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800" @click="close">
            Fechar
          </button>
        </div>
      </div>

      <form v-else class="mt-4 space-y-4" autocomplete="off" @submit.prevent="submit">
        <p class="text-sm text-slate-500">Você continua conectado neste aparelho; as demais sessões abertas serão encerradas.</p>
        <div>
          <label for="own-current-password" class="mb-1 block text-sm font-medium text-slate-700">Senha atual</label>
          <input
            id="own-current-password"
            v-model="form.current"
            type="password"
            autocomplete="current-password"
            class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
          />
        </div>
        <div>
          <label for="own-new-password" class="mb-1 block text-sm font-medium text-slate-700">Nova senha</label>
          <input
            id="own-new-password"
            v-model="form.next"
            type="password"
            autocomplete="new-password"
            class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
          />
          <p class="mt-1 text-xs text-slate-400">
            De {{ NEW_PASSWORD_MIN_LENGTH }} a {{ PASSWORD_MAX_BYTES }} caracteres (bytes UTF-8); diferente da atual e da senha padrão
            de desenvolvimento.
          </p>
        </div>
        <div>
          <label for="own-confirm-password" class="mb-1 block text-sm font-medium text-slate-700">Confirmar nova senha</label>
          <input
            id="own-confirm-password"
            v-model="form.confirm"
            type="password"
            autocomplete="new-password"
            class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
          />
        </div>

        <p v-if="error" role="alert" class="text-sm text-red-600">{{ error }}</p>

        <div class="flex justify-end gap-2 pt-2">
          <button type="button" class="rounded-md px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100" @click="close">
            Cancelar
          </button>
          <button
            type="submit"
            :disabled="isSubmitting"
            class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {{ isSubmitting ? 'Alterando…' : 'Alterar senha' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
