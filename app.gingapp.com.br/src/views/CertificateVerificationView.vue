<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { api, ApiError } from '../utils/api'
import AppIcon from '../components/icons/AppIcon.vue'

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
  <div class="flex min-h-screen flex-col items-center justify-center gap-6 bg-bg px-6 py-10">
    <p class="text-xs font-semibold uppercase tracking-widest text-text-faint">GingApp · Verificação de certificado</p>

    <div v-if="isLoading" class="text-sm text-text-muted">Verificando…</div>

    <div v-else-if="notFound" class="flex w-full max-w-sm flex-col items-center gap-3 rounded-card-lg bg-surface p-8 text-center">
      <span class="flex h-14 w-14 items-center justify-center rounded-full bg-danger/10 text-danger">
        <AppIcon name="alert-circle" :size="26" />
      </span>
      <p class="text-lg font-bold text-text">Certificado não encontrado</p>
      <p class="text-sm text-text-muted">
        Este código não corresponde a nenhum certificado válido emitido pelo GingApp.
      </p>
    </div>

    <div v-else-if="certificate" class="flex w-full max-w-sm flex-col items-center gap-3 rounded-card-lg bg-surface p-8 text-center">
      <span class="flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft text-accent">
        <AppIcon name="trophy" :size="26" />
      </span>
      <p class="text-xs font-semibold text-success">Certificado autêntico</p>
      <p class="text-lg font-bold text-text">{{ certificate.title }}</p>
      <p class="text-sm text-text-muted">{{ certificate.studentName }}</p>

      <div class="mt-2 w-full space-y-1 border-t border-border pt-4 text-sm text-text-muted">
        <p>Emitido por <span class="font-medium text-text">{{ certificate.organizationName }}</span></p>
        <p>Em {{ formatDate(certificate.issuedAt) }}</p>
      </div>
    </div>
  </div>
</template>
