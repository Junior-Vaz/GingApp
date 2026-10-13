<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { api, ApiError } from '@/utils/api'
import { formatDateTime } from '@/utils/format'
import { pluralWord } from '@/utils/plural'

interface Enrollment {
  studentId: number
  status: string
  organization: { id: number; name: string }
}

interface DuplicatePerson {
  id: number
  gingappCode: string
  name: string
  birthDate: string | null
  documentKind: string | null
  documentMasked: string | null
  hasLogin: boolean
  createdAt: string
  enrollments: Enrollment[]
}

interface DuplicateGroup {
  key: string
  birthDate: string | null
  people: DuplicatePerson[]
}

interface DuplicatesResponse {
  total: number
  groups: DuplicateGroup[]
}

interface MergeResponse {
  person: { id: number; gingappCode: string; name: string }
  mergedPersonId: number
  movedStudents: number
}

const ENROLLMENT_STATUS: Record<string, string> = {
  ACTIVE: 'Ativa',
  INACTIVE: 'Inativa',
  PENDING: 'Pendente',
  SUSPENDED: 'Suspensa',
  LEFT: 'Saiu',
}

const authStore = useAuthStore()
/** O servidor só atende super admin ativo da plataforma (403 para o resto). */
const canMerge = computed(() => authStore.user?.userType === 'PLATFORM' && authStore.user?.isSuperAdmin === true)

const groups = ref<DuplicateGroup[]>([])
const total = ref(0)
const isLoading = ref(false)
const loadError = ref('')
const notice = ref('')
const selectedKey = ref<string | null>(null)
const keepId = ref<number | null>(null)
const mergeId = ref<number | null>(null)
const confirming = ref(false)
const isMerging = ref(false)
const mergeError = ref('')

const selected = computed(() => groups.value.find((g) => g.key === selectedKey.value) ?? null)
const keepPerson = computed(() => selected.value?.people.find((p) => p.id === keepId.value) ?? null)
const mergePerson = computed(() => selected.value?.people.find((p) => p.id === mergeId.value) ?? null)
const mergeCandidates = computed(() => selected.value?.people.filter((p) => p.id !== keepId.value) ?? [])
const canSubmit = computed(() => !!keepPerson.value && !!mergePerson.value && keepId.value !== mergeId.value)

function statusLabel(status: string): string {
  return ENROLLMENT_STATUS[status] ?? status
}

/** 'YYYY-MM-DD...' -> 'DD/MM/YYYY' sem passar por Date (evita deslocar o dia pelo fuso). */
function formatBirthDate(value: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '')
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '—'
}

function documentText(person: DuplicatePerson): string {
  if (!person.documentMasked) return 'Sem CPF'
  return `${person.documentKind ?? 'Documento'}: ${person.documentMasked}`
}

function selectGroup(key: string): void {
  selectedKey.value = key
  mergeError.value = ''
}

// Ao trocar o grupo: mantém por padrão a ficha mais antiga (primeira) e mescla a segunda.
watch(selected, (group) => {
  if (!group) {
    keepId.value = null
    mergeId.value = null
    return
  }
  const [first, second] = group.people
  keepId.value = first?.id ?? null
  mergeId.value = second?.id ?? null
})

watch(keepId, (id) => {
  // A ficha a mesclar nunca pode ser a mantida.
  if (id !== null && mergeId.value === id) {
    mergeId.value = selected.value?.people.find((p) => p.id !== id)?.id ?? null
  }
})

async function load(): Promise<void> {
  isLoading.value = true
  loadError.value = ''
  try {
    const data = await api.get<DuplicatesResponse>('/people/duplicates')
    groups.value = data.groups ?? []
    total.value = data.total ?? groups.value.length
    if (!groups.value.some((g) => g.key === selectedKey.value)) {
      selectedKey.value = groups.value[0]?.key ?? null
    }
  } catch (e) {
    groups.value = []
    total.value = 0
    selectedKey.value = null
    loadError.value = e instanceof ApiError ? e.message : 'Não foi possível carregar as duplicatas.'
  } finally {
    isLoading.value = false
  }
}

