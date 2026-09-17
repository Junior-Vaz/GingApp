<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import QRCode from 'qrcode'
import { useAuthStore } from '../stores/auth'
import { api, ApiError } from '../utils/api'
import AppIcon from '../components/icons/AppIcon.vue'
import StatTile from '../components/ui/StatTile.vue'
import SectionHeader from '../components/ui/SectionHeader.vue'

interface Student {
  id: number
  name: string
}

interface Passport {
  student: { id: number; name: string }
  organization: { name: string }
  unit: { name: string } | null
  currentGraduation: { name: string } | null
  stats: { aulas: number; rodas: number; eventos: number; graduacoes: number; certificados: number }
  publicProfile: { isPublished: boolean; publicCode: string } | null
}

const auth = useAuthStore()
const router = useRouter()

const students = ref<Student[]>([])
const loadError = ref('')

const passport = ref<Passport | null>(null)
const passportError = ref('')
const isPassportActionLoading = ref(false)

const isQrModalOpen = ref(false)
const qrDataUrl = ref('')

const ROLE_LABEL: Record<string, string> = {
  ALUNO: 'Aluno',
  RESPONSAVEL: 'Responsável',
  MESTRE: 'Mestre',
  PROFESSOR: 'Professor',
}

const roleLabel = computed(() => {
  const role = auth.user?.role
  return role ? (ROLE_LABEL[role] ?? role) : null
})

// Só um responsável (nunca o próprio aluno) autoriza o perfil público de um menor —
// PLANO_PROJETO.md §3.4/§10.16. O botão de consentimento só faz sentido pra esse papel.
const isGuardian = computed(() => auth.user?.role === 'RESPONSAVEL')

function verificationUrl(code: string): string {
  return `${window.location.origin}/verificar-passaporte/${code}`
}

async function loadPassport(): Promise<void> {
  passportError.value = ''
  try {
    passport.value = await api.get<Passport | null>('/passport/me')
  } catch (error) {
    passportError.value = error instanceof ApiError ? error.message : 'Não foi possível carregar o passaporte.'
  }
}

async function authorizePublicProfile(): Promise<void> {
  if (!passport.value) return
  passportError.value = ''
  isPassportActionLoading.value = true
  try {
    await api.patch('/passport/guardian-consent', { studentId: passport.value.student.id, consent: true })
    await publishPassport()
  } catch (error) {
    passportError.value = error instanceof ApiError ? error.message : 'Não foi possível autorizar o perfil público.'
  } finally {
    isPassportActionLoading.value = false
  }
}

async function publishPassport(): Promise<void> {
  if (!passport.value) return
  passportError.value = ''
  isPassportActionLoading.value = true
  try {
    await api.post('/passport/publish', { studentId: passport.value.student.id })
    await loadPassport()
  } catch (error) {
    passportError.value = error instanceof ApiError ? error.message : 'Não foi possível publicar o passaporte.'
  } finally {
    isPassportActionLoading.value = false
  }
}

async function unpublishPassport(): Promise<void> {
  if (!passport.value) return
  passportError.value = ''
  isPassportActionLoading.value = true
  try {
    await api.post('/passport/unpublish', { studentId: passport.value.student.id })
    await loadPassport()
  } catch (error) {
    passportError.value = error instanceof ApiError ? error.message : 'Não foi possível despublicar o passaporte.'
  } finally {
    isPassportActionLoading.value = false
  }
}

async function openQrModal(): Promise<void> {
  if (!passport.value?.publicProfile) return
  qrDataUrl.value = await QRCode.toDataURL(verificationUrl(passport.value.publicProfile.publicCode), {
    margin: 1,
    color: { dark: '#16181d', light: '#ffffff' },
  })
  isQrModalOpen.value = true
}

function closeQrModal(): void {
  isQrModalOpen.value = false
  qrDataUrl.value = ''
}

function handleLogout() {
  auth.logout()
  router.push('/login')
}

onMounted(async () => {
  try {
    students.value = await api.get<Student[]>('/students/me')
  } catch (error) {
    // Não bloqueia o perfil — a seção de alunos vinculados só some se falhar.
    loadError.value =
      error instanceof ApiError ? error.message : 'Não foi possível carregar os alunos vinculados.'
  }
  await loadPassport()
})
</script>

