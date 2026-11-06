<script setup lang="ts">
import { onMounted, ref } from 'vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import FieldShell from '@/components/sponsors/FieldShell.vue'
import { errorMessage } from '@/utils/api'
import { formatDate } from '@/utils/format'
import {
  FINANCE_LIMITS,
  financeErrorText,
  formatCents,
  formatCount,
  monthLabel,
  monthStatusLabel,
  PUBLISH_WARNING,
  UNPUBLISH_WARNING,
  validateNote,
  type FinanceMonth,
} from '@/utils/finance'
import { financeApi } from '@/utils/financeApi'

defineProps<{ canWrite: boolean }>()
const emit = defineEmits<{ (event: 'open-month', month: string): void }>()

const months = ref<FinanceMonth[]>([])
const isLoading = ref(false)
const listError = ref('')
const notice = ref('')

// publicar
const publishTarget = ref<FinanceMonth | null>(null)
const publishNote = ref('')
const publishError = ref('')
const isPublishing = ref(false)

// despublicar
const unpublishTarget = ref<FinanceMonth | null>(null)
const unpublishError = ref('')
const isUnpublishing = ref(false)

let requestSeq = 0

async function load(): Promise<void> {
  const seq = ++requestSeq
  isLoading.value = true
  listError.value = ''
  try {
    const data = await financeApi.listMonths()
    if (seq !== requestSeq) return
    months.value = Array.isArray(data?.items) ? data.items : []
  } catch (e) {
    if (seq !== requestSeq) return
    listError.value = errorMessage(e, 'Não foi possível carregar os meses.')
  } finally {
    if (seq === requestSeq) isLoading.value = false
  }
}

/** Alunos ativos: o retrato gravado (publicado) ou o número ao vivo (ainda aberto). */
function studentsText(m: FinanceMonth): string {
  if (m.published && m.snapshot) return formatCount(m.snapshot.activeStudents)
  if (!m.published && m.liveActiveStudents !== null && m.liveActiveStudents !== undefined) return `${formatCount(m.liveActiveStudents)} (ao vivo)`
  return '—'
}

function openPublish(m: FinanceMonth): void {
  publishTarget.value = m
  publishNote.value = ''
  publishError.value = ''
}

function closePublish(): void {
  if (isPublishing.value) return
  publishTarget.value = null
}

async function confirmPublish(): Promise<void> {
  const target = publishTarget.value
  if (!target || isPublishing.value) return
  const noteProblem = validateNote(publishNote.value)
  if (noteProblem) {
    publishError.value = `Observação: ${noteProblem}`
    return
  }
  isPublishing.value = true
  publishError.value = ''
  try {
    await financeApi.publishMonth(target.month, publishNote.value)
    publishTarget.value = null
    notice.value = `${capitalize(monthLabel(target.month))} publicado. Os números já estão públicos e o mês está travado.`
    await load()
  } catch (e) {
    publishError.value = financeErrorText(e, 'publish')
    // outro super admin pode ter publicado/alterado: traz o estado real para a tabela
    void load()
  } finally {
    isPublishing.value = false
  }
}

function openUnpublish(m: FinanceMonth): void {
  unpublishTarget.value = m
  unpublishError.value = ''
}

function closeUnpublish(): void {
  if (isUnpublishing.value) return
  unpublishTarget.value = null
}