function mergeErrorText(e: unknown): string {
  if (!(e instanceof ApiError)) return 'Não foi possível mesclar as fichas.'
  switch (e.code) {
    case 'PERSON_MERGE_SAME_GROUP': {
      const orgs = (e.body as { organizations?: { id: number; name: string }[] } | null)?.organizations ?? []
      const names = orgs.map((o) => o.name).join(', ')
      return `As duas fichas têm matrícula no mesmo grupo (${names || 'ver matrículas'}); resolva no grupo antes de mesclar.`
    }
    case 'PERSON_MERGE_USER_CONFLICT':
      return 'Cada ficha tem um login diferente; não é possível mesclar automaticamente.'
    case 'PERSON_ALREADY_MERGED':
      return 'Uma das fichas já foi mesclada em outra. Recarregue a lista.'
    case 'SAME_PERSON':
      return 'Escolha duas fichas diferentes: a ficha mantida e a ficha a mesclar não podem ser a mesma.'
    case 'PERSON_NOT_FOUND':
      return 'Ficha não encontrada. Ela pode já ter sido mesclada; recarregue a lista.'
    default:
      return e.message || 'Não foi possível mesclar as fichas.'
  }
}

function openConfirm(): void {
  if (!canSubmit.value) return
  mergeError.value = ''
  confirming.value = true
}

function closeConfirm(): void {
  if (isMerging.value) return
  confirming.value = false
}

async function submitMerge(): Promise<void> {
  const keep = keepPerson.value
  const merged = mergePerson.value
  if (!keep || !merged || isMerging.value) return
  isMerging.value = true
  mergeError.value = ''
  try {
    const result = await api.post<MergeResponse>('/people/merge', { keepId: keep.id, mergeId: merged.id })
    confirming.value = false
    notice.value = `Fichas mescladas: "${merged.name}" foi absorvida por "${result.person?.name ?? keep.name}" (${result.person?.gingappCode ?? keep.gingappCode}). Matrículas movidas: ${result.movedStudents}.`
    await load()
  } catch (e) {
    mergeError.value = mergeErrorText(e)
    // Erros de regra: fecha o diálogo e mostra o motivo na tela; 404/409 de estado pedem recarregar.
    confirming.value = false
    if (e instanceof ApiError && (e.code === 'PERSON_ALREADY_MERGED' || e.code === 'PERSON_NOT_FOUND')) await load()
  } finally {
    isMerging.value = false
  }
}

onMounted(() => {
  if (canMerge.value) void load()
})
</script>

