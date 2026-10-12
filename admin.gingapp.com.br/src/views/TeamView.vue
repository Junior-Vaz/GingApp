<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import PaginationBar from '@/components/PaginationBar.vue'
import { useAuthStore } from '@/stores/auth'
import { api, errorMessage } from '@/utils/api'
import { formatDateTime } from '@/utils/format'
import { NEW_PASSWORD_MIN_LENGTH, PASSWORD_MAX_BYTES, passwordProblem } from '@/utils/password'
import { resetUserTwoFactor } from '@/utils/twoFactor'

type MemberStatus = 'ACTIVE' | 'INACTIVE'

interface TeamMember {
  id: number
  name: string
  email: string
  phone: string | null
  status: MemberStatus
  isSuperAdmin: boolean
  createdAt: string
  tokenValidAfter: string | null
  twoFactorEnabled?: boolean
}

interface CreateFormState {
  name: string
  email: string
  phone: string
  password: string
  passwordConfirm: string
  isSuperAdmin: boolean
}

interface EditFormState {
  name: string
  phone: string
  isSuperAdmin: boolean
}

const PAGE_SIZE = 20
const SEARCH_DEBOUNCE_MS = 300

const router = useRouter()
const authStore = useAuthStore()

const members = ref<TeamMember[]>([])
const total = ref(0)
const offset = ref(0)
const search = ref('')
const statusFilter = ref<'' | MemberStatus>('')
const isLoading = ref(false)
const listError = ref('')
const notice = ref('')

type ModalKind = 'create' | 'edit' | 'password' | null
const modal = ref<ModalKind>(null)
const target = ref<TeamMember | null>(null)
const isSubmitting = ref(false)
const formError = ref('')

function emptyCreate(): CreateFormState {
  return { name: '', email: '', phone: '', password: '', passwordConfirm: '', isSuperAdmin: false }
}
const createForm = reactive<CreateFormState>(emptyCreate())
const editForm = reactive<EditFormState>({ name: '', phone: '', isSuperAdmin: false })
const passwordForm = reactive({ password: '', passwordConfirm: '' })

let requestSeq = 0
let searchTimer: ReturnType<typeof setTimeout> | null = null

const myId = computed(() => authStore.user?.id ?? null)

/**
 * Só um super admin ATIVO gere a equipe (o backend responde 403 para o resto). O flag vem do login;
 * se a própria conta aparece na lista carregada, o estado mais recente dela prevalece (cobre
 * rebaixamento/desativação ocorridos depois do login).
 */
const canManage = computed(() => {
  const me = authStore.user
  if (!me || me.userType !== 'PLATFORM' || !me.isSuperAdmin) return false
  const self = members.value.find((m) => m.id === me.id)
  if (self && (!self.isSuperAdmin || self.status !== 'ACTIVE')) return false
  return true
})

function isSelf(member: TeamMember): boolean {
  return myId.value !== null && member.id === myId.value
}

async function load(): Promise<void> {
  const seq = ++requestSeq
  isLoading.value = true
  listError.value = ''
  try {
    const page = await api.getPage<TeamMember>('/platform-team', {
      q: search.value.trim(),
      status: statusFilter.value,
      limit: PAGE_SIZE,
      offset: offset.value,
    })
    if (seq !== requestSeq) return
    members.value = page.items
    total.value = page.total
  } catch (error) {
    if (seq !== requestSeq) return
    listError.value = errorMessage(error, 'Não foi possível carregar a equipe.')
  } finally {
    if (seq === requestSeq) isLoading.value = false
  }
}

watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    offset.value = 0
    void load()
  }, SEARCH_DEBOUNCE_MS)
})

watch(statusFilter, () => {
  offset.value = 0
  void load()
})

function changeOffset(value: number): void {
  offset.value = value
  void load()
}

function closeModal(): void {
  modal.value = null
  target.value = null
  // Nunca deixa uma senha digitada na memória do formulário depois de enviada/cancelada.
  Object.assign(createForm, emptyCreate())
  passwordForm.password = ''
  passwordForm.passwordConfirm = ''
}

function openCreate(): void {
  Object.assign(createForm, emptyCreate())
  formError.value = ''
  modal.value = 'create'
}