<template>
  <div class="flex flex-col gap-7 px-5 pb-6 pt-6">
    <header class="flex flex-col items-center gap-3 text-center">
      <span class="flex h-20 w-20 items-center justify-center rounded-full bg-accent text-2xl font-bold text-white">
        {{ auth.user?.name?.charAt(0) ?? 'A' }}
      </span>
      <div>
        <h1 class="text-lg font-bold text-text">{{ auth.user?.name ?? 'Aluno' }}</h1>
        <p class="text-sm text-text-muted">{{ auth.user?.email }}</p>
      </div>
      <div class="flex flex-col items-center gap-1.5">
        <span v-if="roleLabel" class="rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent">
          {{ roleLabel }}
        </span>
        <p v-if="auth.user?.organizationName" class="text-xs text-text-faint">
          {{ auth.user.organizationName }}
        </p>
      </div>
    </header>

    <section v-if="students.length > 0" class="flex flex-col gap-2 rounded-card-lg bg-surface p-4">
      <p class="text-xs font-medium text-text-muted">Aluno(s) vinculado(s)</p>
      <ul class="flex flex-col gap-1">
        <li v-for="student in students" :key="student.id" class="text-sm font-medium text-text">
          {{ student.name }}
        </li>
      </ul>
    </section>
    <p v-else-if="loadError" class="text-xs text-text-faint">{{ loadError }}</p>

    <section v-if="passport" class="flex flex-col gap-4">
      <SectionHeader title="Passaporte do Capoeirista" />
      <div class="rounded-card-lg bg-surface p-4">
        <p class="text-xs text-text-muted">
          {{ passport.organization.name }}<span v-if="passport.unit"> · {{ passport.unit.name }}</span>
          <span v-if="passport.currentGraduation"> · {{ passport.currentGraduation.name }}</span>
        </p>

        <div class="mt-4 grid grid-cols-3 gap-2.5">
          <StatTile icon="calendar" label="Aulas" :value="passport.stats.aulas" tone="neutral" surface="elevated" />
          <StatTile icon="drum" label="Rodas" :value="passport.stats.rodas" tone="neutral" surface="elevated" />
          <StatTile icon="ticket" label="Eventos" :value="passport.stats.eventos" tone="neutral" surface="elevated" />
          <StatTile icon="graduation" label="Graduações" :value="passport.stats.graduacoes" tone="neutral" surface="elevated" />
          <StatTile icon="trophy" label="Certificados" :value="passport.stats.certificados" tone="neutral" surface="elevated" />
        </div>

        <p v-if="passportError" class="mt-3 text-xs text-danger">{{ passportError }}</p>

        <div v-if="passport.publicProfile?.isPublished" class="mt-4 flex items-center justify-between gap-2 border-t border-border pt-4">
          <p class="flex items-center gap-1.5 text-xs font-medium text-success">
            <span class="h-1.5 w-1.5 rounded-full bg-success" /> Publicado
          </p>
          <div class="flex gap-2">
            <button type="button" class="rounded-full bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent" @click="openQrModal">
              Ver QR Code
            </button>
            <button
              type="button"
              :disabled="isPassportActionLoading"
              class="rounded-full bg-bg-elevated px-3 py-1.5 text-xs font-semibold text-text disabled:opacity-60"
              @click="unpublishPassport"
            >
              Despublicar
            </button>
          </div>
        </div>
        <div v-else class="mt-4 flex flex-col gap-2 border-t border-border pt-4">
          <button
            type="button"
            :disabled="isPassportActionLoading"
            class="rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            @click="publishPassport"
          >
            {{ isPassportActionLoading ? 'Publicando…' : 'Compartilhar Passaporte' }}
          </button>
          <button
            v-if="isGuardian"
            type="button"
            :disabled="isPassportActionLoading"
            class="rounded-full bg-bg-elevated px-4 py-2.5 text-sm font-semibold text-text disabled:opacity-60"
            @click="authorizePublicProfile"
          >
            Autorizar e publicar (responsável)
          </button>
        </div>
      </div>
    </section>

    <section class="flex flex-col gap-2 rounded-card-lg bg-surface p-2">
      <router-link to="/app/notificacoes" class="flex items-center gap-3 rounded-card px-3 py-3 text-sm font-medium text-text active:bg-surface-hover">
        <AppIcon name="bell" :size="18" class="text-text-muted" />
        <span class="flex-1">Notificações</span>
        <AppIcon name="chevron-right" :size="16" class="text-text-faint" />
      </router-link>
      <router-link to="/app/financeiro" class="flex items-center gap-3 rounded-card px-3 py-3 text-sm font-medium text-text active:bg-surface-hover">
        <AppIcon name="wallet" :size="18" class="text-text-muted" />
        <span class="flex-1">Financeiro</span>
        <AppIcon name="chevron-right" :size="16" class="text-text-faint" />
      </router-link>
      <button type="button" class="flex items-center gap-3 rounded-card px-3 py-3 text-left text-sm font-medium text-danger active:bg-surface-hover" @click="handleLogout">
        <span class="flex-1">Sair da conta</span>
      </button>
    </section>

    <!-- Modal QR Code do Passaporte -->
    <div
      v-if="isQrModalOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-text/40 px-6"
      @click.self="closeQrModal"
    >
      <div class="w-full max-w-xs rounded-card-lg bg-surface p-6 text-center shadow-lg">
        <p class="text-sm font-semibold text-text">Passaporte de {{ passport?.student.name }}</p>
        <img v-if="qrDataUrl" :src="qrDataUrl" alt="QR Code do Passaporte" class="mx-auto mt-4 h-48 w-48 rounded-card" />
        <p class="mt-3 text-xs text-text-muted">Escaneie para ver o Passaporte público.</p>
        <button type="button" class="mt-4 rounded-full bg-bg-elevated px-4 py-2 text-xs font-semibold text-text" @click="closeQrModal">
          Fechar
        </button>
      </div>
    </div>
  </div>
</template>
