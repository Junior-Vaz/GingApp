<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import SponsorsTabs from '@/components/sponsors/SponsorsTabs.vue'
import { formatDateTime, formatInt } from '@/utils/format'
import { filterGroups, supervisionError, type SponsorGroupRow } from '@/utils/sponsorGroups'
import { sponsorsApi } from '@/utils/sponsorsApi'

const groups = ref<SponsorGroupRow[]>([])
const search = ref('')
const isLoading = ref(false)
const listError = ref('')
let requestSeq = 0

const visible = computed(() => filterGroups(groups.value, search.value))
const blockedCount = computed(() => groups.value.filter((g) => g.blocked).length)

async function load(): Promise<void> {
  const seq = ++requestSeq
  isLoading.value = true
  listError.value = ''
  try {
    const page = await sponsorsApi.listGroups()
    if (seq !== requestSeq) return
    groups.value = page.items
  } catch (e) {
    if (seq !== requestSeq) return
    listError.value = supervisionError(e, 'Não foi possível carregar os grupos com patrocínio local.')
  } finally {
    if (seq === requestSeq) isLoading.value = false
  }
}

onMounted(() => void load())
</script>

<template>
  <div>
    <div>
      <h1 class="text-2xl font-semibold tracking-tight text-slate-900">Patrocínio dos grupos</h1>
      <p class="mt-1 text-sm text-slate-600">
        Grupos que cadastraram patrocinadores e campanhas locais. O conteúdo é do Mestre de cada grupo: aqui a plataforma só acompanha, suspende campanhas e bloqueia o uso.
      </p>
    </div>

    <SponsorsTabs class="mt-6" />

    <div class="max-w-md">
      <label for="group-search" class="mb-1 block text-sm font-medium text-slate-800">Buscar grupo</label>
      <input
        id="group-search"
        v-model="search"
        type="search"
        autocomplete="off"
        placeholder="Nome do grupo"
        data-testid="group-search"
        class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-600 focus:ring-2 focus:ring-slate-400"
      />
    </div>

    <p v-if="blockedCount > 0 && !isLoading" class="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-900" data-testid="blocked-summary">
      {{ blockedCount === 1 ? '1 grupo está bloqueado' : `${blockedCount} grupos estão bloqueados` }}: as campanhas dele{{ blockedCount === 1 ? '' : 's' }} não aparecem no app.
    </p>
    <p v-if="listError" role="alert" data-testid="list-error" class="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
      {{ listError }}
      <button type="button" class="ml-2 font-medium underline" data-testid="retry" @click="load">Tentar de novo</button>
    </p>

    <div class="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div class="overflow-x-auto">
        <table class="w-full min-w-[820px] text-left text-sm" data-testid="groups-table">
          <caption class="sr-only">Grupos com patrocínio local</caption>
          <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th scope="col" class="px-4 py-3 font-medium">Grupo</th>
              <th scope="col" class="px-4 py-3 text-right font-medium">Patrocinadores</th>
              <th scope="col" class="px-4 py-3 text-right font-medium">Campanhas</th>
              <th scope="col" class="px-4 py-3 text-right font-medium">No ar agora</th>
              <th scope="col" class="px-4 py-3 font-medium">Termo aceito em</th>
              <th scope="col" class="px-4 py-3 text-right font-medium">Ações</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-if="isLoading">
              <td colspan="6" class="px-4 py-8 text-center text-slate-600" data-testid="loading">Carregando…</td>
            </tr>
            <tr v-else-if="visible.length === 0 && !listError">
              <td colspan="6" class="px-4 py-8 text-center text-slate-600" data-testid="empty">
                {{ search.trim() ? 'Nenhum grupo encontrado para essa busca.' : 'Nenhum grupo cadastrou patrocinadores ou campanhas ainda.' }}
              </td>
            </tr>
            <tr v-for="group in isLoading ? [] : visible" :key="group.organizationId" :data-testid="`group-${group.organizationId}`" class="align-top hover:bg-slate-50">
              <td class="px-4 py-3">
                <span class="block font-medium text-slate-900">{{ group.name }}</span>
                <span
                  v-if="group.blocked"
                  class="mt-1 inline-flex items-center gap-1.5 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-900 ring-1 ring-inset ring-red-300"
                  data-testid="blocked-chip"
                  title="Bloqueado pela plataforma: as campanhas do grupo não aparecem no app e o Mestre não ativa outras."
                >
                  <span aria-hidden="true" class="h-1.5 w-1.5 rounded-full bg-current"></span>
                  Bloqueado
                </span>
              </td>
              <td class="px-4 py-3 text-right tabular-nums text-slate-800" data-testid="count-sponsors">{{ formatInt(group.sponsors) }}</td>
              <td class="px-4 py-3 text-right tabular-nums text-slate-800" data-testid="count-campaigns">{{ formatInt(group.campaigns) }}</td>
              <td class="px-4 py-3 text-right tabular-nums text-slate-800" data-testid="count-active">{{ formatInt(group.activeNow) }}</td>
              <td class="whitespace-nowrap px-4 py-3 text-slate-700" data-testid="terms">
                <template v-if="group.termsAcceptedAt">{{ formatDateTime(group.termsAcceptedAt) }}</template>
                <span v-else class="text-slate-600">Ainda não aceito</span>
              </td>
              <td class="whitespace-nowrap px-4 py-3 text-right">
                <RouterLink
                  :to="`/sponsors/groups/${group.organizationId}`"
                  data-action="open"
                  :aria-label="`Abrir ${group.name}`"
                  class="rounded px-2 py-1 text-sm font-medium text-slate-800 underline hover:bg-slate-100"
                >
                  Abrir
                </RouterLink>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