function openEdit(member: TeamMember): void {
  target.value = member
  editForm.name = member.name
  editForm.phone = member.phone ?? ''
  editForm.isSuperAdmin = member.isSuperAdmin
  formError.value = ''
  modal.value = 'edit'
}

function openPassword(member: TeamMember): void {
  target.value = member
  passwordForm.password = ''
  passwordForm.passwordConfirm = ''
  formError.value = ''
  modal.value = 'password'
}

/** Depois de revogar sessões / trocar a senha da PRÓPRIA conta, o token atual deixa de valer. */
function leaveSession(): void {
  authStore.logout()
  void router.push({ name: 'login' })
}

async function submitCreate(): Promise<void> {
  formError.value = ''
  if (createForm.name.trim().length < 2) {
    formError.value = 'Informe o nome (mínimo 2 caracteres).'
    return
  }
  if (!/^\S+@\S+\.\S+$/.test(createForm.email.trim())) {
    formError.value = 'Informe um e-mail válido.'
    return
  }
  const problem = passwordProblem(createForm.password, createForm.passwordConfirm)
  if (problem) {
    formError.value = problem
    return
  }

  isSubmitting.value = true
  try {
    const email = createForm.email.trim()
    await api.post('/platform-team', {
      name: createForm.name.trim(),
      email,
      phone: createForm.phone.trim() || undefined,
      password: createForm.password,
      isSuperAdmin: createForm.isSuperAdmin,
    })
    closeModal()
    notice.value = `Usuário ${email} criado.`
    await load()
  } catch (error) {
    formError.value = errorMessage(error, 'Não foi possível criar o usuário.')
  } finally {
    isSubmitting.value = false
  }
}

async function submitEdit(): Promise<void> {
  const member = target.value
  if (!member) return
  formError.value = ''
  if (editForm.name.trim().length < 2) {
    formError.value = 'Informe o nome (mínimo 2 caracteres).'
    return
  }

  // Só envia o que mudou. isSuperAdmin da própria conta nunca vai (o backend responderia 403).
  const body: { name?: string; phone?: string | null; isSuperAdmin?: boolean } = {}
  if (editForm.name.trim() !== member.name) body.name = editForm.name.trim()
  const newPhone = editForm.phone.trim()
  if (newPhone !== (member.phone ?? '')) body.phone = newPhone === '' ? null : newPhone
  if (!isSelf(member) && editForm.isSuperAdmin !== member.isSuperAdmin) body.isSuperAdmin = editForm.isSuperAdmin

  if (Object.keys(body).length === 0) {
    closeModal()
    return
  }

  isSubmitting.value = true
  try {
    await api.patch(`/platform-team/${member.id}`, body)
    closeModal()
    notice.value = `Usuário ${member.email} atualizado.`
    await load()
  } catch (error) {
    formError.value = errorMessage(error, 'Não foi possível atualizar o usuário.')
    await load() // pode ter sido 409/403 por estado desatualizado
  } finally {
    isSubmitting.value = false
  }
}

async function toggleStatus(member: TeamMember): Promise<void> {
  const next: MemberStatus = member.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
  const question =
    next === 'INACTIVE'
      ? `Desativar ${member.email}? O usuário perde o acesso e as sessões dele são encerradas.`
      : `Reativar ${member.email}?`
  if (!confirm(question)) return

  listError.value = ''
  notice.value = ''
  try {
    await api.patch(`/platform-team/${member.id}`, { status: next })
    notice.value = next === 'INACTIVE' ? `Usuário ${member.email} desativado.` : `Usuário ${member.email} reativado.`
    await load()
  } catch (error) {
    const message = errorMessage(error, 'Não foi possível alterar o status do usuário.')
    await load() // estado pode estar desatualizado (409/403); load() limpa o erro, então ele é posto depois
    listError.value = message
  }
}

