<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import ReasonConfirmDialog from '@/components/sponsors/ReasonConfirmDialog.vue'
import SponsorStatusChip from '@/components/sponsors/SponsorStatusChip.vue'
import SponsorsTabs from '@/components/sponsors/SponsorsTabs.vue'
import SuspendedBadge from '@/components/sponsors/SuspendedBadge.vue'
import { useAuthStore } from '@/stores/auth'
import { formatDateTime, formatInt } from '@/utils/format'
import { blockedReasonOf, blockText, isCampaignSuspended, suspensionText, supervisionError, type GroupSponsorView, type SponsorGroupRow } from '@/utils/sponsorGroups'
import {
  approvalText,
  campaignSponsorName,
  categoryLabel,
  EFFECTIVE_STATUS_META,
  EFFECTIVE_STATUS_ORDER,
  imageSrc,
  type EffectiveStatus,
  type SponsorCampaign,
} from '@/utils/sponsors'
import { sponsorsApi } from '@/utils/sponsorsApi'

const PAGE_LIMIT = 200 // um grupo tem no máximo 10 patrocinadores e 10 campanhas (contrato do grupo §3)
const SEARCH_DEBOUNCE_MS = 300
const SUPER_ONLY_HINT = 'Somente super admin pode fazer isso.'

const route = useRoute()
const authStore = useAuthStore()
const organizationId = computed(() => Number(route.params.organizationId))
/** Levantar suspensão e bloquear/liberar grupo: só super admin PLATFORM (o servidor responde 403 ao resto). */
const isSuper = computed(() => authStore.user?.userType === 'PLATFORM' && authStore.user?.isSuperAdmin === true)

// ---------------------------------------------------------------- dados
const group = ref<SponsorGroupRow | null>(null)
const groupLoaded = ref(false)
const groupError = ref('')

const sponsors = ref<GroupSponsorView[]>([])
const sponsorsLoading = ref(false)
const sponsorsError = ref('')

const campaigns = ref<SponsorCampaign[]>([])
const campaignsLoading = ref(false)
const campaignsError = ref('')
const filters = reactive<{ effective: EffectiveStatus | ''; q: string }>({ effective: '', q: '' })

const notice = ref('')
const groupName = computed(() => group.value?.name ?? campaigns.value.find((c) => c.organization?.name)?.organization?.name ?? `Grupo #${organizationId.value}`)
const notFound = computed(() => groupLoaded.value && !groupError.value && group.value === null)

let groupSeq = 0
let sponsorsSeq = 0
let campaignsSeq = 0
let searchTimer: ReturnType<typeof setTimeout> | null = null

const inputClass =
  'mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-600 focus:ring-2 focus:ring-slate-400'

async function loadGroup(): Promise<void> {
  const seq = ++groupSeq
  groupError.value = ''
  try {
    const page = await sponsorsApi.listGroups()
    if (seq !== groupSeq) return
    group.value = page.items.find((g) => g.organizationId === organizationId.value) ?? null
    groupLoaded.value = true
  } catch (e) {
    if (seq !== groupSeq) return
    groupError.value = supervisionError(e, 'Não foi possível carregar os dados do grupo.')
  }
}

async function loadSponsors(): Promise<void> {
  const seq = ++sponsorsSeq
  sponsorsLoading.value = true
  sponsorsError.value = ''
  try {
    const page = await sponsorsApi.listGroupSponsors(organizationId.value, { limit: PAGE_LIMIT })
    if (seq !== sponsorsSeq) return
    // Só nome e logo: contato, documento e observações são privados do Mestre e ficam de fora mesmo que venham.
    sponsors.value = page.items.map((s) => ({ id: s.id, name: s.name, logo: s.logo ?? null }))
  } catch (e) {
    if (seq !== sponsorsSeq) return
    sponsorsError.value = supervisionError(e, 'Não foi possível carregar os patrocinadores do grupo.')
  } finally {
    if (seq === sponsorsSeq) sponsorsLoading.value = false
  }
}

