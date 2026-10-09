<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { api, errorMessage } from '@/utils/api'
import { setFlash } from '@/utils/flash'

interface Organization {
  id: number
  name: string
  slug: string
  type: string
  status: string
}

interface CreatedGroup extends Organization {
  mestre: { id: number; name: string; email: string }
}

interface CreateFormState {
  name: string
  slug: string
  document: string
  email: string
  phone: string
  mestreName: string
  mestreEmail: string
  password: string
  passwordConfirm: string
}

const PASSWORD_MIN = 12
const PASSWORD_MAX_BYTES = 72
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const CREATED_NOTICE = 'Grupo criado — informe ao MESTRE a senha inicial por canal seguro.'

const router = useRouter()
const authStore = useAuthStore()

const organizations = ref<Organization[]>([])
const isLoading = ref(false)
const listError = ref('')

const isModalOpen = ref(false)
const isSubmitting = ref(false)
const formError = ref('')

function emptyForm(): CreateFormState {
  return {
    name: '',
    slug: '',
    document: '',
    email: '',
    phone: '',
    mestreName: '',
    mestreEmail: '',
    password: '',
    passwordConfirm: '',
  }
}
const form = reactive<CreateFormState>(emptyForm())

/**
 * Só um super admin ATIVO cria grupos (o backend responde 403 para o resto): mesmo critério da tela
 * Team. O flag vem do login; se foi rebaixado depois, o 403 do backend aparece no formulário.
 */
const canCreate = computed(() => {
  const me = authStore.user
  return !!me && me.userType === 'PLATFORM' && me.isSuperAdmin
})

async function loadOrganizations(): Promise<void> {
  isLoading.value = true
  listError.value = ''
  try {
    organizations.value = await api.get<Organization[]>('/organizations')
  } catch (error) {
    listError.value = errorMessage(error, 'Não foi possível carregar as organizações.')
  } finally {
    isLoading.value = false
  }
}

function openCreate(): void {
  Object.assign(form, emptyForm())
  formError.value = ''
  isModalOpen.value = true
}

function closeModal(): void {
  isModalOpen.value = false
  // Nunca deixa uma senha digitada na memória do formulário depois de enviada/cancelada.
  Object.assign(form, emptyForm())
}

function passwordProblem(password: string, confirmation: string): string | null {
  if (password.length < PASSWORD_MIN) return `A senha precisa ter no mínimo ${PASSWORD_MIN} caracteres.`
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) {
    return `A senha pode ter no máximo ${PASSWORD_MAX_BYTES} caracteres.`
  }
  if (password !== confirmation) return 'A confirmação da senha não confere.'
  return null
}

async function submitCreate(): Promise<void> {
  if (isSubmitting.value) return // Enter repetido durante o envio não cria dois grupos
  formError.value = ''
  if (form.name.trim().length < 2) {
    formError.value = 'Informe o nome do grupo (mínimo 2 caracteres).'
    return
  }
  const slug = form.slug.trim()
  if (slug && (slug.length < 2 || slug.length > 60 || !SLUG_PATTERN.test(slug))) {
    formError.value = 'O slug deve ter de 2 a 60 caracteres: letras minúsculas, números e hífens (ex.: grupo-ginga).'
    return
  }
  if (form.mestreName.trim().length < 2) {
    formError.value = 'Informe o nome do MESTRE (mínimo 2 caracteres).'
    return
  }
  if (!/^\S+@\S+\.\S+$/.test(form.mestreEmail.trim())) {
    formError.value = 'Informe um e-mail válido para o MESTRE.'
    return
  }
  const problem = passwordProblem(form.password, form.passwordConfirm)
  if (problem) {
    formError.value = problem
    return
  }

  isSubmitting.value = true
  try {
    const created = await api.post<CreatedGroup>('/organizations', {
      name: form.name.trim(),
      slug: slug || undefined,
      document: form.document.trim() || undefined,
      email: form.email.trim() || undefined,
      phone: form.phone.trim() || undefined,
      mestre: {
        name: form.mestreName.trim(),
        email: form.mestreEmail.trim(),
        password: form.password,
      },
    })
    closeModal()
    setFlash(CREATED_NOTICE)
    await router.push(`/organizations/${created.id}`)
  } catch (error) {
    // A senha não é reaproveitada depois de um erro: quem corrige o formulário a digita de novo.
    form.password = ''
    form.passwordConfirm = ''
    formError.value = errorMessage(error, 'Não foi possível criar o grupo.')
  } finally {
    isSubmitting.value = false
  }
}

onMounted(() => {
  void loadOrganizations()
})
</script>

