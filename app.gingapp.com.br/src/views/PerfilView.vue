<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import QRCode from 'qrcode'
import { useAuthStore } from '../stores/auth'
import { api, ApiError } from '../utils/api'
import AppIcon, { type IconName } from '../components/icons/AppIcon.vue'
import StatTile from '../components/ui/StatTile.vue'
import SectionHeader from '../components/ui/SectionHeader.vue'
import AvatarCircle from '../components/ui/AvatarCircle.vue'

interface SocialLinks {
  instagram?: string
  youtube?: string
  tiktok?: string
  facebook?: string
  whatsapp?: string
}

interface Student {
  id: number
  userId: number | null
  name: string
  photo: string | null
  coverPhoto: string | null
  socialLinks: SocialLinks | null
}

interface SocialFieldDef {
  key: keyof SocialLinks
  label: string
  icon: IconName
  placeholder: string
}

// Estilo de referência colado pelo owner (card de perfil com foto de capa + avatar sobreposto +
// redes sociais, PLANO_PROJETO.md §10.31) — conjunto fixo de plataformas, não um link genérico
// qualquer, pra manter a validação de URL simples no backend.
const SOCIAL_FIELDS: SocialFieldDef[] = [
  { key: 'instagram', label: 'Instagram', icon: 'instagram', placeholder: 'https://instagram.com/seu_usuario' },
  { key: 'youtube', label: 'YouTube', icon: 'youtube', placeholder: 'https://youtube.com/@seu_canal' },
  { key: 'tiktok', label: 'TikTok', icon: 'tiktok', placeholder: 'https://tiktok.com/@seu_usuario' },
  { key: 'facebook', label: 'Facebook', icon: 'facebook', placeholder: 'https://facebook.com/seu_perfil' },
  { key: 'whatsapp', label: 'WhatsApp', icon: 'whatsapp', placeholder: 'https://wa.me/5511999999999' },
]

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

// `students` (GET /students/me) traz o PRÓPRIO Student (se existir) + os dependentes de quem o
// usuário é responsável, sem ordem garantida a partir do índice — "meu" Student de verdade é o
// que tem userId igual ao do usuário logado, nunca students[0] (que pode ser um dependente pra
// um RESPONSAVEL sem Student próprio). Foto de capa/social só fazem sentido no PRÓPRIO perfil,
// nunca no de um dependente (auto-atendimento, PATCH /students/me/profile é sempre sobre "eu").
const myStudent = computed<Student | null>(() => students.value.find((s) => s.userId === auth.user?.id) ?? null)

const socialButtons = computed(() => {
  const links = myStudent.value?.socialLinks
  if (!links) return []
  return SOCIAL_FIELDS.filter((field) => links[field.key]).map((field) => ({ ...field, url: links[field.key]! }))
})

const isEditModalOpen = ref(false)
const isSavingProfile = ref(false)
const profileFormError = ref('')

const editForm = reactive({
  photo: '',
  coverPhoto: '',
  instagram: '',
  youtube: '',
  tiktok: '',
  facebook: '',
  whatsapp: '',
})

function openEditModal(): void {
  if (!myStudent.value) return
  editForm.photo = myStudent.value.photo ?? ''
  editForm.coverPhoto = myStudent.value.coverPhoto ?? ''
  const links = myStudent.value.socialLinks ?? {}
  editForm.instagram = links.instagram ?? ''
  editForm.youtube = links.youtube ?? ''
  editForm.tiktok = links.tiktok ?? ''
  editForm.facebook = links.facebook ?? ''
  editForm.whatsapp = links.whatsapp ?? ''
  profileFormError.value = ''
  isEditModalOpen.value = true
}

function closeEditModal(): void {
  isEditModalOpen.value = false
}