async function loadCampaigns(): Promise<void> {
  const seq = ++campaignsSeq
  campaignsLoading.value = true
  campaignsError.value = ''
  try {
    const page = await sponsorsApi.listGroupCampaigns(organizationId.value, { q: filters.q.trim(), effective: filters.effective, limit: PAGE_LIMIT })
    if (seq !== campaignsSeq) return
    campaigns.value = page.items
  } catch (e) {
    if (seq !== campaignsSeq) return
    campaignsError.value = supervisionError(e, 'Não foi possível carregar as campanhas do grupo.')
  } finally {
    if (seq === campaignsSeq) campaignsLoading.value = false
  }
}

function reloadAll(): Promise<unknown> {
  return Promise.all([loadGroup(), loadSponsors(), loadCampaigns()])
}

function applyFilters(): void {
  void loadCampaigns()
}

function onSearchInput(): void {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(applyFilters, SEARCH_DEBOUNCE_MS)
}

function clearFilters(): void {
  filters.effective = ''
  filters.q = ''
  applyFilters()
}

const hasFilters = computed(() => filters.effective !== '' || filters.q.trim() !== '')

// ---------------------------------------------------------------- ações
type DialogKind = 'suspend' | 'unsuspend' | 'block' | 'unblock'
const dialog = ref<{ kind: DialogKind; campaign?: SponsorCampaign } | null>(null)
const dialogError = ref('')
const isActing = ref(false)

function openDialog(kind: DialogKind, campaign?: SponsorCampaign): void {
  if ((kind === 'unsuspend' || kind === 'block' || kind === 'unblock') && !isSuper.value) return
  notice.value = ''
  dialog.value = { kind, campaign }
  dialogError.value = ''
}

function closeDialog(): void {
  if (isActing.value) return
  dialog.value = null
}

async function run(done: string, call: () => Promise<unknown>): Promise<void> {
  if (isActing.value) return
  isActing.value = true
  dialogError.value = ''
  try {
    await call()
    dialog.value = null
    notice.value = done
    await reloadAll()
  } catch (e) {
    dialogError.value = supervisionError(e, 'Não foi possível concluir a ação. Tente de novo.')
  } finally {
    isActing.value = false
  }
}

function confirmSuspend(reason: string): Promise<void> {
  const c = dialog.value?.campaign
  if (!c) return Promise.resolve()
  return run(`Campanha "${c.title}" suspensa. Ela saiu do ar e o Mestre não consegue retomar.`, () => sponsorsApi.suspendCampaign(c.id, reason))
}

function confirmUnsuspend(): Promise<void> {
  const c = dialog.value?.campaign
  if (!c) return Promise.resolve()
  return run(`Suspensão da campanha "${c.title}" levantada. Ela volta como pausada: o Mestre decide se retoma.`, () => sponsorsApi.unsuspendCampaign(c.id))
}

function confirmBlock(reason: string): Promise<void> {
  return run(`Grupo "${groupName.value}" bloqueado.`, () => sponsorsApi.blockGroup(organizationId.value, reason))
}

function confirmUnblock(): Promise<void> {
  return run(`Grupo "${groupName.value}" liberado.`, () => sponsorsApi.unblockGroup(organizationId.value))
}

const target = computed(() => dialog.value?.campaign ?? null)

function isHttps(url: string): boolean {
  return /^https:\/\//i.test(url)
}

onMounted(() => void reloadAll())
onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
})
</script>