async function revokeSessions(member: TeamMember): Promise<void> {
  const self = isSelf(member)
  const question = self
    ? 'Revogar as suas próprias sessões? Você será desconectado e terá de entrar novamente.'
    : `Revogar todas as sessões de ${member.email}? O usuário terá de entrar novamente.`
  if (!confirm(question)) return

  listError.value = ''
  notice.value = ''
  try {
    await api.post(`/platform-team/${member.id}/revoke-sessions`)
    if (self) {
      leaveSession()
      return
    }
    notice.value = `Sessões de ${member.email} revogadas.`
    await load()
  } catch (error) {
    listError.value = errorMessage(error, 'Não foi possível revogar as sessões.')
  }
}

async function resetTwoFactor(member: TeamMember): Promise<void> {
  if (!confirm(`Redefinir o 2FA de ${member.email}? O 2FA é desativado, as sessões dele são encerradas e ele poderá ativá-lo de novo.`)) return
  listError.value = ''
  notice.value = ''
  try {
    await resetUserTwoFactor(member.id)
    notice.value = `2FA de ${member.email} redefinido; as sessões dele foram encerradas.`
    await load()
  } catch (error) {
    listError.value = errorMessage(error, 'Não foi possível redefinir o 2FA.')
  }
}

async function submitPassword(): Promise<void> {
  const member = target.value
  if (!member) return
  formError.value = ''
  const problem = passwordProblem(passwordForm.password, passwordForm.passwordConfirm)
  if (problem) {
    formError.value = problem
    return
  }

  isSubmitting.value = true
  try {
    await api.post(`/platform-team/${member.id}/reset-password`, { password: passwordForm.password })
    const self = isSelf(member)
    closeModal()
    if (self) {
      leaveSession()
      return
    }
    notice.value = `Senha de ${member.email} redefinida; as sessões dele foram encerradas.`
    await load()
  } catch (error) {
    formError.value = errorMessage(error, 'Não foi possível redefinir a senha.')
  } finally {
    isSubmitting.value = false
  }
}

onMounted(() => {
  void load()
})

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
})
</script>

