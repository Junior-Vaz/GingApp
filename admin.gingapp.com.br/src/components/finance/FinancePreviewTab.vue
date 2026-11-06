<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { errorMessage } from '@/utils/api'
import { formatCents, formatCount, monthLabel, type CategoryTotal, type TransparencyBody } from '@/utils/finance'
import { financeApi } from '@/utils/financeApi'

/** "Prévia": renderiza o corpo de GET /platform-finance/preview (o mesmo que o público veria hoje em /transparencia). */
const body = ref<TransparencyBody | null>(null)
const isLoading = ref(false)
const loadError = ref('')

async function load(): Promise<void> {
  isLoading.value = true
  loadError.value = ''
  try {
    body.value = await financeApi.getPreview()
  } catch (e) {
    loadError.value = errorMessage(e, 'Não foi possível carregar a prévia.')
  } finally {
    isLoading.value = false
  }
}

/** Largura (0..100) de uma barra: parte do total da lista. Só visual; o valor e o percentual escritos ficam ao lado. */
function pctOf(cents: number, rows: CategoryTotal[]): number {
  const sum = rows.reduce((acc, r) => acc + r.cents, 0)
  return sum > 0 ? Math.round((cents * 100) / sum) : 0
}

onMounted(() => void load())
</script>

<template>
  <section aria-labelledby="preview-title" data-testid="preview-tab">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 id="preview-title" class="text-lg font-semibold text-slate-900">Prévia da página pública</h2>
        <p class="mt-1 text-sm text-slate-600">É exatamente o que o público veria hoje: só meses publicados, só totais, sem os textos dos lançamentos.</p>
      </div>
      <button type="button" data-testid="reload-preview" :disabled="isLoading" class="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-60" @click="load">Atualizar prévia</button>
    </div>

    <p v-if="loadError" role="alert" data-testid="load-error" class="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
      {{ loadError }}
      <button type="button" class="ml-2 font-medium underline" data-testid="retry" @click="load">Tentar de novo</button>
    </p>
    <p v-else-if="isLoading && !body" class="mt-4 text-sm text-slate-600" data-testid="loading">Carregando…</p>

    <div v-if="body" class="mt-4 space-y-4" data-testid="preview-body">
      <div class="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
        <p v-if="body.entityName" class="text-sm font-medium text-slate-900" data-testid="preview-entity">{{ body.entityName }}</p>
        <p v-if="body.introText" class="mt-2 whitespace-pre-line text-sm text-slate-700" data-testid="preview-intro">{{ body.introText }}</p>
        <dl class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <dt class="text-xs uppercase tracking-wide text-slate-600">Meta mensal</dt>
            <dd class="text-lg font-semibold tabular-nums text-slate-900" data-testid="preview-goal">{{ body.monthlyGoalCents > 0 ? formatCents(body.monthlyGoalCents) : 'Sem meta definida' }}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-slate-600">Reserva</dt>
            <dd class="text-lg font-semibold tabular-nums" :class="body.reserveCents < 0 ? 'text-red-700' : 'text-slate-900'" data-testid="preview-reserve">{{ formatCents(body.reserveCents) }}</dd>
          </div>
        </dl>
        <p v-if="body.surplusText" class="mt-3 whitespace-pre-line text-sm text-slate-700" data-testid="preview-surplus"><strong>Para onde vai o excedente:</strong> {{ body.surplusText }}</p>
      </div>

      <p v-if="body.months.length === 0" class="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-700" data-testid="preview-empty">
        Ainda não publicamos o primeiro mês. Quando você publicar, ele aparece aqui exatamente como o público vai ver.
      </p>

      <article v-for="m in body.months" :key="m.month" class="rounded-xl border border-slate-200 bg-white p-4 sm:p-6" :data-testid="`preview-month-${m.month}`">
        <h3 class="text-base font-semibold text-slate-900">{{ monthLabel(m.month) }}</h3>
        <p v-if="m.note" class="mt-1 text-sm text-slate-700" data-testid="preview-note">{{ m.note }}</p>

        <dl class="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div>
            <dt class="text-xs uppercase tracking-wide text-slate-600">Receita</dt>
            <dd class="font-semibold tabular-nums text-emerald-800" data-testid="preview-revenue">{{ formatCents(m.revenueCents) }}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-slate-600">Despesa</dt>
            <dd class="font-semibold tabular-nums text-slate-900" data-testid="preview-expense">{{ formatCents(m.expenseCents) }}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-slate-600">Saldo</dt>
            <dd class="font-semibold tabular-nums" :class="m.balanceCents < 0 ? 'text-red-700' : 'text-slate-900'" data-testid="preview-balance">{{ formatCents(m.balanceCents) }}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-slate-600">Custo por aluno ativo</dt>
            <dd class="font-semibold tabular-nums text-slate-900" data-testid="preview-cost">{{ m.costPerActiveStudentCents === null ? 'Sem alunos ativos' : formatCents(m.costPerActiveStudentCents) }}</dd>
          </div>
        </dl>

        <p class="mt-3 text-sm text-slate-700" data-testid="preview-people">{{ formatCount(m.activeStudents) }} {{ m.activeStudents === 1 ? 'aluno ativo' : 'alunos ativos' }} em {{ formatCount(m.activeGroups) }} {{ m.activeGroups === 1 ? 'grupo' : 'grupos' }}.</p>

        <div class="mt-3" data-testid="preview-coverage">
          <template v-if="m.goalCoveragePct === null">
            <p class="text-sm text-slate-700">Sem meta definida neste mês.</p>
          </template>
          <template v-else>
            <p class="text-sm text-slate-800">{{ m.goalCoveragePct }}% da meta de {{ formatCents(m.goalCents) }} coberta.</p>
            <div class="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100" role="presentation">
              <div class="h-full rounded-full bg-emerald-600" :style="{ width: `${Math.min(100, Math.max(0, m.goalCoveragePct))}%` }"></div>
            </div>
          </template>
        </div>

        <div class="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <h4 class="text-sm font-medium text-slate-900">Para onde vai o dinheiro</h4>
            <p v-if="m.expensesByCategory.length === 0" class="mt-1 text-sm text-slate-600">Sem despesas no mês.</p>
            <ul v-else class="mt-2 space-y-2" data-testid="preview-expenses">
              <li v-for="row in m.expensesByCategory" :key="row.category">
                <div class="flex justify-between gap-2 text-sm text-slate-800"><span>{{ row.label }}</span><span class="tabular-nums">{{ formatCents(row.cents) }} · {{ pctOf(row.cents, m.expensesByCategory) }}%</span></div>
                <div class="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100" role="presentation"><div class="h-full rounded-full bg-amber-600" :style="{ width: `${pctOf(row.cents, m.expensesByCategory)}%` }"></div></div>
              </li>
            </ul>
          </div>
          <div>
            <h4 class="text-sm font-medium text-slate-900">De onde vem</h4>
            <p v-if="m.revenueBySource.length === 0" class="mt-1 text-sm text-slate-600">Sem receitas no mês.</p>
            <ul v-else class="mt-2 space-y-2" data-testid="preview-revenues">
              <li v-for="row in m.revenueBySource" :key="row.category">
                <div class="flex justify-between gap-2 text-sm text-slate-800"><span>{{ row.label }}</span><span class="tabular-nums">{{ formatCents(row.cents) }} · {{ pctOf(row.cents, m.revenueBySource) }}%</span></div>
                <div class="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100" role="presentation"><div class="h-full rounded-full bg-emerald-600" :style="{ width: `${pctOf(row.cents, m.revenueBySource)}%` }"></div></div>
              </li>
            </ul>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>