<template>
  <div>
    <RouterLink to="/sponsors/groups" class="text-sm font-medium text-slate-700 underline hover:text-slate-900" data-testid="back">← Voltar para os grupos</RouterLink>
    <div class="mt-2 flex flex-wrap items-center gap-3">
      <h1 class="text-2xl font-semibold tracking-tight text-slate-900" data-testid="group-title">{{ groupName }}</h1>
      <span
        v-if="group?.blocked"
        class="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-900 ring-1 ring-inset ring-red-300"
        data-testid="blocked-chip"
      >
        <span aria-hidden="true" class="h-1.5 w-1.5 rounded-full bg-current"></span>
        Bloqueado
      </span>
    </div>
    <p class="mt-1 text-sm text-slate-600">Somente leitura: o conteúdo é do Mestre do grupo. A plataforma pode suspender campanhas e bloquear o uso do patrocínio local.</p>

    <SponsorsTabs class="mt-6" />

    <p v-if="notice" role="status" data-testid="notice" class="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900">{{ notice }}</p>
    <p v-if="!isSuper" data-testid="readonly-note" class="mb-4 rounded-md border border-slate-200 bg-slate-100 px-4 py-2 text-sm text-slate-800">
      Você pode ver e suspender campanhas. Levantar suspensão e bloquear ou liberar o grupo é só do super admin.
    </p>

    <!-- Resumo do grupo + bloqueio -->
    <section class="rounded-xl border border-slate-200 bg-white p-4" aria-labelledby="group-summary-title">
      <h2 id="group-summary-title" class="text-base font-semibold text-slate-900">Situação do grupo</h2>
      <p v-if="groupError" role="alert" data-testid="group-error" class="mt-3 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
        {{ groupError }}
        <button type="button" class="ml-2 font-medium underline" data-testid="group-retry" @click="loadGroup">Tentar de novo</button>
      </p>
      <p v-else-if="!groupLoaded" class="mt-3 text-sm text-slate-600" data-testid="group-loading">Carregando…</p>
      <p v-else-if="notFound" class="mt-3 text-sm text-slate-700" data-testid="group-not-found">
        Este grupo não aparece entre os que têm patrocínio local (ainda não cadastrou patrocinadores nem campanhas).
      </p>
      <template v-else-if="group">
        <dl class="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt class="text-xs text-slate-600">Patrocinadores</dt>
            <dd class="text-xl font-semibold tabular-nums text-slate-900" data-testid="sum-sponsors">{{ formatInt(group.sponsors) }}</dd>
          </div>
          <div>
            <dt class="text-xs text-slate-600">Campanhas</dt>
            <dd class="text-xl font-semibold tabular-nums text-slate-900" data-testid="sum-campaigns">{{ formatInt(group.campaigns) }}</dd>
          </div>
          <div>
            <dt class="text-xs text-slate-600">No ar agora</dt>
            <dd class="text-xl font-semibold tabular-nums text-slate-900" data-testid="sum-active">{{ formatInt(group.activeNow) }}</dd>
          </div>
          <div>
            <dt class="text-xs text-slate-600">Termo de responsabilidade aceito em</dt>
            <dd class="text-sm font-medium text-slate-900" data-testid="sum-terms">{{ group.termsAcceptedAt ? formatDateTime(group.termsAcceptedAt) : 'Ainda não aceito' }}</dd>
          </div>
        </dl>

        <div v-if="group.blocked" class="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900" data-testid="block-info">
          <p class="font-semibold" data-testid="block-who">{{ blockText(group, formatDateTime) }}</p>
          <p v-if="blockedReasonOf(group)" data-testid="block-reason">Motivo: {{ blockedReasonOf(group) }}</p>
          <p class="mt-1">As campanhas do grupo não aparecem no app e o Mestre não consegue ativar outras.</p>
        </div>

        <div class="mt-4 flex flex-wrap gap-2">
          <button
            v-if="!group.blocked"
            type="button"
            data-action="block"
            :disabled="!isSuper || isActing"
            :title="isSuper ? undefined : SUPER_ONLY_HINT"
            class="rounded-md border border-red-700 px-4 py-2 text-sm font-medium text-red-800 hover:bg-red-50 disabled:cursor-not-allowed disabled:border-slate-300 disabled:text-slate-500 disabled:hover:bg-transparent"
            @click="openDialog('block')"
          >
            Bloquear grupo
          </button>
          <button
            v-else
            type="button"
            data-action="unblock"
            :disabled="!isSuper || isActing"
            :title="isSuper ? undefined : SUPER_ONLY_HINT"
            class="rounded-md border border-emerald-700 px-4 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:border-slate-300 disabled:text-slate-500 disabled:hover:bg-transparent"
            @click="openDialog('unblock')"
          >
            Liberar grupo
          </button>
        </div>
      </template>
    </section>

    <!-- Patrocinadores (só leitura) -->
    <section class="mt-8" aria-labelledby="group-sponsors-title">
      <h2 id="group-sponsors-title" class="text-lg font-semibold text-slate-900">Patrocinadores do grupo</h2>
      <p class="mt-1 text-sm text-slate-600">Contato, documento e observações são privados do Mestre e não aparecem aqui.</p>
      <p v-if="sponsorsError" role="alert" data-testid="sponsors-error" class="mt-3 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
        {{ sponsorsError }}
        <button type="button" class="ml-2 font-medium underline" data-testid="sponsors-retry" @click="loadSponsors">Tentar de novo</button>
      </p>
      <p v-else-if="sponsorsLoading" class="mt-3 text-sm text-slate-600" data-testid="sponsors-loading">Carregando…</p>
      <p v-else-if="sponsors.length === 0" class="mt-3 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-600" data-testid="sponsors-empty">
        Este grupo ainda não cadastrou patrocinadores.
      </p>
      <ul v-else class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="sponsors-list">
        <li v-for="s in sponsors" :key="s.id" :data-testid="`sponsor-${s.id}`" class="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
          <img v-if="s.logo" :src="imageSrc(s.logo)" :alt="`Logo de ${s.name}`" class="h-10 w-10 shrink-0 rounded-md border border-slate-200 bg-white object-contain" />
          <span v-else aria-hidden="true" class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-slate-100 text-xs font-semibold text-slate-600">{{ s.name.slice(0, 2).toUpperCase() }}</span>
          <span class="font-medium text-slate-900">{{ s.name }}</span>
        </li>
      </ul>
    </section>

    <!-- Campanhas (só leitura + suspender/levantar) -->
    <section class="mt-8" aria-labelledby="group-campaigns-title">
      <h2 id="group-campaigns-title" class="text-lg font-semibold text-slate-900">Campanhas do grupo</h2>

      <form class="mt-3 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-3" data-testid="campaign-filters" @submit.prevent="applyFilters">
        <div>
          <label for="gf-effective" class="block text-sm font-medium text-slate-800">Situação</label>
          <select id="gf-effective" v-model="filters.effective" data-testid="filter-effective" :class="inputClass" @change="applyFilters">
            <option value="">Todas</option>
            <option v-for="status in EFFECTIVE_STATUS_ORDER" :key="status" :value="status">{{ EFFECTIVE_STATUS_META[status].label }}</option>
          </select>
        </div>
        <div>
          <label for="gf-q" class="block text-sm font-medium text-slate-800">Buscar</label>
          <input id="gf-q" v-model="filters.q" type="search" autocomplete="off" placeholder="Título ou texto" data-testid="filter-q" :class="inputClass" @input="onSearchInput" />
        </div>
        <div class="flex items-end">
          <button type="button" data-testid="filter-clear" class="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100" @click="clearFilters">Limpar filtros</button>
        </div>
      </form>

      <p v-if="campaignsError" role="alert" data-testid="campaigns-error" class="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
        {{ campaignsError }}
        <button type="button" class="ml-2 font-medium underline" data-testid="campaigns-retry" @click="loadCampaigns">Tentar de novo</button>
      </p>

      <div class="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div class="overflow-x-auto">
          <table class="w-full min-w-[960px] text-left text-sm" data-testid="campaigns-table">
            <caption class="sr-only">Campanhas do grupo</caption>
            <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th scope="col" class="px-4 py-3 font-medium">Campanha</th>
                <th scope="col" class="px-4 py-3 font-medium">Situação</th>
                <th scope="col" class="px-4 py-3 font-medium">Vigência</th>
                <th scope="col" class="px-4 py-3 font-medium">Destino</th>
                <th scope="col" class="px-4 py-3 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              <tr v-if="campaignsLoading">
                <td colspan="5" class="px-4 py-8 text-center text-slate-600" data-testid="campaigns-loading">Carregando…</td>
              </tr>
              <tr v-else-if="campaigns.length === 0 && !campaignsError">
                <td colspan="5" class="px-4 py-8 text-center text-slate-600" data-testid="campaigns-empty">
                  {{ hasFilters ? 'Nenhuma campanha encontrada com esses filtros.' : 'Este grupo ainda não criou campanhas.' }}
                </td>
              </tr>
              <tr v-for="c in campaignsLoading ? [] : campaigns" :key="c.id" :data-testid="`campaign-${c.id}`" class="align-top hover:bg-slate-50">
                <td class="px-4 py-3">
                  <div class="flex gap-3">
                    <img v-if="c.imageRef" :src="imageSrc(c.imageRef)" :alt="`Imagem da campanha ${c.title}`" class="h-12 w-20 shrink-0 rounded-md border border-slate-200 bg-slate-100 object-cover" data-testid="campaign-image" />
                    <div class="min-w-0">
                      <span class="block font-medium text-slate-900" data-testid="campaign-title">{{ c.title }}</span>
                      <span class="block text-slate-700" data-testid="campaign-text">{{ c.text }}</span>
                      <span class="block text-xs text-slate-600">{{ campaignSponsorName(c) }} · {{ categoryLabel(c.category) }}</span>
                      <span v-if="approvalText(c, formatDateTime)" class="mt-1 block text-xs text-slate-600" data-testid="approval">
                        {{ approvalText(c, formatDateTime).replace('Aprovada por', 'Ativada por') }}
                      </span>
                    </div>
                  </div>
                </td>
                <td class="px-4 py-3">
                  <div class="flex flex-col items-start gap-1">
                    <SponsorStatusChip :status="c.effectiveStatus" />
                    <SuspendedBadge v-if="isCampaignSuspended(c)" :reason="c.platformSuspendReason" />
                  </div>
                  <div v-if="isCampaignSuspended(c)" class="mt-2 max-w-[14rem] text-xs text-red-900" data-testid="suspension-info">
                    <span class="block" data-testid="suspension-who">{{ suspensionText(c, formatDateTime) }}</span>
                    <span v-if="c.platformSuspendReason" class="block" data-testid="suspension-reason">Motivo: {{ c.platformSuspendReason }}</span>
                  </div>
                </td>
                <td class="whitespace-nowrap px-4 py-3 text-slate-700">
                  {{ formatDateTime(c.startsAt) }}<br />
                  <span class="text-xs text-slate-600">até {{ formatDateTime(c.endsAt) }}</span>
                </td>
                <td class="max-w-[16rem] px-4 py-3 text-xs">
                  <a v-if="isHttps(c.destinationUrl)" :href="c.destinationUrl" target="_blank" rel="noopener noreferrer nofollow" class="break-all text-slate-800 underline" data-testid="campaign-url">{{ c.destinationUrl }}</a>
                  <span v-else class="break-all text-slate-800" data-testid="campaign-url">{{ c.destinationUrl }}</span>
                </td>
                <td class="px-4 py-3 text-right">
                  <div class="flex flex-wrap justify-end gap-x-1 gap-y-1">
                    <RouterLink
                      :to="{ path: `/sponsors/campaigns/${c.id}/report`, query: { group: String(organizationId) } }"
                      data-action="report"
                      class="rounded px-2 py-1 text-sm font-medium text-slate-800 underline hover:bg-slate-100"
                    >
                      Relatório
                    </RouterLink>
                    <button
                      v-if="!isCampaignSuspended(c)"
                      type="button"
                      data-action="suspend"
                      :disabled="isActing"
                      class="rounded px-2 py-1 text-sm font-medium text-red-700 underline hover:bg-red-50 disabled:opacity-60"
                      @click="openDialog('suspend', c)"
                    >
                      Suspender
                    </button>
                    <button
                      v-else
                      type="button"
                      data-action="unsuspend"
                      :disabled="!isSuper || isActing"
                      :title="isSuper ? undefined : SUPER_ONLY_HINT"
                      class="rounded px-2 py-1 text-sm font-medium text-emerald-800 underline hover:bg-emerald-50 disabled:cursor-not-allowed disabled:text-slate-500 disabled:no-underline disabled:hover:bg-transparent"
                      @click="openDialog('unsuspend', c)"
                    >
                      Levantar suspensão
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- Suspender: motivo obrigatório -->
    <ReasonConfirmDialog
      :open="dialog?.kind === 'suspend'"
      title="Suspender esta campanha?"
      confirm-label="Suspender campanha"
      :busy="isActing"
      :error="dialog?.kind === 'suspend' ? dialogError : ''"
      @cancel="closeDialog"
      @confirm="confirmSuspend"
    >
      <p v-if="target">
        <strong>{{ target.title }}</strong> — {{ campaignSponsorName(target) }}
      </p>
      <p>A campanha para de aparecer no app na hora e o Mestre do grupo não consegue retomá-la. Só um super admin pode levantar a suspensão.</p>
    </ReasonConfirmDialog>

    <!-- Levantar suspensão -->
    <ConfirmDialog
      :open="dialog?.kind === 'unsuspend'"
      title="Levantar a suspensão?"
      confirm-label="Levantar suspensão"
      :busy="isActing"
      :confirm-disabled="!isSuper"
      :error="dialog?.kind === 'unsuspend' ? dialogError : ''"
      @cancel="closeDialog"
      @confirm="confirmUnsuspend"
    >
      <template v-if="target">
        <p>
          <strong>{{ target.title }}</strong> — {{ campaignSponsorName(target) }}
        </p>
        <p v-if="target.platformSuspendReason" data-testid="unsuspend-reason">Motivo da suspensão: {{ target.platformSuspendReason }}</p>
        <p>A campanha volta como <strong>pausada</strong>: o Mestre decide se retoma. Ela não volta ao ar sozinha.</p>
      </template>
    </ConfirmDialog>

    <!-- Bloquear grupo: motivo obrigatório -->
    <ReasonConfirmDialog
      :open="dialog?.kind === 'block'"
      title="Bloquear o patrocínio deste grupo?"
      confirm-label="Bloquear grupo"
      :busy="isActing"
      :error="dialog?.kind === 'block' ? dialogError : ''"
      @cancel="closeDialog"
      @confirm="confirmBlock"
    >
      <p>
        Todas as campanhas de <strong>{{ groupName }}</strong> param de aparecer no app e o Mestre não consegue ativar outras até você liberar o grupo.
      </p>
    </ReasonConfirmDialog>

    <!-- Liberar grupo -->
    <ConfirmDialog
      :open="dialog?.kind === 'unblock'"
      title="Liberar o patrocínio deste grupo?"
      confirm-label="Liberar grupo"
      :busy="isActing"
      :confirm-disabled="!isSuper"
      :error="dialog?.kind === 'unblock' ? dialogError : ''"
      @cancel="closeDialog"
      @confirm="confirmUnblock"
    >
      <p>
        O Mestre de <strong>{{ groupName }}</strong> volta a poder ativar campanhas. As que estiverem ativas e dentro da vigência voltam a aparecer no app, exceto as suspensas.
      </p>
      <p v-if="group && blockedReasonOf(group)" data-testid="unblock-reason">Motivo do bloqueio: {{ blockedReasonOf(group) }}</p>
    </ConfirmDialog>
  </div>
</template>
