<script setup lang="ts">
import { ref } from 'vue'
import {
  FORGOT_PASSWORD_NEUTRAL_MESSAGE,
  forgotPasswordErrorMessage,
  requestPasswordReset,
} from '@/utils/password'

const email = ref('')
const isSubmitting = ref(false)
const sent = ref(false)
const errorMessage = ref('')

async function handleSubmit(): Promise<void> {
  if (isSubmitting.value) return
  errorMessage.value = ''
  isSubmitting.value = true
  try {
    await requestPasswordReset(email.value.trim())
    sent.value = true
  } catch (failure) {
    errorMessage.value = forgotPasswordErrorMessage(failure)
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-slate-50 px-4">
    <div class="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
      <div class="mb-6 text-center">
        <img src="/logo.png" alt="GingApp" class="mx-auto h-12 w-auto object-contain" />
        <h1 class="mt-3 text-lg font-semibold text-slate-900">Esqueci minha senha</h1>
      </div>

      <p v-if="sent" role="status" data-testid="forgot-neutral" class="text-sm text-slate-700">
        {{ FORGOT_PASSWORD_NEUTRAL_MESSAGE }}
      </p>

      <form v-else class="space-y-4" @submit.prevent="handleSubmit">
        <p class="text-sm text-slate-500">Informe o e-mail da sua conta para receber o link de redefinição.</p>
        <div>
          <label for="forgot-email" class="mb-1 block text-sm font-medium text-slate-700">E-mail</label>
          <input
            id="forgot-email"
            v-model="email"
            type="email"
            required
            autocomplete="email"
            class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
            placeholder="equipe@gingapp.com.br"
          />
        </div>

        <p v-if="errorMessage" role="alert" data-testid="forgot-error" class="text-sm text-red-600">{{ errorMessage }}</p>

        <button
          type="submit"
          :disabled="isSubmitting"
          class="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {{ isSubmitting ? 'Enviando…' : 'Enviar link' }}
        </button>
      </form>

      <p class="mt-6 text-center text-sm">
        <RouterLink to="/login" class="text-slate-600 underline">Voltar ao login</RouterLink>
      </p>
    </div>
  </div>
</template>
