<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { api, ApiError } from '../utils/api'

interface PublicCertificate {
  title: string
  studentName: string
  organizationName: string
  issuedAt: string | null
}

const route = useRoute()
const code = String(route.params.code ?? '')

const certificate = ref<PublicCertificate | null>(null)
const isLoading = ref(true)
const notFound = ref(false)

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
}

onMounted(async () => {
  try {
    certificate.value = await api.get<PublicCertificate>(`/public/certificates/${code}`)
  } catch (error) {
    notFound.value = !(error instanceof ApiError) || error.status === 404
  } finally {
    isLoading.value = false
  }
})
</script>

<template>
  <div class="flex min-h-screen flex-col items-center justify-center gap-6 px-6 py-10">
    <p class="text-xs font-medium uppercase tracking-widest text-text-faint">GingApp · Verificação de certificado</p>

    <div v-if="isLoading" class="text-sm text-text-muted">Verificando…</div>

    <div v-else-if="notFound" class="w-full max-w-sm rounded-card-lg bg-surface p-6 text-center">
      <p class="text-lg font-semibold text-danger">Certificado não encontrado</p>
      <p class="mt-2 text-sm text-text-muted">
        Este código não corresponde a nenhum certificado válido emitido pelo GingApp.
      </p>
    </div>

    <div v-else-if="certificate" class="w-full max-w-sm rounded-card-lg bg-surface p-6 text-center">
      <p class="flex items-center justify-center gap-1.5 text-sm font-medium text-success">
        <span class="h-2 w-2 rounded-full bg-success" /> Certificado autêntico
      </p>
      <p class="mt-4 text-lg font-semibold text-text">{{ certificate.title }}</p>
      <p class="mt-1 text-text-muted">{{ certificate.studentName }}</p>

      <div class="mt-5 space-y-1 border-t border-border pt-4 text-sm text-text-muted">
        <p>Emitido por <span class="text-text">{{ certificate.organizationName }}</span></p>
        <p>Em {{ formatDate(certificate.issuedAt) }}</p>
      </div>
    </div>
  </div>
</template>