async function confirmUnpublish(): Promise<void> {
  const target = unpublishTarget.value
  if (!target || isUnpublishing.value) return
  isUnpublishing.value = true
  unpublishError.value = ''
  try {
    await financeApi.unpublishMonth(target.month)
    unpublishTarget.value = null
    notice.value = `${capitalize(monthLabel(target.month))} despublicado: saiu da página pública e voltou a aceitar lançamentos.`
    await load()
  } catch (e) {
    unpublishError.value = financeErrorText(e, 'unpublish')
  } finally {
    isUnpublishing.value = false
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

onMounted(() => void load())
</script>

<template>
  <section aria-labelledby="months-title" data-testid="months-tab">
    <h2 id="months-title" class="text-lg font-semibold text-slate-900">Meses</h2>
    <p class="mt-1 text-sm text-slate-600">Últimos 24 meses com lançamento ou publicados. Só os meses publicados aparecem na página pública de transparência.</p>

    <p v-if="notice" role="status" data-testid="notice" class="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900">{{ notice }}</p>
    <p v-if="listError" role="alert" data-testid="list-error" class="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
      {{ listError }}
      <button type="button" class="ml-2 font-medium underline" data-testid="retry" @click="load">Tentar de novo</button>
    </p>

    <div class="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div class="overflow-x-auto">
        <table class="w-full min-w-[860px] text-left text-sm" data-testid="months-table">
          <caption class="sr-only">Meses do livro-caixa</caption>
          <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th scope="col" class="px-4 py-3 font-medium">Mês</th>
              <th scope="col" class="px-4 py-3 font-medium">Situação</th>
              <th scope="col" class="px-4 py-3 text-right font-medium">Receita</th>
              <th scope="col" class="px-4 py-3 text-right font-medium">Despesa</th>
              <th scope="col" class="px-4 py-3 text-right font-medium">Saldo</th>
              <th scope="col" class="px-4 py-3 text-right font-medium">Alunos ativos</th>
              <th scope="col" class="px-4 py-3 text-right font-medium">Ações</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-if="isLoading">
              <td colspan="7" class="px-4 py-8 text-center text-slate-600" data-testid="loading">Carregando…</td>
            </tr>
            <tr v-else-if="months.length === 0 && !listError">
              <td colspan="7" class="px-4 py-8 text-center text-slate-600" data-testid="empty">Nenhum mês com lançamento ainda. Use a aba Lançamentos para registrar a primeira receita ou despesa.</td>
            </tr>
            <tr v-for="m in isLoading ? [] : months" :key="m.month" :data-testid="`month-${m.month}`" class="align-top hover:bg-slate-50">
              <td class="whitespace-nowrap px-4 py-3">
                <span class="font-medium text-slate-900">{{ monthLabel(m.month) }}</span>
                <span class="block text-xs text-slate-600">{{ m.entries }} {{ m.entries === 1 ? 'lançamento' : 'lançamentos' }}</span>
              </td>
              <td class="px-4 py-3">
                <span
                  class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1"
                  :class="m.published ? 'bg-emerald-100 text-emerald-900 ring-emerald-300' : 'bg-slate-100 text-slate-700 ring-slate-300'"
                  :data-testid="`month-status-${m.month}`"
                >
                  <svg v-if="m.published" aria-hidden="true" viewBox="0 0 16 16" class="h-3 w-3" fill="currentColor"><path d="M8 1a3 3 0 0 0-3 3v2H4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-1V4a3 3 0 0 0-3-3Zm-1.5 3a1.5 1.5 0 0 1 3 0v2h-3V4Z" /></svg>
                  {{ monthStatusLabel(m) }}
                </span>
                <span v-if="m.published && m.publishedAt" class="mt-1 block text-xs text-slate-600">em {{ formatDate(m.publishedAt) }}</span>
                <span v-if="m.published && m.note" class="mt-1 block max-w-xs break-words text-xs text-slate-600" :data-testid="`month-note-${m.month}`">Observação pública: {{ m.note }}</span>
              </td>
              <td class="whitespace-nowrap px-4 py-3 text-right tabular-nums text-emerald-800">{{ formatCents(m.revenueCents) }}</td>
              <td class="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-800">{{ formatCents(m.expenseCents) }}</td>
              <td class="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums" :class="m.balanceCents < 0 ? 'text-red-700' : 'text-slate-900'">{{ formatCents(m.balanceCents) }}</td>
              <td class="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-700">{{ studentsText(m) }}</td>
              <td class="whitespace-nowrap px-4 py-3 text-right">
                <button type="button" data-action="open" class="rounded px-2 py-1 text-sm font-medium text-slate-800 underline hover:bg-slate-100" :aria-label="`Ver lançamentos de ${monthLabel(m.month)}`" @click="emit('open-month', m.month)">Ver lançamentos</button>
                <template v-if="canWrite">
                  <button v-if="!m.published" type="button" data-action="publish" class="ml-1 rounded bg-slate-900 px-3 py-1 text-sm font-medium text-white hover:bg-slate-800" :aria-label="`Publicar ${monthLabel(m.month)}`" @click="openPublish(m)">Publicar mês</button>
                  <button v-else type="button" data-action="unpublish" class="ml-1 rounded px-2 py-1 text-sm font-medium text-red-700 underline hover:bg-red-50" :aria-label="`Despublicar ${monthLabel(m.month)}`" @click="openUnpublish(m)">Despublicar</button>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Publicar -->
    <ConfirmDialog
      :open="publishTarget !== null"
      :title="PUBLISH_WARNING.title"
      confirm-label="Publicar mês"
      :busy="isPublishing"
      :error="publishError"
      @cancel="closePublish"
      @confirm="confirmPublish"
    >
      <p>
        Você vai publicar <strong>{{ publishTarget ? monthLabel(publishTarget.month) : '' }}</strong>
        <template v-if="publishTarget"> (receita {{ formatCents(publishTarget.revenueCents) }}, despesa {{ formatCents(publishTarget.expenseCents) }}, saldo {{ formatCents(publishTarget.balanceCents) }}, {{ publishTarget.entries }} {{ publishTarget.entries === 1 ? 'lançamento' : 'lançamentos' }})</template>.
      </p>
      <ul class="list-disc space-y-1 pl-5" data-testid="publish-warning">
        <li>{{ PUBLISH_WARNING.public }}</li>
        <li>{{ PUBLISH_WARNING.locked }}</li>
        <li>{{ PUBLISH_WARNING.snapshot }}</li>
      </ul>
      <FieldShell
        id="publish-note"
        label="Observação pública (opcional)"
        hint="Aparece na página pública junto do mês. Não escreva nomes de pessoas nem dados pessoais."
        :counter="`${publishNote.trim().length}/${FINANCE_LIMITS.noteMax}`"
        :counter-over="publishNote.trim().length > FINANCE_LIMITS.noteMax"
        v-slot="{ describedby }"
      >
        <textarea
          id="publish-note"
          v-model="publishNote"
          rows="3"
          :aria-describedby="describedby"
          data-testid="publish-note"
          class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-600 focus:ring-2 focus:ring-slate-400"
        ></textarea>
      </FieldShell>
    </ConfirmDialog>

    <!-- Despublicar -->
    <ConfirmDialog
      :open="unpublishTarget !== null"
      title="Despublicar este mês?"
      confirm-label="Despublicar"
      danger
      :busy="isUnpublishing"
      :error="unpublishError"
      @cancel="closeUnpublish"
      @confirm="confirmUnpublish"
    >
      <p>
        Você vai despublicar <strong>{{ unpublishTarget ? monthLabel(unpublishTarget.month) : '' }}</strong>.
      </p>
      <p data-testid="unpublish-warning">{{ UNPUBLISH_WARNING }}</p>
    </ConfirmDialog>
  </section>
</template>
