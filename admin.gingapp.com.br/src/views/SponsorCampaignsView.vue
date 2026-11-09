<script setup lang="ts">
import PageHeader from '@/components/ui/PageHeader.vue'
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import PaginationBar from '@/components/PaginationBar.vue'
import SponsorSlidePreview from '@/components/sponsors/SponsorSlidePreview.vue'
import SponsorStatusChip from '@/components/sponsors/SponsorStatusChip.vue'
import SponsorsTabs from '@/components/sponsors/SponsorsTabs.vue'
import { useAuthStore } from '@/stores/auth'
import { errorMessage } from '@/utils/api'
import { takeFlash } from '@/utils/flash'
import { formatDateTime } from '@/utils/format'
import {
  approvalText,
  campaignSponsorName,
  categoryLabel,
  EFFECTIVE_STATUS_META,
  EFFECTIVE_STATUS_ORDER,
  statesLabel,
  type EffectiveStatus,
  type Sponsor,
  type SponsorCampaign,
} from '@/utils/sponsors'
import { sponsorsApi } from '@/utils/sponsorsApi'

const PAGE_SIZE = 20
const SEARCH_DEBOUNCE_MS = 300

const authStore = useAuthStore()
/** Só super admin ativa (o servidor responde 403 ao resto); pausar/retomar/editar/excluir qualquer PLATFORM faz. */
const canActivate = computed(() => authStore.user?.userType === 'PLATFORM' && authStore.user?.isSuperAdmin === true)

const campaigns = ref<SponsorCampaign[]>([])
const sponsors = ref<Sponsor[]>([])
const total = ref(0)
const offset = ref(0)
const isLoading = ref(false)
const listError = ref('')
const notice = ref(takeFlash())
const filters = reactive<{ effective: EffectiveStatus | ''; sponsorId: string; q: string }>({ effective: '', sponsorId: '', q: '' })

let requestSeq = 0
let searchTimer: ReturnType<typeof setTimeout> | null = null

const inputClass =
  'mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-600 focus:ring-2 focus:ring-slate-400'

async function load(): Promise<void> {
  const seq = ++requestSeq
  isLoading.value = true
  listError.value = ''
  try {
    const page = await sponsorsApi.listCampaigns({
      q: filters.q.trim(),
      effective: filters.effective,
      sponsorId: filters.sponsorId,
      limit: PAGE_SIZE,
      offset: offset.value,
    })
    if (seq !== requestSeq) return
    campaigns.value = page.items
    total.value = page.total
  } catch (e) {
    if (seq !== requestSeq) return
    listError.value = errorMessage(e, 'Não foi possível carregar as campanhas.')
  } finally {
    if (seq === requestSeq) isLoading.value = false
  }
}

function applyFilters(): void {
  offset.value = 0
  void load()
}

function clearFilters(): void {
  filters.effective = ''
  filters.sponsorId = ''
  filters.q = ''
  applyFilters()
}

function onSearchInput(): void {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(applyFilters, SEARCH_DEBOUNCE_MS)
}

function changeOffset(value: number): void {
  offset.value = value
  void load()
}

function sponsorName(c: SponsorCampaign): string {
  return campaignSponsorName(c, sponsors.value)
}

function sponsorLogo(c: SponsorCampaign): string {
  return c.sponsor?.logo ?? sponsors.value.find((s) => s.id === c.sponsorId)?.logo ?? ''
}

// ---------------------------------------------------------------- ações

type ActionKind = 'activate' | 'delete'
const dialog = ref<{ kind: ActionKind; campaign: SponsorCampaign } | null>(null)
const dialogError = ref('')
const isActing = ref(false)
const actingId = ref<number | null>(null)

function openDialog(kind: ActionKind, campaign: SponsorCampaign): void {
  dialog.value = { kind, campaign }
  dialogError.value = ''
}

function closeDialog(): void {
  if (isActing.value) return
  dialog.value = null
}

