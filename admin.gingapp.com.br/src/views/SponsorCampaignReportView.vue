<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import BarChart from '@/components/sponsors/BarChart.vue'
import SponsorStatusChip from '@/components/sponsors/SponsorStatusChip.vue'
import { errorMessage } from '@/utils/api'
import { formatDateTime, formatInt } from '@/utils/format'
import {
  addDays,
  campaignSponsorName,
  computeCtr,
  defaultReportRange,
  fillDays,
  formatPercent,
  longDay,
  saveBlob,
  shortDay,
  spDay,
  stateReportLabel,
  type CampaignReport,
  type SponsorCampaign,
} from '@/utils/sponsors'
import { sponsorsApi } from '@/utils/sponsorsApi'

const route = useRoute()
const campaignId = computed(() => Number(route.params.id))

const campaign = ref<SponsorCampaign | null>(null)
const report = ref<CampaignReport | null>(null)
const range = reactive({ from: '', to: '' })
/** Período efetivamente carregado (os campos de data podem estar em edição). */
const loadedRange = ref<{ from: string; to: string } | null>(null)

const isLoading = ref(true)
const loadError = ref('')
const rangeError = ref('')
const isExporting = ref(false)
const exportError = ref('')
let seq = 0

const inputClass = 'mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-600 focus:ring-2 focus:ring-slate-400'

const hasData = computed(() => (report.value?.totals.impressions ?? 0) > 0 || (report.value?.totals.clicks ?? 0) > 0)

const days = computed(() => {
  if (!report.value || !loadedRange.value) return []
  return fillDays(report.value.byDay, loadedRange.value.from, loadedRange.value.to)
})
const impressionPoints = computed(() => days.value.map((d) => ({ label: shortDay(d.day), value: d.impressions })))
const clickPoints = computed(() => days.value.map((d) => ({ label: shortDay(d.day), value: d.clicks })))

const states = computed(() =>
  [...(report.value?.byState ?? [])].sort((a, b) => b.impressions - a.impressions || a.state.localeCompare(b.state)),
)

/** CTR do total: usa o do servidor (contrato: % com 2 casas); sem ele, calcula. */
const totalCtr = computed(() => {
  const t = report.value?.totals
  if (!t) return 0
  return typeof t.ctr === 'number' ? t.ctr : computeCtr(t.clicks, t.impressions)
})

function validateRange(): string {
  if (!range.from || !range.to) return 'Informe as duas datas do período.'
  if (range.from > range.to) return 'A data inicial deve ser anterior ou igual à final.'
  return ''
}

async function loadReport(): Promise<void> {
  rangeError.value = validateRange()
  if (rangeError.value) return
  const mine = ++seq
  isLoading.value = true
  loadError.value = ''
  exportError.value = ''
  try {
    const data = await sponsorsApi.getReport(campaignId.value, { from: range.from, to: range.to })
    if (mine !== seq) return
    report.value = data
    loadedRange.value = { from: range.from, to: range.to }
  } catch (e) {
    if (mine !== seq) return
    report.value = null
    loadError.value = errorMessage(e, 'Não foi possível carregar o relatório.')
  } finally {
    if (mine === seq) isLoading.value = false
  }
}

async function init(): Promise<void> {
  isLoading.value = true
  loadError.value = ''
  try {
    campaign.value = await sponsorsApi.getCampaign(campaignId.value)
    Object.assign(range, defaultReportRange(campaign.value.startsAt, campaign.value.endsAt))
  } catch (e) {
    loadError.value = errorMessage(e, 'Não foi possível carregar a campanha.')
    isLoading.value = false
    return
  }
  await loadReport()
}

function usePreset(kind: '7' | '30' | 'all'): void {
  const c = campaign.value
  if (!c) return
  if (kind === 'all') {
    const base = defaultReportRange(c.startsAt, c.endsAt)
    range.from = spDay(c.startsAt)
    range.to = base.to
  } else {
    const base = defaultReportRange(c.startsAt, c.endsAt)
    range.to = base.to
    range.from = addDays(base.to, -(Number(kind) - 1))
    if (range.from < spDay(c.startsAt)) range.from = spDay(c.startsAt)
  }
  void loadReport()
}

