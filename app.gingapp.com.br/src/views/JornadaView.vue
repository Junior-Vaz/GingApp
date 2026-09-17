<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import QRCode from 'qrcode'
import { api, ApiError } from '../utils/api'
import AppIcon from '../components/icons/AppIcon.vue'
import SectionHeader from '../components/ui/SectionHeader.vue'
import EmptyState from '../components/ui/EmptyState.vue'

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

// Data da timeline em duas linhas (mês/ano empilhados), como na referência do owner.
// timeZone: 'UTC': graduatedAt vem do painel via <input type="date"> (meia-noite UTC) — sem
// forçar UTC, um fuso negativo pode até mostrar o mês errado perto da virada do mês.
function formatMonthShort(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { month: 'short', timeZone: 'UTC' }).replace('.', '')
}

function formatYear(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { year: 'numeric', timeZone: 'UTC' })
}

// Heurística simples de luminância pra decidir ícone claro/escuro em cima da cor da graduação —
// necessário porque as cores das cordas variam livremente (ex.: "Crua" é quase branca, #e5e5e5,
// onde um ícone branco ficaria ilegível; "Azul"/"Verde" já são escuras o bastante pro branco).
function readableIconColor(hex: string | null): string {
  if (!hex) return '#ffffff'
  const clean = hex.replace('#', '')
  if (clean.length !== 6) return '#ffffff'
  const r = parseInt(clean.slice(0, 2), 16) / 255
  const g = parseInt(clean.slice(2, 4), 16) / 255
  const b = parseInt(clean.slice(4, 6), 16) / 255
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance > 0.75 ? '#16181d' : '#ffffff'
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
  <div class="flex flex-col gap-7 px-5 pb-6 pt-6">
    <header>
      <h1 class="text-2xl font-bold text-text">Jornada</h1>
      <p class="text-sm text-text-muted">Sua evolução e graduações no grupo</p>
    </header>

    <p v-if="loadError" class="rounded-card bg-danger/10 px-4 py-3 text-sm text-danger">{{ loadError }}</p>

    <EmptyState v-else-if="!isLoading && !hasStudent" icon="user" message="Nenhum aluno vinculado a esta conta." />

    <template v-else>
      <section
        v-if="currentGraduation"
        class="relative flex items-center gap-4 overflow-hidden rounded-card-lg p-5 text-white shadow-md"
        :style="{ backgroundColor: currentGraduation.graduationLevel.color ?? 'var(--color-accent)' }"
      >
        <div class="absolute inset-0 bg-black/30" />
        <span class="relative z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/20">
          <AppIcon name="graduation" :size="24" />
        </span>
        <div class="relative z-10">
          <p class="text-xs font-medium text-white/80">Graduação atual</p>
          <p class="text-xl font-bold">{{ currentGraduation.graduationLevel.name }}</p>
        </div>
      </section>
      <EmptyState v-else-if="!isLoading" icon="graduation" message="Nenhuma graduação registrada ainda." />

      <section v-if="timeline.length > 0" class="flex flex-col gap-1">
        <SectionHeader title="Linha do tempo" />
        <ol class="flex flex-col">
          <li
            v-for="(grad, index) in timeline"
            :key="grad.id"
            class="animate-rise grid grid-cols-[2.75rem_2rem_1fr] gap-2"
            :class="index === timeline.length - 1 ? '' : 'pb-9'"
            :style="{ animationDelay: `${index * 70}ms` }"
          >
            <div class="pt-2 text-right">
              <p class="text-xs font-bold uppercase text-text">{{ formatMonthShort(grad.graduatedAt) }}</p>
              <p class="text-[10px] font-medium text-text-faint">{{ formatYear(grad.graduatedAt) }}</p>
            </div>

            <div class="flex flex-col items-center">
              <span
                class="mt-3 h-3 w-3 shrink-0 rounded-full ring-4 ring-surface"
                :style="{ backgroundColor: grad.graduationLevel.color ?? 'var(--color-accent)' }"
              />
              <span v-if="index < timeline.length - 1" class="mt-1 w-0 flex-1 border-l-2 border-dashed border-border" />
            </div>

            <div class="flex items-center gap-3 pb-1">
              <span
                class="flex h-14 w-14 shrink-0 items-center justify-center rounded-full shadow-sm"
                :style="{
                  backgroundColor: grad.graduationLevel.color ?? 'var(--color-accent)',
                  color: readableIconColor(grad.graduationLevel.color),
                }"
              >
                <AppIcon name="graduation" :size="24" />
              </span>
              <div class="min-w-0">
                <p class="text-base font-semibold text-text">{{ grad.graduationLevel.name }}</p>
                <p v-if="grad.notes" class="mt-0.5 truncate text-xs text-text-muted">{{ grad.notes }}</p>
              </div>
            </div>
          </li>
        </ol>
      </section>

      <section v-if="certificates.length > 0" class="flex flex-col gap-3">
        <SectionHeader title="Certificados" />
        <ul class="flex flex-col gap-3">
          <li
            v-for="(cert, index) in certificates"
            :key="cert.id"
            class="animate-rise flex items-center gap-3 rounded-card-lg bg-surface p-4"
            :style="{ animationDelay: `${index * 60}ms` }"
          >
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
              <AppIcon name="trophy" :size="18" />
            </span>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-semibold text-text">{{ cert.title }}</p>
              <p class="text-xs text-text-muted">{{ formatCertificateDate(cert.issuedAt) }}</p>
            </div>
            <button
              type="button"
              class="shrink-0 rounded-full bg-bg-elevated px-3 py-1.5 text-xs font-semibold text-text transition-transform duration-150 active:scale-95"
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
      class="fixed inset-0 z-50 flex items-center justify-center bg-text/40 px-6"
      @click.self="closeQrModal"
    >
      <div class="w-full max-w-xs rounded-card-lg bg-surface p-6 text-center shadow-lg">
        <p class="text-sm font-semibold text-text">{{ qrModalCertificate.title }}</p>
        <img v-if="qrDataUrl" :src="qrDataUrl" alt="QR Code de verificação" class="mx-auto mt-4 h-48 w-48 rounded-card" />
        <p class="mt-3 text-xs text-text-muted">Escaneie para validar a autenticidade deste certificado.</p>
        <div class="mt-4 flex justify-center gap-2">
          <button
            type="button"
            class="rounded-full bg-accent-soft px-4 py-2 text-xs font-semibold text-accent transition-transform duration-150 active:scale-95"
            @click="copyVerificationLink(qrModalCertificate.verificationCode)"
          >
            Copiar link
          </button>
          <button
            type="button"
            class="rounded-full bg-bg-elevated px-4 py-2 text-xs font-semibold text-text transition-transform duration-150 active:scale-95"
            @click="closeQrModal"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