async function runAction(label: string, campaign: SponsorCampaign, call: () => Promise<unknown>): Promise<boolean> {
  isActing.value = true
  actingId.value = campaign.id
  try {
    await call()
    notice.value = `Campanha "${campaign.title}" ${label}.`
    await load()
    return true
  } catch (e) {
    const message = errorMessage(e, 'Não foi possível concluir a ação.')
    if (dialog.value) dialogError.value = message
    else listError.value = message
    return false
  } finally {
    isActing.value = false
    actingId.value = null
  }
}

async function confirmDialog(): Promise<void> {
  const current = dialog.value
  if (!current || isActing.value) return
  const ok =
    current.kind === 'activate'
      ? await runAction('ativada e registrada como aprovada por você', current.campaign, () => sponsorsApi.activateCampaign(current.campaign.id))
      : await runAction('excluída', current.campaign, () => sponsorsApi.deleteCampaign(current.campaign.id))
  if (ok) dialog.value = null
}

function pause(campaign: SponsorCampaign): Promise<boolean> {
  notice.value = ''
  return runAction('pausada', campaign, () => sponsorsApi.pauseCampaign(campaign.id))
}

function resume(campaign: SponsorCampaign): Promise<boolean> {
  notice.value = ''
  return runAction('retomada', campaign, () => sponsorsApi.resumeCampaign(campaign.id))
}

const activateTarget = computed(() => (dialog.value?.kind === 'activate' ? dialog.value.campaign : null))
const myName = computed(() => authStore.user?.name ?? 'você')

onMounted(async () => {
  void load()
  try {
    sponsors.value = (await sponsorsApi.listSponsors({ limit: 200 })).items
  } catch {
    // O filtro por patrocinador é opcional: sem a lista, a tela continua funcionando.
  }
})
onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
})
</script>

