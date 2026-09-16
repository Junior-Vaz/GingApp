<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { api, ApiError } from '@/utils/api'

interface TeacherMembership {
  id: number
  role: 'MESTRE' | 'PROFESSOR'
  status: string
  user: { id: number; name: string; email: string; phone: string | null }
}

interface TeacherFormState {
  id: number | null
  name: string
  email: string
  phone: string
  password: string
  role: 'MESTRE' | 'PROFESSOR'
  status: string
}

const ROLE_LABEL: Record<TeacherFormState['role'], string> = {
  MESTRE: 'Mestre',
  PROFESSOR: 'Professor',
}

const teachers = ref<TeacherMembership[]>([])
const isLoading = ref(false)
const listError = ref('')

const isModalOpen = ref(false)
const isSubmitting = ref(false)
const formError = ref('')

function emptyForm(): TeacherFormState {
  return { id: null, name: '', email: '', phone: '', password: '', role: 'PROFESSOR', status: 'ACTIVE' }
}

const form = reactive<TeacherFormState>(emptyForm())

async function loadTeachers(): Promise<void> {
  isLoading.value = true
  listError.value = ''
  try {
    teachers.value = await api.get<TeacherMembership[]>('/teachers')
  } catch (error) {
    listError.value = error instanceof ApiError ? error.message : 'Não foi possível carregar os professores.'
  } finally {
    isLoading.value = false
  }
}

function openCreateModal(): void {
  Object.assign(form, emptyForm())
  formError.value = ''
  isModalOpen.value = true
}

function openEditModal(membership: TeacherMembership): void {
  Object.assign(form, {
    id: membership.id,
    name: membership.user.name,
    email: membership.user.email,
    phone: membership.user.phone ?? '',
    password: '',
    role: membership.role,
    status: membership.status,
  })
  formError.value = ''
  isModalOpen.value = true
}

function closeModal(): void {
  isModalOpen.value = false
}

async function submitForm(): Promise<void> {
  formError.value = ''
  if (!form.name.trim()) {
    formError.value = 'Informe o nome.'
    return
  }

  isSubmitting.value = true
  try {
    if (form.id) {
      await api.patch(`/teachers/${form.id}`, { name: form.name.trim(), phone: form.phone || undefined, role: form.role, status: form.status })
    } else {
      if (!form.email.trim() || form.password.length < 6) {
        formError.value = 'Informe e-mail e uma senha com pelo menos 6 caracteres.'
        isSubmitting.value = false
        return
      }
      await api.post('/teachers', {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone || undefined,
        password: form.password,
        role: form.role,
      })
    }
    isModalOpen.value = false
    await loadTeachers()
  } catch (error) {
    formError.value = error instanceof ApiError ? error.message : 'Não foi possível salvar o professor.'
  } finally {
    isSubmitting.value = false
  }
}

async function inactivate(membership: TeacherMembership): Promise<void> {
  if (!confirm(`Inativar "${membership.user.name}"? O histórico é preservado.`)) return
  try {
    await api.delete(`/teachers/${membership.id}`)
    await loadTeachers()
  } catch (error) {
    listError.value = error instanceof ApiError ? error.message : 'Não foi possível inativar.'
  }
}

onMounted(() => {
  void loadTeachers()
})
</script>

<template>
  <div>
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-slate-900">Professores</h1>
        <p class="mt-1 text-sm text-slate-500">Mestres e professores do grupo.</p>
      </div>
      <button
        type="button"
        class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
        @click="openCreateModal"
      >
        + Novo professor
      </button>
    </div>

    <p v-if="listError" class="mt-4 text-sm text-red-600">{{ listError }}</p>

    <div class="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th class="px-4 py-3 font-medium">Nome</th>
            <th class="px-4 py-3 font-medium">Papel</th>
            <th class="px-4 py-3 font-medium">Contato</th>
            <th class="px-4 py-3 font-medium">Status</th>
            <th class="px-4 py-3 font-medium"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-if="isLoading">
            <td colspan="5" class="px-4 py-8 text-center text-slate-400">Carregando…</td>
          </tr>
          <tr v-else-if="teachers.length === 0">
            <td colspan="5" class="px-4 py-8 text-center text-slate-400">Nenhum professor cadastrado ainda.</td>
          </tr>
          <tr v-for="membership in teachers" v-else :key="membership.id" class="hover:bg-slate-50">
            <td class="px-4 py-3 font-medium text-slate-900">{{ membership.user.name }}</td>
            <td class="px-4 py-3 text-slate-600">{{ ROLE_LABEL[membership.role] }}</td>
            <td class="px-4 py-3 text-slate-600">{{ membership.user.phone || membership.user.email }}</td>
            <td class="px-4 py-3">
              <span
                class="rounded-full px-2 py-0.5 text-xs font-medium"
                :class="membership.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'"
              >
                {{ membership.status === 'ACTIVE' ? 'Ativo' : 'Inativo' }}
              </span>
            </td>
            <td class="px-4 py-3 text-right">
              <button type="button" class="text-sm font-medium text-slate-600 hover:text-slate-900" @click="openEditModal(membership)">
                Editar
              </button>
              <button
                v-if="membership.status === 'ACTIVE'"
                type="button"
                class="ml-3 text-sm font-medium text-red-600 hover:text-red-700"
                @click="inactivate(membership)"
              >
                Inativar
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="isModalOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
      <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h2 class="text-lg font-semibold text-slate-900">{{ form.id ? 'Editar professor' : 'Novo professor' }}</h2>

        <form class="mt-4 space-y-4" @submit.prevent="submitForm">
          <div>
            <label class="mb-1 block text-sm font-medium text-slate-700">Nome</label>
            <input
              v-model="form.name"
              type="text"
              required
              class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
            />
          </div>

          <div v-if="!form.id">
            <label class="mb-1 block text-sm font-medium text-slate-700">E-mail</label>
            <input
              v-model="form.email"
              type="email"
              required
              class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
            />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="mb-1 block text-sm font-medium text-slate-700">Telefone</label>
              <input
                v-model="form.phone"
                type="text"
                class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
              />
            </div>
            <div>
              <label class="mb-1 block text-sm font-medium text-slate-700">Papel</label>
              <select
                v-model="form.role"
                class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
              >
                <option value="PROFESSOR">Professor</option>
                <option value="MESTRE">Mestre</option>
              </select>
            </div>
          </div>

          <div v-if="!form.id">
            <label class="mb-1 block text-sm font-medium text-slate-700">Senha inicial</label>
            <input
              v-model="form.password"
              type="password"
              required
              minlength="6"
              class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
            />
          </div>

          <div v-if="form.id">
            <label class="mb-1 block text-sm font-medium text-slate-700">Status</label>
            <select
              v-model="form.status"
              class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
            >
              <option value="ACTIVE">Ativo</option>
              <option value="INACTIVE">Inativo</option>
            </select>
          </div>

          <p v-if="formError" class="text-sm text-red-600">{{ formError }}</p>

          <div class="flex justify-end gap-2 pt-2">
            <button type="button" class="rounded-md px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100" @click="closeModal">
              Cancelar
            </button>
            <button
              type="submit"
              :disabled="isSubmitting"
              class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {{ isSubmitting ? 'Salvando…' : 'Salvar' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
