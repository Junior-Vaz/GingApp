<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { api, ApiError } from '@/utils/api'

interface Organization {
  id: number
  name: string
}

interface PlatformAnnouncement {
  id: number
  title: string
  body: string
  targetOrganizationId: number | null
  targetOrganization: { id: number; name: string } | null
  publishedAt: string | null
  expiresAt: string | null
  isActive: boolean
}

interface AnnouncementFormState {
  title: string
  body: string
  targetOrganizationId: string
  expiresAt: string
}

const announcements = ref<PlatformAnnouncement[]>([])
const organizations = ref<Organization[]>([])
const isLoading = ref(false)
const listError = ref('')

const isModalOpen = ref(false)
const isSubmitting = ref(false)
const formError = ref('')

function emptyForm(): AnnouncementFormState {
  return { title: '', body: '', targetOrganizationId: '', expiresAt: '' }
}

const form = reactive<AnnouncementFormState>(emptyForm())

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
}

async function loadAll(): Promise<void> {
  isLoading.value = true
  listError.value = ''
  try {
    const [allAnnouncements, allOrganizations] = await Promise.all([
      api.get<PlatformAnnouncement[]>('/platform-announcements'),
      api.get<Organization[]>('/organizations'),
    ])
    announcements.value = allAnnouncements
    organizations.value = allOrganizations
  } catch (error) {
    listError.value = error instanceof ApiError ? error.message : 'Não foi possível carregar os avisos.'
  } finally {
    isLoading.value = false
  }
}

function openCreateModal(): void {
  Object.assign(form, emptyForm())
  formError.value = ''
  isModalOpen.value = true
}

function closeModal(): void {
  isModalOpen.value = false
}

async function submitForm(): Promise<void> {
  formError.value = ''
  if (form.title.trim().length < 2 || form.body.trim().length < 2) {
    formError.value = 'Informe título e mensagem (mínimo 2 caracteres).'
    return
  }

  isSubmitting.value = true
  try {
    await api.post('/platform-announcements', {
      title: form.title.trim(),
      body: form.body.trim(),
      targetOrganizationId: form.targetOrganizationId ? Number(form.targetOrganizationId) : undefined,
      expiresAt: form.expiresAt || undefined,
    })
    isModalOpen.value = false
    await loadAll()
  } catch (error) {
    formError.value = error instanceof ApiError ? error.message : 'Não foi possível publicar o aviso.'
  } finally {
    isSubmitting.value = false
  }
}

async function deactivate(announcement: PlatformAnnouncement): Promise<void> {
  if (!confirm(`Encerrar o aviso "${announcement.title}"? Deixa de aparecer para os grupos.`)) {
    return
  }
  try {
    await api.delete(`/platform-announcements/${announcement.id}`)
    await loadAll()
  } catch (error) {
    listError.value = error instanceof ApiError ? error.message : 'Não foi possível encerrar o aviso.'
  }
}

onMounted(() => {
  void loadAll()
})
</script>

<template>
  <div>
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-slate-900">Avisos</h1>
        <p class="mt-1 text-sm text-slate-500">Avisos da equipe GingApp para os grupos.</p>
      </div>
      <button
        type="button"
        class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
        @click="openCreateModal"
      >
        + Novo aviso
      </button>
    </div>

    <p v-if="listError" class="mt-4 text-sm text-red-600">{{ listError }}</p>

    <div class="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th class="px-4 py-3 font-medium">Título</th>
            <th class="px-4 py-3 font-medium">Alvo</th>
            <th class="px-4 py-3 font-medium">Publicado em</th>
            <th class="px-4 py-3 font-medium">Expira em</th>
            <th class="px-4 py-3 font-medium">Status</th>
            <th class="px-4 py-3 font-medium"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-if="isLoading">
            <td colspan="6" class="px-4 py-8 text-center text-slate-400">Carregando…</td>
          </tr>
          <tr v-else-if="announcements.length === 0">
            <td colspan="6" class="px-4 py-8 text-center text-slate-400">Nenhum aviso publicado ainda.</td>
          </tr>
          <tr v-for="announcement in announcements" v-else :key="announcement.id" class="hover:bg-slate-50">
            <td class="px-4 py-3 font-medium text-slate-900">{{ announcement.title }}</td>
            <td class="px-4 py-3 text-slate-600">{{ announcement.targetOrganization?.name ?? 'Todos os grupos' }}</td>
            <td class="px-4 py-3 text-slate-600">{{ formatDate(announcement.publishedAt) }}</td>
            <td class="px-4 py-3 text-slate-600">{{ formatDate(announcement.expiresAt) }}</td>
            <td class="px-4 py-3">
              <span
                class="rounded-full px-2 py-0.5 text-xs font-medium"
                :class="announcement.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'"
              >
                {{ announcement.isActive ? 'Ativo' : 'Encerrado' }}
              </span>
            </td>
            <td class="px-4 py-3 text-right">
              <button
                v-if="announcement.isActive"
                type="button"
                class="text-sm font-medium text-red-600 hover:text-red-700"
                @click="deactivate(announcement)"
              >
                Encerrar
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Modal criar -->
    <div v-if="isModalOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
      <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h2 class="text-lg font-semibold text-slate-900">Novo aviso</h2>

        <form class="mt-4 space-y-4" @submit.prevent="submitForm">
          <div>
            <label class="mb-1 block text-sm font-medium text-slate-700">Título</label>
            <input
              v-model="form.title"
              type="text"
              required
              class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
            />
          </div>

          <div>
            <label class="mb-1 block text-sm font-medium text-slate-700">Mensagem</label>
            <textarea
              v-model="form.body"
              rows="3"
              required
              class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
            />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="mb-1 block text-sm font-medium text-slate-700">Destinatário</label>
              <select
                v-model="form.targetOrganizationId"
                class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
              >
                <option value="">Todos os grupos</option>
                <option v-for="org in organizations" :key="org.id" :value="org.id">{{ org.name }}</option>
              </select>
            </div>
            <div>
              <label class="mb-1 block text-sm font-medium text-slate-700">Expira em</label>
              <input
                v-model="form.expiresAt"
                type="date"
                class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
              />
            </div>
          </div>

          <p v-if="formError" class="text-sm text-red-600">{{ formError }}</p>

          <div class="flex justify-end gap-2 pt-2">
            <button
              type="button"
              class="rounded-md px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              @click="closeModal"
            >
              Cancelar
            </button>
            <button
              type="submit"
              :disabled="isSubmitting"
              class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {{ isSubmitting ? 'Publicando…' : 'Publicar' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