<template>
  <div>
    <PageHeader
      title="Campanhas"
      description="Anúncios “Patrocinado” do carrossel da Home. Só vai ao ar o que um super admin ativar."
    >
      <RouterLink to="/sponsors/campaigns/new" data-testid="new-campaign" class="btn btn-primary">
        + Nova campanha
      </RouterLink>
    </PageHeader>

    <SponsorsTabs class="mt-6" />

    <form class="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="campaign-filters" @submit.prevent="applyFilters">
      <div>
        <label for="f-effective" class="block text-sm font-medium text-slate-800">Situação</label>
        <select id="f-effective" v-model="filters.effective" data-testid="filter-effective" :class="inputClass" @change="applyFilters">
          <option value="">Todas</option>
          <option v-for="status in EFFECTIVE_STATUS_ORDER" :key="status" :value="status">{{ EFFECTIVE_STATUS_META[status].label }}</option>
        </select>
      </div>
      <div>
        <label for="f-sponsor" class="block text-sm font-medium text-slate-800">Patrocinador</label>
        <select id="f-sponsor" v-model="filters.sponsorId" data-testid="filter-sponsor" :class="inputClass" @change="applyFilters">
          <option value="">Todos</option>
          <option v-for="sponsor in sponsors" :key="sponsor.id" :value="String(sponsor.id)">{{ sponsor.name }}</option>
        </select>
      </div>
      <div class="sm:col-span-2 lg:col-span-1">
        <label for="f-q" class="block text-sm font-medium text-slate-800">Buscar</label>
        <input id="f-q" v-model="filters.q" type="search" placeholder="Título ou texto" data-testid="filter-q" :class="inputClass" @input="onSearchInput" />
      </div>
      <div class="flex items-end">
        <button type="button" data-testid="filter-clear" class="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100" @click="clearFilters">Limpar filtros</button>
      </div>
    </form>

    <p v-if="notice" role="status" data-testid="notice" class="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900">{{ notice }}</p>
    <p v-if="!canActivate" data-testid="readonly-note" class="mt-4 rounded-md border border-slate-200 bg-slate-100 px-4 py-2 text-sm text-slate-800">
      Somente super admins podem ativar campanhas. Você pode criar, editar, pausar, retomar e ver relatórios.
    </p>
    <p v-if="listError" role="alert" data-testid="list-error" class="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
      {{ listError }}
      <button type="button" class="ml-2 font-medium underline" data-testid="retry" @click="load">Tentar de novo</button>
    </p>

    <div class="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div class="overflow-x-auto">
        <table class="w-full min-w-[1000px] text-left text-sm" data-testid="campaigns-table">
          <caption class="sr-only">Lista de campanhas</caption>
          <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th scope="col" class="px-4 py-3 font-medium">Campanha</th>
              <th scope="col" class="px-4 py-3 font-medium">Situação</th>
              <th scope="col" class="px-4 py-3 font-medium">Vigência</th>
              <th scope="col" class="px-4 py-3 font-medium">Regiões</th>
              <th scope="col" class="px-4 py-3 font-medium">Peso</th>
              <th scope="col" class="px-4 py-3 text-right font-medium">Ações</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-if="isLoading">
              <td colspan="6" class="px-4 py-8 text-center text-slate-600" data-testid="loading">Carregando…</td>
            </tr>
            <tr v-else-if="campaigns.length === 0 && !listError">
              <td colspan="6" class="px-4 py-8 text-center text-slate-600" data-testid="empty">
                {{ filters.q.trim() || filters.effective || filters.sponsorId ? 'Nenhuma campanha encontrada com esses filtros.' : 'Nenhuma campanha criada ainda.' }}
              </td>
            </tr>
            <tr v-for="campaign in isLoading ? [] : campaigns" :key="campaign.id" :data-testid="`campaign-${campaign.id}`" class="align-top hover:bg-slate-50">
              <td class="px-4 py-3">
                <span class="block font-medium text-slate-900">{{ campaign.title }}</span>
                <span class="block text-xs text-slate-600">{{ sponsorName(campaign) }} · {{ categoryLabel(campaign.category) }}</span>
                <span v-if="approvalText(campaign, formatDateTime)" class="mt-1 block text-xs text-slate-600" data-testid="approval">{{ approvalText(campaign, formatDateTime) }}</span>
              </td>
              <td class="px-4 py-3"><SponsorStatusChip :status="campaign.effectiveStatus" /></td>
              <td class="whitespace-nowrap px-4 py-3 text-slate-700">
                {{ formatDateTime(campaign.startsAt) }}<br />
                <span class="text-xs text-slate-600">até {{ formatDateTime(campaign.endsAt) }}</span>
              </td>
              <td class="max-w-[10rem] px-4 py-3 text-slate-700">{{ statesLabel(campaign.states) }}</td>
              <td class="px-4 py-3 text-slate-700">{{ campaign.weight }}</td>
              <td class="px-4 py-3 text-right">
                <div class="flex flex-wrap justify-end gap-x-1 gap-y-1">
                  <RouterLink :to="`/sponsors/campaigns/${campaign.id}/report`" data-action="report" class="rounded px-2 py-1 text-sm font-medium text-slate-800 underline hover:bg-slate-100">Relatório</RouterLink>
                  <RouterLink :to="`/sponsors/campaigns/${campaign.id}/edit`" data-action="edit" class="rounded px-2 py-1 text-sm font-medium text-slate-800 underline hover:bg-slate-100">Editar</RouterLink>
                  <template v-if="campaign.status === 'DRAFT'">
                    <button
                      type="button"
                      data-action="activate"
                      :disabled="!canActivate || isActing"
                      :title="canActivate ? undefined : 'Somente super admin pode ativar campanhas.'"
                      class="rounded px-2 py-1 text-sm font-medium text-emerald-800 underline hover:bg-emerald-50 disabled:cursor-not-allowed disabled:text-slate-500 disabled:no-underline disabled:hover:bg-transparent"
                      @click="openDialog('activate', campaign)"
                    >
                      Ativar
                    </button>
                  </template>
                  <button v-else-if="campaign.status === 'ACTIVE'" type="button" data-action="pause" :disabled="isActing" class="rounded px-2 py-1 text-sm font-medium text-amber-900 underline hover:bg-amber-50 disabled:opacity-60" @click="pause(campaign)">
                    {{ actingId === campaign.id ? 'Aguarde…' : 'Pausar' }}
                  </button>
                  <button v-else-if="campaign.status === 'PAUSED'" type="button" data-action="resume" :disabled="isActing" class="rounded px-2 py-1 text-sm font-medium text-emerald-800 underline hover:bg-emerald-50 disabled:opacity-60" @click="resume(campaign)">
                    {{ actingId === campaign.id ? 'Aguarde…' : 'Retomar' }}
                  </button>
                  <button type="button" data-action="delete" :disabled="isActing" class="rounded px-2 py-1 text-sm font-medium text-red-700 underline hover:bg-red-50 disabled:opacity-60" @click="openDialog('delete', campaign)">Excluir</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <PaginationBar :total="total" :offset="offset" :limit="PAGE_SIZE" :disabled="isLoading" @update:offset="changeOffset" />
    </div>

    <!-- Ativar: mostra o que vai ao ar -->
    <ConfirmDialog
      :open="activateTarget !== null"
      title="Colocar esta campanha no ar?"
      confirm-label="Ativar campanha"
      :busy="isActing"
      :confirm-disabled="!canActivate"
      :error="dialogError"
      @cancel="closeDialog"
      @confirm="confirmDialog"
    >
      <template v-if="activateTarget">
        <p data-testid="activate-summary">
          <strong>{{ activateTarget.title }}</strong> — {{ sponsorName(activateTarget) }}
        </p>
        <SponsorSlidePreview
          :title="activateTarget.title"
          :text="activateTarget.text"
          :cta-label="activateTarget.ctaLabel"
          :image-ref="activateTarget.imageRef ?? ''"
          :logo-ref="sponsorLogo(activateTarget)"
          :sponsor-name="sponsorName(activateTarget)"
        />
        <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-slate-700">
          <dt class="font-semibold">Link de destino</dt>
          <dd class="break-all" data-testid="activate-url">{{ activateTarget.destinationUrl }}</dd>
          <dt class="font-semibold">Vigência</dt>
          <dd>{{ formatDateTime(activateTarget.startsAt) }} até {{ formatDateTime(activateTarget.endsAt) }}</dd>
          <dt class="font-semibold">Regiões</dt>
          <dd>{{ statesLabel(activateTarget.states) }}</dd>
          <dt class="font-semibold">Categoria</dt>
          <dd>{{ categoryLabel(activateTarget.category) }}</dd>
        </dl>
        <p class="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900" data-testid="activate-approval-note">
          Ao ativar, a campanha fica registrada como <strong>aprovada por {{ myName }}</strong> (data e hora de agora). Ela só aparece no app dentro da vigência, para maiores de 18 anos.
        </p>
      </template>
    </ConfirmDialog>

    <!-- Excluir -->
    <ConfirmDialog
      :open="dialog?.kind === 'delete'"
      title="Excluir campanha?"
      confirm-label="Excluir"
      danger
      :busy="isActing"
      :error="dialogError"
      @cancel="closeDialog"
      @confirm="confirmDialog"
    >
      <template v-if="dialog?.kind === 'delete'">
        <p>
          Você vai excluir <strong>{{ dialog.campaign.title }}</strong
          >. Os números de impressões e cliques dela também serão apagados. Essa ação não pode ser desfeita.
        </p>
        <p v-if="dialog.campaign.effectiveStatus === 'ACTIVE_NOW'" class="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900" data-testid="delete-live-warning">
          Esta campanha está no ar agora e será retirada do app imediatamente.
        </p>
      </template>
    </ConfirmDialog>
  </div>
</template>