<template>
  <div>
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-slate-900">Organizations</h1>
        <p class="mt-1 text-sm text-slate-500">Grupos de capoeira cadastrados na plataforma.</p>
      </div>
      <button
        v-if="canCreate"
        type="button"
        data-testid="new-group"
        class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
        @click="openCreate"
      >
        + Novo grupo
      </button>
    </div>

    <p
      v-if="!canCreate"
      data-testid="readonly-note"
      class="mt-4 rounded-md border border-slate-200 bg-slate-100 px-4 py-3 text-sm text-slate-600"
    >
      Somente super admins ativos podem criar grupos. Você pode apenas consultar a lista.
    </p>

    <p v-if="listError" role="alert" class="mt-4 text-sm text-red-600">{{ listError }}</p>

    <div class="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th class="px-4 py-3 font-medium">Nome</th>
            <th class="px-4 py-3 font-medium">Slug</th>
            <th class="px-4 py-3 font-medium">Tipo</th>
            <th class="px-4 py-3 font-medium">Status</th>
            <th class="px-4 py-3 font-medium"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-if="isLoading">
            <td colspan="5" class="px-4 py-8 text-center text-slate-400">Carregando…</td>
          </tr>
          <tr v-else-if="organizations.length === 0">
            <td colspan="5" class="px-4 py-8 text-center text-slate-400">Nenhuma organização cadastrada ainda.</td>
          </tr>
          <tr v-for="org in organizations" v-else :key="org.id" class="hover:bg-slate-50" :data-testid="`org-${org.id}`">
            <td class="px-4 py-3 font-medium text-slate-900">{{ org.name }}</td>
            <td class="px-4 py-3 text-slate-600">{{ org.slug }}</td>
            <td class="px-4 py-3 text-slate-600">{{ org.type }}</td>
            <td class="px-4 py-3">
              <span
                class="rounded-full px-2 py-0.5 text-xs font-medium"
                :class="org.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'"
              >
                {{ org.status }}
              </span>
            </td>
            <td class="px-4 py-3 text-right">
              <RouterLink
                :to="`/organizations/${org.id}`"
                class="text-sm font-medium text-slate-600 hover:text-slate-900"
              >
                Ver detalhes →
              </RouterLink>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Modal novo grupo -->
    <div v-if="isModalOpen" class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 px-4 py-8">
      <div class="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl" role="dialog" aria-modal="true">
        <h2 class="text-lg font-semibold text-slate-900">Novo grupo</h2>
        <p class="mt-1 text-sm text-slate-500">Cria o grupo e o seu MESTRE (primeiro acesso ao painel).</p>

        <form class="mt-4 space-y-4" autocomplete="off" @submit.prevent="submitCreate">
          <fieldset class="space-y-4">
            <legend class="text-sm font-semibold text-slate-900">Grupo</legend>
            <div>
              <label for="org-name" class="mb-1 block text-sm font-medium text-slate-700">Nome</label>
              <input id="org-name" v-model="form.name" type="text" maxlength="120" class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500" />
            </div>
            <div>
              <label for="org-slug" class="mb-1 block text-sm font-medium text-slate-700">Slug (opcional)</label>
              <input id="org-slug" v-model="form.slug" type="text" maxlength="60" placeholder="gerado a partir do nome" class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500" />
              <p class="mt-1 text-xs text-slate-400">Letras minúsculas, números e hífens. Em branco, é gerado do nome.</p>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label for="org-document" class="mb-1 block text-sm font-medium text-slate-700">CPF/CNPJ (opcional)</label>
                <input id="org-document" v-model="form.document" type="text" maxlength="18" class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500" />
              </div>
              <div>
                <label for="org-phone" class="mb-1 block text-sm font-medium text-slate-700">Telefone (opcional)</label>
                <input id="org-phone" v-model="form.phone" type="text" maxlength="30" class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500" />
              </div>
            </div>
            <div>
              <label for="org-email" class="mb-1 block text-sm font-medium text-slate-700">E-mail de contato (opcional)</label>
              <input id="org-email" v-model="form.email" type="email" maxlength="254" class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500" />
            </div>
          </fieldset>

          <fieldset class="space-y-4 pt-2">
            <legend class="text-sm font-semibold text-slate-900">MESTRE do grupo</legend>
            <div>
              <label for="mestre-name" class="mb-1 block text-sm font-medium text-slate-700">Nome</label>
              <input id="mestre-name" v-model="form.mestreName" type="text" maxlength="120" class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500" />
            </div>
            <div>
              <label for="mestre-email" class="mb-1 block text-sm font-medium text-slate-700">E-mail (login)</label>
              <input id="mestre-email" v-model="form.mestreEmail" type="email" maxlength="254" class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500" />
              <p class="mt-1 text-xs text-slate-400">Gravado em minúsculas; é o e-mail que o MESTRE usa para entrar.</p>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label for="mestre-password" class="mb-1 block text-sm font-medium text-slate-700">Senha inicial</label>
                <input id="mestre-password" v-model="form.password" type="password" autocomplete="new-password" class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500" />
              </div>
              <div>
                <label for="mestre-password-confirm" class="mb-1 block text-sm font-medium text-slate-700">Confirmar senha</label>
                <input id="mestre-password-confirm" v-model="form.passwordConfirm" type="password" autocomplete="new-password" class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500" />
              </div>
            </div>
            <p class="-mt-2 text-xs text-slate-400">De {{ PASSWORD_MIN }} a {{ PASSWORD_MAX_BYTES }} caracteres. Informe-a ao MESTRE por canal seguro.</p>
          </fieldset>

          <p v-if="formError" role="alert" class="text-sm text-red-600">{{ formError }}</p>

          <div class="flex justify-end gap-2 pt-2">
            <button type="button" class="rounded-md px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100" @click="closeModal">Cancelar</button>
            <button type="submit" :disabled="isSubmitting" class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60">
              {{ isSubmitting ? 'Criando…' : 'Criar grupo' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
