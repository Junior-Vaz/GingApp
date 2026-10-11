<script setup lang="ts">
import { ref } from 'vue'
import LegalDocumentView from '@/components/LegalDocumentView.vue'
import { useAuthStore } from '@/stores/auth'
import { errorMessage } from '@/utils/api'
import { acceptTerms, fetchLegalVersion } from '@/utils/legal'

const emit = defineEmits<{ logout: [] }>()
const authStore = useAuthStore()

const agreed = ref(false)
const isSubmitting = ref(false)
const error = ref('')

async function accept(): Promise<void> {
  if (!agreed.value || isSubmitting.value) return
  error.value = ''
  isSubmitting.value = true
  try {
    // Versão vigente lida do servidor (a sessão guardada pode ser de uma versão anterior dos textos).
    await acceptTerms(await fetchLegalVersion())
  } catch (failure) {
    error.value = errorMessage(failure, 'Não foi possível registrar o aceite.')
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <!-- Tela BLOQUEANTE de aceite dos Termos + Política (E10): sem botão de fechar; só aceitar ou sair. -->
  <div class="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 px-4" data-testid="terms-gate">
    <div class="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl bg-white p-6 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="terms-gate-title">
      <h2 id="terms-gate-title" class="text-lg font-semibold text-slate-900">Termos de Uso e Política de Privacidade</h2>
      <p class="mt-1 text-sm text-slate-500">
        Olá, {{ authStore.user?.name }}. Para continuar, leia e aceite os documentos abaixo (LGPD).
      </p>
      <div class="mt-4 flex-1 space-y-8 overflow-y-auto rounded-md border border-slate-200 p-4">
        <LegalDocumentView type="terms" />
        <LegalDocumentView type="privacy" />
      </div>
      <label class="mt-4 flex items-start gap-2 text-sm text-slate-700">
        <input v-model="agreed" type="checkbox" class="mt-0.5 h-4 w-4" data-testid="terms-agree" />
        <span>Li e concordo com os Termos de Uso e com a Política de Privacidade.</span>
      </label>
      <p v-if="error" role="alert" class="mt-2 text-sm text-red-600">{{ error }}</p>
      <div class="mt-4 flex justify-end gap-2">
        <button type="button" class="rounded-md px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100" @click="emit('logout')">
          Sair
        </button>
        <button
          type="button"
          data-testid="terms-accept"
          :disabled="!agreed || isSubmitting"
          class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          @click="accept"
        >
          {{ isSubmitting ? 'Registrando…' : 'Aceitar e continuar' }}
        </button>
      </div>
    </div>
  </div>
</template>