<template>
  <div>
    <h1 class="text-2xl font-semibold tracking-tight text-slate-900">Duplicatas de fichas</h1>
    <p class="mt-1 text-sm text-slate-500">
      Fichas únicas de capoeiristas que podem ser a mesma pessoa (mesmo nome e nascimento). Compare e mescle apenas quando tiver certeza.
    </p>
    <p class="mt-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" data-testid="irreversible-note">
      A mescla é <strong>irreversível</strong>: não existe "desmesclar". A ficha mesclada deixa de existir e suas matrículas passam para a ficha mantida.
    </p>
    <p
      v-if="!canMerge"
      data-testid="readonly-note"
      class="mt-3 rounded-md border border-slate-200 bg-slate-100 px-4 py-3 text-sm text-slate-600"
    >
      Somente super admins ativos da plataforma podem ver e mesclar duplicatas.
    </p>

    <template v-else>
      <p v-if="notice" role="status" data-testid="merge-notice" class="mt-4 text-sm text-emerald-700">{{ notice }}</p>
      <p v-if="loadError" role="alert" data-testid="load-error" class="mt-4 text-sm text-red-600">
        {{ loadError }}
        <button type="button" class="ml-2 font-medium underline" @click="load">Tentar de novo</button>
      </p>
      <p v-if="mergeError && !confirming" role="alert" data-testid="merge-error" class="mt-4 text-sm text-red-600">{{ mergeError }}</p>

      <p v-if="isLoading" data-testid="loading" class="mt-8 text-center text-sm text-slate-400">Carregando…</p>
      <p
        v-else-if="!loadError && groups.length === 0"
        data-testid="empty"
        class="mt-8 rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-400"
      >
        Nenhuma duplicata encontrada.
      </p>

      <div v-else-if="groups.length > 0" class="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[18rem_1fr]">
        <ul class="space-y-2" data-testid="group-list">
          <li class="text-xs uppercase tracking-wide text-slate-500">{{ total }} {{ pluralWord(total, 'grupo') }} de {{ total === 1 ? 'possível duplicado' : 'possíveis duplicados' }}</li>
          <li v-for="group in groups" :key="group.key">
            <button
              type="button"
              :data-testid="`group-${group.key}`"
              class="w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors"
              :class="group.key === selectedKey ? 'border-slate-900 bg-white shadow-sm' : 'border-slate-200 bg-white hover:bg-slate-50'"
              @click="selectGroup(group.key)"
            >
              <span class="block font-medium text-slate-900">{{ group.people[0]?.name }}</span>
              <span class="block text-xs text-slate-500">
                Nasc. {{ formatBirthDate(group.birthDate) }} · {{ group.people.length }} fichas
              </span>
            </button>
          </li>
        </ul>

        <section v-if="selected" data-testid="compare" class="min-w-0">
          <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <article
              v-for="person in selected.people"
              :key="person.id"
              :data-testid="`person-${person.id}`"
              class="rounded-xl border bg-white p-4 text-sm"
              :class="person.id === keepId ? 'border-emerald-400 ring-1 ring-emerald-300' : person.id === mergeId ? 'border-red-300 ring-1 ring-red-200' : 'border-slate-200'"
            >
              <header class="flex items-start justify-between gap-2">
                <h2 class="font-semibold text-slate-900">{{ person.name }}</h2>
                <span v-if="person.id === keepId" class="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">Fica</span>
                <span v-else-if="person.id === mergeId" class="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Absorvida</span>
              </header>
              <dl class="mt-3 space-y-1 text-slate-600">
                <div><dt class="inline font-medium">Código GingApp: </dt><dd class="inline font-mono">{{ person.gingappCode }}</dd></div>
                <div><dt class="inline font-medium">Nascimento: </dt><dd class="inline">{{ formatBirthDate(person.birthDate) }}</dd></div>
                <div><dt class="inline font-medium">CPF: </dt><dd class="inline">{{ documentText(person) }}</dd></div>
                <div><dt class="inline font-medium">Login: </dt><dd class="inline">{{ person.hasLogin ? 'Tem login' : 'Sem login' }}</dd></div>
                <div><dt class="inline font-medium">Criada em: </dt><dd class="inline">{{ formatDateTime(person.createdAt) }}</dd></div>
              </dl>
              <h3 class="mt-3 text-xs font-medium uppercase tracking-wide text-slate-500">Matrículas</h3>
              <ul class="mt-1 space-y-1">
                <li v-if="person.enrollments.length === 0" class="text-slate-400">Nenhuma matrícula.</li>
                <li v-for="enrollment in person.enrollments" :key="enrollment.studentId" class="flex justify-between gap-2">
                  <span class="text-slate-700">{{ enrollment.organization.name }}</span>
                  <span class="text-xs text-slate-500">{{ statusLabel(enrollment.status) }}</span>
                </li>
              </ul>
              <label class="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3 text-slate-700">
                <input v-model="keepId" type="radio" name="keep" :value="person.id" :data-testid="`keep-${person.id}`" />
                Manter esta ficha
              </label>
            </article>
          </div>

          <div class="mt-4 rounded-xl border border-slate-200 bg-white p-4">
            <label for="merge-target" class="mb-1 block text-sm font-medium text-slate-700">Ficha a mesclar (será absorvida)</label>
            <select id="merge-target" v-model="mergeId" data-testid="merge-target" class="w-full max-w-md rounded-md border border-slate-300 px-3 py-2 text-sm">
              <option v-for="person in mergeCandidates" :key="person.id" :value="person.id">
                {{ person.name }} — {{ person.gingappCode }}
              </option>
            </select>
            <div class="mt-4">
              <button
                type="button"
                data-testid="merge-open"
                :disabled="!canSubmit"
                class="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                @click="openConfirm"
              >
                Mesclar
              </button>
            </div>
          </div>
        </section>
      </div>
    </template>

    <div v-if="confirming && keepPerson && mergePerson" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
      <div class="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl" role="dialog" aria-modal="true" data-testid="merge-dialog">
        <h2 class="text-lg font-semibold text-slate-900">Confirmar mescla de fichas</h2>
        <p class="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
          Esta ação é IRREVERSÍVEL. Não existe "desmesclar".
        </p>
        <ul class="mt-4 space-y-2 text-sm">
          <li data-testid="confirm-keep">
            <span class="font-medium text-emerald-700">Fica:</span>
            {{ keepPerson.name }} ({{ keepPerson.gingappCode }})
          </li>
          <li data-testid="confirm-merge">
            <span class="font-medium text-red-700">É absorvida e deixa de existir:</span>
            {{ mergePerson.name }} ({{ mergePerson.gingappCode }})
          </li>
        </ul>
        <p class="mt-3 text-sm text-slate-600">
          As matrículas e o histórico da ficha absorvida passam para a ficha que fica, que também herda o que ela não tiver (login, CPF, nascimento, foto, contato).
        </p>
        <p v-if="mergeError" role="alert" data-testid="dialog-error" class="mt-3 text-sm text-red-600">{{ mergeError }}</p>
        <div class="mt-5 flex justify-end gap-2">
          <button type="button" class="rounded-md px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100" @click="closeConfirm">Cancelar</button>
          <button
            type="button"
            data-testid="merge-confirm"
            :disabled="isMerging"
            class="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            @click="submitMerge"
          >
            {{ isMerging ? 'Mesclando…' : 'Mesclar definitivamente' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