async function submitProfile(): Promise<void> {
  profileFormError.value = ''
  isSavingProfile.value = true
  try {
    await api.patch('/students/me/profile', {
      photo: editForm.photo.trim() || undefined,
      coverPhoto: editForm.coverPhoto.trim() || undefined,
      socialLinks: {
        instagram: editForm.instagram.trim() || undefined,
        youtube: editForm.youtube.trim() || undefined,
        tiktok: editForm.tiktok.trim() || undefined,
        facebook: editForm.facebook.trim() || undefined,
        whatsapp: editForm.whatsapp.trim() || undefined,
      },
    })
    students.value = await api.get<Student[]>('/students/me')
    isEditModalOpen.value = false
  } catch (error) {
    profileFormError.value = error instanceof ApiError ? error.message : 'Não foi possível salvar o perfil.'
  } finally {
    isSavingProfile.value = false
  }
}

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
    <header class="flex flex-col">
      <div class="relative">
        <div class="relative h-40 w-full overflow-hidden rounded-card-lg">
          <img
            v-if="myStudent?.coverPhoto"
            :src="myStudent.coverPhoto"
            alt=""
            class="absolute inset-0 h-full w-full object-cover"
          />
          <div v-else class="absolute inset-0 bg-gradient-to-br from-accent-hover to-accent/50" />
          <div class="absolute inset-0 bg-gradient-to-t from-black/40 via-black/5 to-transparent" />
          <button
            v-if="myStudent"
            type="button"
            class="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-white/85 text-text shadow-sm backdrop-blur-sm transition-transform duration-150 active:scale-90"
            aria-label="Editar perfil"
            @click="openEditModal"
          >
            <AppIcon name="pencil" :size="16" />
          </button>
        </div>
        <div class="absolute -bottom-11 left-5">
          <AvatarCircle :photo="myStudent?.photo" :name="auth.user?.name" :size="88" class="ring-4 ring-bg" />
        </div>
      </div>

      <div class="mt-14 flex flex-col gap-3 px-1">
        <div>
          <h1 class="text-xl font-bold text-text">{{ auth.user?.name ?? 'Aluno' }}</h1>
          <p class="text-sm text-text-muted">
            <span v-if="roleLabel">{{ roleLabel }}</span>
            <span v-if="auth.user?.organizationName"> · {{ auth.user.organizationName }}</span>
          </p>
        </div>

        <div v-if="socialButtons.length > 0" class="flex flex-wrap gap-2">
          <a
            v-for="social in socialButtons"
            :key="social.key"
            :href="social.url"
            target="_blank"
            rel="noopener noreferrer"
            class="flex h-9 w-9 items-center justify-center rounded-full bg-surface text-text-muted transition-transform duration-150 active:scale-90"
            :aria-label="social.label"
          >
            <AppIcon :name="social.icon" :size="16" />
          </a>
        </div>
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

    <!-- Modal de edição do perfil (foto, capa, redes sociais) -->
    <div
      v-if="isEditModalOpen"
      class="fixed inset-0 z-50 flex items-end justify-center bg-text/40 sm:items-center sm:px-6"
      @click.self="closeEditModal"
    >
      <div class="max-h-[85vh] w-full overflow-y-auto rounded-t-card-lg bg-surface p-6 sm:max-w-sm sm:rounded-card-lg">
        <h2 class="text-lg font-semibold text-text">Editar perfil</h2>

        <form class="mt-4 flex flex-col gap-4" @submit.prevent="submitProfile">
          <div>
            <label class="mb-1 block text-xs font-medium text-text-muted">Foto de perfil (URL)</label>
            <input
              v-model="editForm.photo"
              type="url"
              placeholder="https://..."
              class="w-full rounded-full bg-bg-elevated px-4 py-2 text-sm text-text outline-none focus:ring-2 focus:ring-accent/30"
            />
          </div>

          <div>
            <label class="mb-1 block text-xs font-medium text-text-muted">Foto de capa/fundo (URL)</label>
            <input
              v-model="editForm.coverPhoto"
              type="url"
              placeholder="https://..."
              class="w-full rounded-full bg-bg-elevated px-4 py-2 text-sm text-text outline-none focus:ring-2 focus:ring-accent/30"
            />
          </div>

          <p class="mt-1 text-xs font-semibold uppercase tracking-wide text-text-faint">Redes sociais</p>

          <div v-for="field in SOCIAL_FIELDS" :key="field.key">
            <label class="mb-1 flex items-center gap-1.5 text-xs font-medium text-text-muted">
              <AppIcon :name="field.icon" :size="14" />
              {{ field.label }}
            </label>
            <input
              v-model="editForm[field.key]"
              type="url"
              :placeholder="field.placeholder"
              class="w-full rounded-full bg-bg-elevated px-4 py-2 text-sm text-text outline-none focus:ring-2 focus:ring-accent/30"
            />
          </div>

          <p v-if="profileFormError" class="text-xs text-danger">{{ profileFormError }}</p>

          <div class="mt-2 flex justify-end gap-2">
            <button
              type="button"
              class="rounded-full px-4 py-2 text-xs font-semibold text-text-muted transition-transform duration-150 active:scale-95"
              @click="closeEditModal"
            >
              Cancelar
            </button>
            <button
              type="submit"
              :disabled="isSavingProfile"
              class="rounded-full bg-accent px-5 py-2 text-xs font-semibold text-white transition-transform duration-150 active:scale-95 disabled:opacity-60"
            >
              {{ isSavingProfile ? 'Salvando…' : 'Salvar' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
