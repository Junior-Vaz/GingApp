<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api, ApiError } from '@/utils/api'

interface Organization {
  id: number
  name: string
  slug: string
  type: string
  status: string
}

const organizations = ref<Organization[]>([])
const isLoading = ref(false)
const listError = ref('')

async function loadOrganizations(): Promise<void> {
  isLoading.value = true
  listError.value = ''
  try {
    organizations.value = await api.get<Organization[]>('/organizations')
  } catch (error) {
    listError.value = error instanceof ApiError ? error.message : 'Não foi possível carregar as organizações.'
  } finally {
    isLoading.value = false
  }
}

onMounted(() => {
  void loadOrganizations()
})
</script>

<template>
  <div>
    <h1 class="text-2xl font-semibold tracking-tight text-slate-900">Organizations</h1>
    <p class="mt-1 text-sm text-slate-500">Grupos de capoeira cadastrados na plataforma.</p>

    <p v-if="listError" class="mt-4 text-sm text-red-600">{{ listError }}</p>

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
          <tr v-for="org in organizations" v-else :key="org.id" class="hover:bg-slate-50">
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
  </div>
</template>
