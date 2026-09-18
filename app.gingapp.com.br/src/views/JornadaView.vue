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

// "Deixe as cores das graduações mais fracas" (pedido do owner, PLANO_PROJETO.md §10.33) — as
// cores cadastradas em GraduationLevel.color são as cores reais das cordas (podem ser bem vívidas,
// ex.: #22c55e), mas usadas em blocos grandes (card de destaque, círculo de 56px) ficam fortes
// demais. Em vez de editar a cor cadastrada (que é dado da organização, deveria continuar
// representando a cor real da corda no cadastro), a tela mistura a cor com branco na hora de
// EXIBIR — sempre a mesma proporção, então funciona pra qualquer cor que uma organização cadastre,
// não só pras 3 do seed atual.
function softenColor(hex: string | null): string | null {
  if (!hex) return null
  const clean = hex.replace('#', '')
  if (clean.length !== 6) return hex
  const whiteMix = 0.35
  const channel = (start: number, end: number): number => {
    const value = parseInt(clean.slice(start, end), 16)
    return Math.round(value * (1 - whiteMix) + 255 * whiteMix)
  }
  const toHex = (value: number): string => value.toString(16).padStart(2, '0')
  return `#${toHex(channel(0, 2))}${toHex(channel(2, 4))}${toHex(channel(4, 6))}`
}

// Heurística simples de luminância pra decidir ícone claro/escuro em cima da cor da graduação —
// necessário porque as cores das cordas variam livremente (ex.: "Crua" é quase branca, #e5e5e5,
// onde um ícone branco ficaria ilegível; "Azul"/"Verde" já são escuras o bastante pro branco).
// Recebe sempre a cor já suavizada (softenColor) — a decisão de contraste tem que bater com a cor
// de verdade renderizada na tela, não com a cor crua do cadastro.
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
        :style="{ backgroundColor: softenColor(currentGraduation.graduationLevel.color) ?? 'var(--color-accent)' }"
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
            class="animate-rise grid grid-cols-[2.5rem_1.5rem_1fr] items-stretch gap-1"
            :style="{ animationDelay: `${index * 70}ms` }"
          >
            <div class="pt-2 text-right">
              <p class="text-xs font-bold uppercase text-text">{{ formatMonthShort(grad.graduatedAt) }}</p>
              <p class="text-[10px] font-medium text-text-faint">{{ formatYear(grad.graduatedAt) }}</p>
            </div>

            <div class="flex flex-col items-center">
              <span
                class="mt-3.5 h-3.5 w-3.5 shrink-0 rounded-full ring-4 ring-bg"
                :style="{ backgroundColor: softenColor(grad.graduationLevel.color) ?? 'var(--color-accent)' }"
              />
              <!-- A linha precisa preencher a MESMA altura do bloco de conteúdo ao lado (que tem
              o pb-9 de espaçamento entre itens) — se o espaçamento ficasse só no <li>, fora do
              grid, a linha (flex-1 dentro da célula do grid) pararia bem antes do próximo ponto,
              deixando um vão sem conexão visual (bug relatado pelo owner: "a linha do tempo
              ainda não ficou bem desenhada"). Com o padding-bottom DENTRO da coluna de conteúdo,
              o grid (items-stretch) estica as 3 colunas pra mesma altura, e a linha (flex-1)
              cresce até encostar no próximo ponto de verdade. -->
              <span v-if="index < timeline.length - 1" class="mt-0.5 w-0.5 flex-1 rounded-full bg-border" />
            </div>

            <div class="flex items-center gap-3" :class="index === timeline.length - 1 ? '' : 'pb-9'">
              <span
                class="flex h-14 w-14 shrink-0 items-center justify-center rounded-full shadow-sm"
                :style="{
                  backgroundColor: softenColor(grad.graduationLevel.color) ?? 'var(--color-accent)',
                  color: readableIconColor(softenColor(grad.graduationLevel.color)),
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
