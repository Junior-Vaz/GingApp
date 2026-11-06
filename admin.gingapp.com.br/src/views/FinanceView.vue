<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import FinanceEntriesTab from '@/components/finance/FinanceEntriesTab.vue'
import FinanceMonthsTab from '@/components/finance/FinanceMonthsTab.vue'
import FinancePreviewTab from '@/components/finance/FinancePreviewTab.vue'
import FinanceSettingsTab from '@/components/finance/FinanceSettingsTab.vue'
import { useAuthStore } from '@/stores/auth'
import { WRITE_ONLY_SUPER_HINT } from '@/utils/finance'

type TabKey = 'months' | 'entries' | 'settings' | 'preview'

const TABS: ReadonlyArray<{ key: TabKey; label: string }> = [
  { key: 'months', label: 'Meses' },
  { key: 'entries', label: 'Lançamentos' },
  { key: 'settings', label: 'Configurações' },
  { key: 'preview', label: 'Prévia' },
]

const authStore = useAuthStore()
// Mesmo critério das outras telas (Duplicatas, LGPD, Patrocínio): só PLATFORM + super admin escreve; o servidor é a barreira real.
const canWrite = computed(() => authStore.user?.userType === 'PLATFORM' && authStore.user?.isSuperAdmin === true)

const active = ref<TabKey>('months')
/** Mês escolhido em "Ver lançamentos" da aba Meses. */
const entriesMonth = ref('')
/** Força a aba Lançamentos a remontar (e recarregar) quando se abre outro mês. */
const entriesKey = ref(0)

const base = 'rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900'
const on = 'bg-slate-900 text-white'
const off = 'text-slate-700 hover:bg-slate-200'

function select(tab: TabKey): void {
  active.value = tab
}

async function openMonth(month: string): Promise<void> {
  entriesMonth.value = month
  entriesKey.value += 1
  active.value = 'entries'
  await nextTick()
}

function onTabKeydown(event: KeyboardEvent): void {
  const index = TABS.findIndex((t) => t.key === active.value)
  let next = index
  if (event.key === 'ArrowRight') next = (index + 1) % TABS.length
  else if (event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length
  else return
  event.preventDefault()
  active.value = TABS[next]!.key
  void nextTick(() => document.getElementById(`finance-tab-${active.value}`)?.focus())
}
</script>

<template>
  <div>
    <div>
      <h1 class="text-2xl font-semibold tracking-tight text-slate-900">Financeiro</h1>
      <p class="mt-1 text-sm text-slate-600">Livro-caixa da plataforma e transparência: quanto custa, de onde vem o dinheiro e o que fica público a cada mês.</p>
      <p v-if="!canWrite" class="mt-2 text-sm text-slate-600" data-testid="read-only-banner">{{ WRITE_ONLY_SUPER_HINT }}</p>
    </div>

    <div role="tablist" aria-label="Seções do Financeiro" class="mt-6 flex w-full max-w-full gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1 sm:w-fit" data-testid="finance-tabs" @keydown="onTabKeydown">
      <button
        v-for="tab in TABS"
        :id="`finance-tab-${tab.key}`"
        :key="tab.key"
        type="button"
        role="tab"
        :aria-selected="active === tab.key"
        :aria-controls="`finance-panel-${tab.key}`"
        :tabindex="active === tab.key ? 0 : -1"
        :class="[base, 'whitespace-nowrap', active === tab.key ? on : off]"
        :data-testid="`tab-${tab.key}`"
        @click="select(tab.key)"
      >
        {{ tab.label }}
      </button>
    </div>

    <div :id="`finance-panel-${active}`" role="tabpanel" :aria-labelledby="`finance-tab-${active}`" class="mt-6">
      <FinanceMonthsTab v-if="active === 'months'" :can-write="canWrite" @open-month="openMonth" />
      <FinanceEntriesTab v-else-if="active === 'entries'" :key="entriesKey" :can-write="canWrite" :initial-month="entriesMonth" />
      <FinanceSettingsTab v-else-if="active === 'settings'" :can-write="canWrite" />
      <FinancePreviewTab v-else />
    </div>
  </div>
</template>