<template>
  <div>
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-slate-900">Equipe</h1>
        <p class="mt-1 text-sm text-slate-500">Equipe interna da plataforma GingApp.</p>
      </div>
      <button
        v-if="canManage"
        type="button"
        class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
        @click="openCreate"
      >
        + Novo usuário
      </button>
    </div>

    <p
      v-if="!canManage"
      data-testid="readonly-note"
      class="mt-4 rounded-md border border-slate-200 bg-slate-100 px-4 py-3 text-sm text-slate-600"
    >
      Somente super admins ativos podem criar ou alterar usuários da equipe. Você pode apenas consultar a lista.
    </p>

    <div class="mt-4 flex flex-wrap gap-3">
      <input
        v-model="search"
        type="search"
        placeholder="Buscar por nome ou e-mail…"
        aria-label="Buscar por nome ou e-mail"
        class="w-full max-w-sm rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
      />
      <select
        v-model="statusFilter"
        aria-label="Filtrar por status"
        class="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
      >
        <option value="">Todos os status</option>
        <option value="ACTIVE">Ativos</option>
        <option value="INACTIVE">Inativos</option>
      </select>
    </div>

    <p v-if="notice" role="status" class="mt-4 text-sm text-emerald-700">{{ notice }}</p>
    <p v-if="listError" role="alert" class="mt-4 text-sm text-red-600">{{ listError }}</p>

    <div class="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th class="px-4 py-3 font-medium">Nome</th>
            <th class="px-4 py-3 font-medium">E-mail</th>
            <th class="px-4 py-3 font-medium">Telefone</th>
            <th class="px-4 py-3 font-medium">Status</th>
            <th class="px-4 py-3 font-medium">Criado em</th>
            <th class="px-4 py-3 font-medium">Sessões revogadas em</th>
            <th v-if="canManage" class="px-4 py-3 font-medium"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-if="isLoading && members.length === 0">
            <td :colspan="canManage ? 7 : 6" class="px-4 py-8 text-center text-slate-400">Carregando…</td>
          </tr>
          <tr v-else-if="members.length === 0">
            <td :colspan="canManage ? 7 : 6" class="px-4 py-8 text-center text-slate-400">
              {{ search.trim() || statusFilter ? 'Nenhum usuário encontrado para o filtro.' : 'Nenhum usuário na equipe.' }}
            </td>
          </tr>
          <tr v-for="member in members" v-else :key="member.id" class="hover:bg-slate-50" :data-testid="`member-${member.id}`">
            <td class="px-4 py-3 font-medium text-slate-900">
              {{ member.name }}
              <div v-if="isSelf(member) || member.isSuperAdmin" class="mt-1 flex gap-1">
                <span v-if="isSelf(member)" class="whitespace-nowrap rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700">você</span>
                <span
                  v-if="member.isSuperAdmin"
                  class="whitespace-nowrap rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700"
                >
                  super admin
                </span>
                </div>
            </td>
            <td class="px-4 py-3 text-slate-600">{{ member.email }}</td>
            <td class="px-4 py-3 text-slate-600">{{ member.phone ?? '—' }}</td>
            <td class="px-4 py-3">
              <span
                class="rounded-full px-2 py-0.5 text-xs font-medium"
                :class="member.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'"
              >
                {{ member.status === 'ACTIVE' ? 'Ativo' : 'Inativo' }}
              </span>
            </td>
            <td class="whitespace-nowrap px-4 py-3 text-slate-600">{{ formatDateTime(member.createdAt) }}</td>
            <td class="whitespace-nowrap px-4 py-3 text-slate-600">{{ formatDateTime(member.tokenValidAfter) }}</td>
            <td v-if="canManage" class="px-4 py-3">
              <div class="flex flex-wrap justify-end gap-x-3 gap-y-1">
              <button type="button" data-action="edit" class="text-sm font-medium text-slate-600 hover:text-slate-900" @click="openEdit(member)">
                Editar
              </button>
              <button
                v-if="!isSelf(member)"
                type="button"
                data-action="toggle-status"
                class="text-sm font-medium"
                :class="member.status === 'ACTIVE' ? 'text-red-600 hover:text-red-700' : 'text-emerald-700 hover:text-emerald-800'"
                @click="toggleStatus(member)"
              >
                {{ member.status === 'ACTIVE' ? 'Desativar' : 'Reativar' }}
              </button>
              <button type="button" data-action="revoke" class="text-sm font-medium text-slate-600 hover:text-slate-900" @click="revokeSessions(member)">
                Revogar sessões
              </button>
              <button type="button" data-action="password" class="text-sm font-medium text-slate-600 hover:text-slate-900" @click="openPassword(member)">
                Redefinir senha
              </button>
              <button
                v-if="!isSelf(member) && member.twoFactorEnabled"
                type="button"
                data-action="reset-2fa"
                class="text-sm font-medium text-slate-600 hover:text-slate-900"
                @click="resetTwoFactor(member)"
              >
                Redefinir 2FA
              </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <PaginationBar :total="total" :offset="offset" :limit="PAGE_SIZE" :disabled="isLoading" @update:offset="changeOffset" />
    </div>

    <!-- Modal criar -->
    <div v-if="modal === 'create'" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
      <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" role="dialog" aria-modal="true">
        <h2 class="text-lg font-semibold text-slate-900">Novo usuário da equipe</h2>

        <form class="mt-4 space-y-4" autocomplete="off" @submit.prevent="submitCreate">
          <div>
            <label for="team-name" class="mb-1 block text-sm font-medium text-slate-700">Nome</label>
            <input id="team-name" v-model="createForm.name" type="text" maxlength="120" class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500" />
          </div>
          <div>
            <label for="team-email" class="mb-1 block text-sm font-medium text-slate-700">E-mail</label>
            <input id="team-email" v-model="createForm.email" type="email" maxlength="254" class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500" />
          </div>
          <div>
            <label for="team-phone" class="mb-1 block text-sm font-medium text-slate-700">Telefone (opcional)</label>
            <input id="team-phone" v-model="createForm.phone" type="text" maxlength="30" class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500" />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label for="team-password" class="mb-1 block text-sm font-medium text-slate-700">Senha</label>
              <input id="team-password" v-model="createForm.password" type="password" autocomplete="new-password" class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500" />
            </div>
            <div>
              <label for="team-password-confirm" class="mb-1 block text-sm font-medium text-slate-700">Confirmar senha</label>
              <input id="team-password-confirm" v-model="createForm.passwordConfirm" type="password" autocomplete="new-password" class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500" />
            </div>
          </div>
          <p class="-mt-2 text-xs text-slate-400">De {{ NEW_PASSWORD_MIN_LENGTH }} a {{ PASSWORD_MAX_BYTES }} caracteres; não pode ser a senha padrão de desenvolvimento.</p>
          <label class="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input v-model="createForm.isSuperAdmin" type="checkbox" class="rounded border-slate-300" />
            Super admin (pode gerir a equipe)
          </label>

          <p v-if="formError" role="alert" class="text-sm text-red-600">{{ formError }}</p>

          <div class="flex justify-end gap-2 pt-2">
            <button type="button" class="rounded-md px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100" @click="closeModal">Cancelar</button>
            <button type="submit" :disabled="isSubmitting" class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60">
              {{ isSubmitting ? 'Criando…' : 'Criar usuário' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Modal editar -->
    <div v-if="modal === 'edit' && target" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
      <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" role="dialog" aria-modal="true">
        <h2 class="text-lg font-semibold text-slate-900">Editar usuário</h2>
        <p class="mt-1 text-sm text-slate-500">{{ target.email }}</p>

        <form class="mt-4 space-y-4" @submit.prevent="submitEdit">
          <div>
            <label for="edit-name" class="mb-1 block text-sm font-medium text-slate-700">Nome</label>
            <input id="edit-name" v-model="editForm.name" type="text" maxlength="120" class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500" />
          </div>
          <div>
            <label for="edit-phone" class="mb-1 block text-sm font-medium text-slate-700">Telefone</label>
            <input id="edit-phone" v-model="editForm.phone" type="text" maxlength="30" class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500" />
            <p class="mt-1 text-xs text-slate-400">Deixe em branco para remover o telefone.</p>
          </div>
          <div>
            <label class="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input v-model="editForm.isSuperAdmin" type="checkbox" :disabled="isSelf(target)" class="rounded border-slate-300 disabled:opacity-50" />
              Super admin
            </label>
            <p v-if="isSelf(target)" class="mt-1 text-xs text-slate-400">
              Você não pode alterar o seu próprio perfil de super admin nem o seu próprio status.
            </p>
          </div>

          <p v-if="formError" role="alert" class="text-sm text-red-600">{{ formError }}</p>

          <div class="flex justify-end gap-2 pt-2">
            <button type="button" class="rounded-md px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100" @click="closeModal">Cancelar</button>
            <button type="submit" :disabled="isSubmitting" class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60">
              {{ isSubmitting ? 'Salvando…' : 'Salvar' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Modal redefinir senha -->
    <div v-if="modal === 'password' && target" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
      <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" role="dialog" aria-modal="true">
        <h2 class="text-lg font-semibold text-slate-900">Redefinir senha</h2>
        <p class="mt-1 text-sm text-slate-500">
          {{ target.email }} — as sessões atuais {{ isSelf(target) ? 'da sua conta' : 'do usuário' }} serão encerradas.
        </p>

        <form class="mt-4 space-y-4" autocomplete="off" @submit.prevent="submitPassword">
          <div>
            <label for="reset-password" class="mb-1 block text-sm font-medium text-slate-700">Nova senha</label>
            <input id="reset-password" v-model="passwordForm.password" type="password" autocomplete="new-password" class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500" />
            <p class="mt-1 text-xs text-slate-400">De {{ NEW_PASSWORD_MIN_LENGTH }} a {{ PASSWORD_MAX_BYTES }} caracteres; não pode ser a senha padrão de desenvolvimento.</p>
          </div>
          <div>
            <label for="reset-password-confirm" class="mb-1 block text-sm font-medium text-slate-700">Confirmar nova senha</label>
            <input id="reset-password-confirm" v-model="passwordForm.passwordConfirm" type="password" autocomplete="new-password" class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500" />
          </div>

          <p v-if="formError" role="alert" class="text-sm text-red-600">{{ formError }}</p>

          <div class="flex justify-end gap-2 pt-2">
            <button type="button" class="rounded-md px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100" @click="closeModal">Cancelar</button>
            <button type="submit" :disabled="isSubmitting" class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60">
              {{ isSubmitting ? 'Salvando…' : 'Redefinir senha' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