async function exportCsv(): Promise<void> {
  const r = loadedRange.value
  if (!r || isExporting.value) return
  isExporting.value = true
  exportError.value = ''
  try {
    const blob = await sponsorsApi.getReportCsv(campaignId.value, r)
    saveBlob(blob, `campanha-${campaignId.value}-${r.from}_a_${r.to}.csv`)
  } catch (e) {
    exportError.value = errorMessage(e, 'Não foi possível exportar o CSV.')
  } finally {
    isExporting.value = false
  }
}

onMounted(() => void init())
</script>

<template>
  <div>
    <RouterLink to="/sponsors/campaigns" class="text-sm font-medium text-slate-700 underline hover:text-slate-900" data-testid="back">← Voltar para as campanhas</RouterLink>
    <div class="mt-2 flex flex-wrap items-center gap-3">
      <h1 class="text-2xl font-semibold tracking-tight text-slate-900">Relatório da campanha</h1>
      <SponsorStatusChip v-if="campaign" :status="campaign.effectiveStatus" />
    </div>
    <p v-if="campaign" class="mt-1 text-sm text-slate-700" data-testid="report-header">
      <strong>{{ campaign.title }}</strong> · {{ campaignSponsorName(campaign) }} · {{ formatDateTime(campaign.startsAt) }} até {{ formatDateTime(campaign.endsAt) }}
    </p>

    <p class="mt-3 rounded-md border border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-950" data-testid="privacy-note">
      Os números são agregados e não identificam pessoas.
    </p>

    <form class="mt-6 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4" data-testid="range-form" @submit.prevent="loadReport">
      <div>
        <label for="rp-from" class="block text-sm font-medium text-slate-800">De</label>
        <input id="rp-from" v-model="range.from" type="date" :class="inputClass" data-testid="range-from" />
      </div>
      <div>
        <label for="rp-to" class="block text-sm font-medium text-slate-800">Até</label>
        <input id="rp-to" v-model="range.to" type="date" :class="inputClass" data-testid="range-to" />
      </div>
      <button type="submit" :disabled="isLoading || !campaign" class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60" data-testid="range-apply">Atualizar</button>
      <div class="flex flex-wrap gap-2" role="group" aria-label="Períodos prontos">
        <button type="button" :disabled="isLoading || !campaign" class="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-60" data-testid="preset-7" @click="usePreset('7')">Últimos 7 dias</button>
        <button type="button" :disabled="isLoading || !campaign" class="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-60" data-testid="preset-30" @click="usePreset('30')">Últimos 30 dias</button>
        <button type="button" :disabled="isLoading || !campaign" class="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-60" data-testid="preset-all" @click="usePreset('all')">Toda a vigência</button>
      </div>
      <button
        type="button"
        :disabled="isExporting || isLoading || !report"
        class="ml-auto rounded-md border border-slate-900 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
        data-testid="export-csv"
        @click="exportCsv"
      >
        {{ isExporting ? 'Gerando…' : 'Exportar CSV' }}
      </button>
    </form>
    <p v-if="rangeError" role="alert" class="mt-2 text-sm font-medium text-red-700" data-testid="range-error">{{ rangeError }}</p>
    <p v-if="exportError" role="alert" class="mt-2 text-sm font-medium text-red-700" data-testid="export-error">{{ exportError }}</p>

    <p v-if="isLoading" class="mt-8 text-sm text-slate-600" data-testid="loading">Carregando relatório…</p>
    <p v-else-if="loadError" role="alert" class="mt-8 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800" data-testid="load-error">
      {{ loadError }}
      <button type="button" class="ml-2 font-medium underline" data-testid="retry" @click="campaign ? loadReport() : init()">Tentar de novo</button>
    </p>

    <template v-else-if="report && loadedRange">
      <p class="mt-6 text-sm text-slate-700" data-testid="period-label">Período: {{ longDay(loadedRange.from) }} a {{ longDay(loadedRange.to) }}</p>

      <dl class="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3" data-testid="totals">
        <div class="rounded-xl border border-slate-200 bg-white p-4">
          <dt class="text-sm text-slate-700">Impressões</dt>
          <dd class="mt-1 text-3xl font-semibold tabular-nums text-slate-900" data-testid="total-impressions">{{ formatInt(report.totals.impressions) }}</dd>
        </div>
        <div class="rounded-xl border border-slate-200 bg-white p-4">
          <dt class="text-sm text-slate-700">Cliques</dt>
          <dd class="mt-1 text-3xl font-semibold tabular-nums text-slate-900" data-testid="total-clicks">{{ formatInt(report.totals.clicks) }}</dd>
        </div>
        <div class="rounded-xl border border-slate-200 bg-white p-4">
          <dt class="text-sm text-slate-700">CTR (cliques ÷ impressões)</dt>
          <dd class="mt-1 text-3xl font-semibold tabular-nums text-slate-900" data-testid="total-ctr">{{ formatPercent(totalCtr) }}</dd>
        </div>
      </dl>

      <p v-if="!hasData" class="mt-6 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-700" data-testid="empty">
        Ainda não há impressões nem cliques neste período.
      </p>

      <template v-else>
        <section class="mt-8 space-y-6 rounded-xl border border-slate-200 bg-white p-4" aria-labelledby="by-day-title">
          <h2 id="by-day-title" class="text-base font-semibold text-slate-900">Por dia</h2>
          <BarChart title="Impressões por dia" :points="impressionPoints" color-class="text-sky-700" testid="chart-impressions" />
          <BarChart title="Cliques por dia" :points="clickPoints" color-class="text-amber-700" testid="chart-clicks" />
          <details data-testid="by-day-details">
            <summary class="cursor-pointer text-sm font-medium text-slate-800">Ver os números por dia</summary>
            <div class="mt-2 max-h-80 overflow-auto">
              <table class="w-full text-left text-sm" data-testid="by-day-table">
                <caption class="sr-only">Impressões e cliques por dia</caption>
                <thead class="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    <th scope="col" class="px-3 py-2 font-medium">Dia</th>
                    <th scope="col" class="px-3 py-2 text-right font-medium">Impressões</th>
                    <th scope="col" class="px-3 py-2 text-right font-medium">Cliques</th>
                    <th scope="col" class="px-3 py-2 text-right font-medium">CTR</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  <tr v-for="d in days" :key="d.day" :data-testid="`day-${d.day}`">
                    <th scope="row" class="px-3 py-1.5 font-normal text-slate-800">{{ longDay(d.day) }}</th>
                    <td class="px-3 py-1.5 text-right tabular-nums">{{ formatInt(d.impressions) }}</td>
                    <td class="px-3 py-1.5 text-right tabular-nums">{{ formatInt(d.clicks) }}</td>
                    <td class="px-3 py-1.5 text-right tabular-nums">{{ formatPercent(computeCtr(d.clicks, d.impressions)) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </details>
        </section>

        <section class="mt-8 overflow-hidden rounded-xl border border-slate-200 bg-white" aria-labelledby="by-state-title">
          <h2 id="by-state-title" class="px-4 pt-4 text-base font-semibold text-slate-900">Por estado (UF)</h2>
          <div class="overflow-x-auto">
            <table class="mt-2 w-full text-left text-sm" data-testid="by-state-table">
              <caption class="sr-only">Impressões e cliques por estado</caption>
              <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                <tr>
                  <th scope="col" class="px-4 py-3 font-medium">Estado</th>
                  <th scope="col" class="px-4 py-3 text-right font-medium">Impressões</th>
                  <th scope="col" class="px-4 py-3 text-right font-medium">Cliques</th>
                  <th scope="col" class="px-4 py-3 text-right font-medium">CTR</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                <tr v-if="states.length === 0">
                  <td colspan="4" class="px-4 py-6 text-center text-slate-600" data-testid="states-empty">Sem dados por estado no período.</td>
                </tr>
                <tr v-for="row in states" :key="row.state || 'none'" :data-testid="`state-${row.state || 'none'}`">
                  <th scope="row" class="px-4 py-2 font-normal text-slate-900">{{ stateReportLabel(row.state) }}</th>
                  <td class="px-4 py-2 text-right tabular-nums">{{ formatInt(row.impressions) }}</td>
                  <td class="px-4 py-2 text-right tabular-nums">{{ formatInt(row.clicks) }}</td>
                  <td class="px-4 py-2 text-right tabular-nums">{{ formatPercent(computeCtr(row.clicks, row.impressions)) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>
    </template>
  </div>
</template>
