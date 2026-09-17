<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import QRCode from 'qrcode'
import { api, ApiError } from '../utils/api'

interface Student {
  id: number
}

interface GraduationLevel {
  id: number
  name: string
  order: number
  color: string | null
}

interface StudentGraduation {
  id: number
  studentId: number
  graduationLevelId: number
  graduatedAt: string
  notes: string | null
  createdAt: string
  graduationLevel: GraduationLevel
}

interface Certificate {
  id: number
  title: string
  issuedAt: string | null
  verificationCode: string
}

const isLoading = ref(true)
const loadError = ref('')
const hasStudent = ref(true)

// Vem do backend já do mais recente para o mais antigo.
const graduations = ref<StudentGraduation[]>([])
const certificates = ref<Certificate[]>([])

const qrModalCertificate = ref<Certificate | null>(null)
const qrDataUrl = ref('')

function verificationUrl(code: string): string {
  return `${window.location.origin}/verificar/${code}`
}

async function openQrModal(certificate: Certificate): Promise<void> {
  qrModalCertificate.value = certificate
  qrDataUrl.value = await QRCode.toDataURL(verificationUrl(certificate.verificationCode), {
    margin: 1,
    color: { dark: '#16181d', light: '#ffffff' },
  })
}

function closeQrModal(): void {
  qrModalCertificate.value = null
  qrDataUrl.value = ''
}

async function copyVerificationLink(code: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(verificationUrl(code))
  } catch {
    // Clipboard indisponível (ex.: contexto não-seguro) — sem esse recurso, o link
    // continua visível/copiável manualmente na tela, não é uma falha bloqueante.
  }
}

const currentGraduation = computed<StudentGraduation | null>(() => graduations.value[0] ?? null)

// Timeline exibida em ordem cronológica crescente (mais antiga primeiro).
const timeline = computed<StudentGraduation[]>(() => [...graduations.value].reverse())

function formatDate(iso: string): string {
  // timeZone: 'UTC': graduatedAt vem do painel via <input type="date"> (meia-noite UTC) —
  // sem forçar UTC, um fuso negativo pode até mostrar o mês errado perto da virada do mês.
  return new Date(iso).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function formatCertificateDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
}

onMounted(async () => {
  isLoading.value = true
  loadError.value = ''
  try {
    const students = await api.get<Student[]>('/students/me')
    // TODO: seletor de aluno quando houver mais de um dependente
    const student = students[0]
    if (!student) {
      hasStudent.value = false
      return
    }
    graduations.value = await api.get<StudentGraduation[]>(`/graduations/students/${student.id}`)
    certificates.value = await api.get<Certificate[]>('/certificates/me')
  } catch (error) {
    loadError.value =
      error instanceof ApiError ? error.message : 'Não foi possível carregar sua jornada.'
  } finally {
    isLoading.value = false
  }
})
</script>

<template>
  <div class="flex flex-col gap-6 px-5 pb-6 pt-6">
    <header>
      <h1 class="text-xl font-semibold text-text">Jornada</h1>
      <p class="text-sm text-text-muted">Sua evolução e graduações no grupo</p>
    </header>

    <p v-if="loadError" class="rounded-card bg-danger/15 px-4 py-3 text-sm text-danger">{{ loadError }}</p>

    <p v-else-if="!isLoading && !hasStudent" class="rounded-card bg-surface px-4 py-3 text-sm text-text-muted">
      Nenhum aluno vinculado a esta conta.
    </p>

    <template v-else>
      <section v-if="currentGraduation" class="rounded-card-lg bg-surface p-5">
        <p class="text-xs text-text-muted">Graduação atual</p>
        <p class="mt-1 text-lg font-semibold text-accent">{{ currentGraduation.graduationLevel.name }}</p>
      </section>
      <p v-else-if="!isLoading" class="rounded-card bg-surface px-4 py-3 text-sm text-text-muted">
        Nenhuma graduação registrada ainda.
      </p>

      <section v-if="timeline.length > 0" class="flex flex-col gap-4">
        <h2 class="text-sm font-medium text-text-muted">Linha do tempo</h2>
        <ol class="flex flex-col gap-5">
          <li v-for="grad in timeline" :key="grad.id" class="flex items-start gap-4">
            <span class="mt-1 flex h-3 w-3 flex-shrink-0 rounded-full bg-accent" />
            <div class="flex-1 rounded-card bg-surface px-4 py-3">
              <p class="text-sm font-medium text-text">{{ grad.graduationLevel.name }}</p>
              <p class="text-xs text-text-muted">{{ formatDate(grad.graduatedAt) }}</p>
              <p v-if="grad.notes" class="mt-1 text-xs text-text-faint">{{ grad.notes }}</p>
            </div>
          </li>
        </ol>
      </section>

      <section v-if="certificates.length > 0" class="flex flex-col gap-4">
        <h2 class="text-sm font-medium text-text-muted">Certificados</h2>
        <ul class="flex flex-col gap-3">
          <li
            v-for="cert in certificates"
            :key="cert.id"
            class="flex items-center justify-between gap-3 rounded-card bg-surface px-4 py-3"
          >
            <div class="min-w-0">
              <p class="truncate text-sm font-medium text-text">{{ cert.title }}</p>
              <p class="text-xs text-text-muted">{{ formatCertificateDate(cert.issuedAt) }}</p>
            </div>
            <button
              type="button"
              class="shrink-0 rounded-card bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent"
              @click="openQrModal(cert)"
            >
              QR Code
            </button>
          </li>
        </ul>
      </section>
    </template>

    <!-- Modal QR Code -->
    <div
      v-if="qrModalCertificate"
      class="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 px-6"
      @click.self="closeQrModal"
    >
      <div class="w-full max-w-xs rounded-card-lg bg-surface p-6 text-center">
        <p class="text-sm font-medium text-text">{{ qrModalCertificate.title }}</p>
        <img v-if="qrDataUrl" :src="qrDataUrl" alt="QR Code de verificação" class="mx-auto mt-4 h-48 w-48 rounded-card" />
        <p class="mt-3 text-xs text-text-muted">Escaneie para validar a autenticidade deste certificado.</p>
        <div class="mt-4 flex justify-center gap-2">
          <button
            type="button"
            class="rounded-card bg-accent-soft px-4 py-2 text-xs font-medium text-accent"
            @click="copyVerificationLink(qrModalCertificate.verificationCode)"
          >
            Copiar link
          </button>
          <button type="button" class="rounded-card bg-bg-elevated px-4 py-2 text-xs font-medium text-text-muted" @click="closeQrModal">
            Fechar
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
