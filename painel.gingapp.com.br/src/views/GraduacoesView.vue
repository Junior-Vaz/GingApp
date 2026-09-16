<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { api, ApiError } from '@/utils/api'

interface GraduationLevel {
  id: number
  graduationSystemId: number
  name: string
  order: number
  color: string | null
}

interface GraduationSystem {
  id: number
  name: string
  description: string | null
  isActive: boolean
  levels: GraduationLevel[]
}

interface Student {
  id: number
  name: string
}

interface StudentGraduation {
  id: number
  studentId: number
  graduationLevelId: number
  graduatedAt: string
  notes: string | null
  graduationLevel: GraduationLevel
}

// --- Seção 1: sistemas de graduação ---------------------------------------

const systems = ref<GraduationSystem[]>([])
const isLoadingSystems = ref(false)
const systemsError = ref('')

const isSystemModalOpen = ref(false)
const isSubmittingSystem = ref(false)
const systemFormError = ref('')
const systemForm = reactive({ name: '', description: '' })

const levelFormOpenForSystemId = ref<number | null>(null)
const isSubmittingLevel = ref(false)
const levelFormError = ref('')
const levelForm = reactive({ name: '', order: '0', color: '' })

async function loadSystems(): Promise<void> {
  isLoadingSystems.value = true
  systemsError.value = ''
  try {
    systems.value = await api.get<GraduationSystem[]>('/graduations/systems')
  } catch (error) {
    systemsError.value = error instanceof ApiError ? error.message : 'Não foi possível carregar os sistemas de graduação.'
  } finally {
    isLoadingSystems.value = false
  }
}

function openSystemModal(): void {
  systemForm.name = ''
  systemForm.description = ''
  systemFormError.value = ''
  isSystemModalOpen.value = true
}

function closeSystemModal(): void {
  isSystemModalOpen.value = false
}

async function submitSystem(): Promise<void> {
  systemFormError.value = ''
  if (!systemForm.name.trim()) {
    systemFormError.value = 'Informe o nome do sistema de graduação.'
    return
  }

  isSubmittingSystem.value = true
  try {
    await api.post('/graduations/systems', {
      name: systemForm.name.trim(),
      description: systemForm.description.trim() || undefined,
    })
    isSystemModalOpen.value = false
    await loadSystems()
  } catch (error) {
    systemFormError.value = error instanceof ApiError ? error.message : 'Não foi possível criar o sistema de graduação.'
  } finally {
    isSubmittingSystem.value = false
  }
}

function openLevelForm(system: GraduationSystem): void {
  levelForm.name = ''
  levelForm.order = String(system.levels.length)
  levelForm.color = ''
  levelFormError.value = ''
  levelFormOpenForSystemId.value = system.id
}

function closeLevelForm(): void {
  levelFormOpenForSystemId.value = null
}

async function submitLevel(systemId: number): Promise<void> {
  levelFormError.value = ''
  if (!levelForm.name.trim()) {
    levelFormError.value = 'Informe o nome do nível.'
    return
  }
  if (levelForm.order.trim() === '' || Number.isNaN(Number(levelForm.order))) {
    levelFormError.value = 'Informe a ordem do nível (número).'
    return
  }

  isSubmittingLevel.value = true
  try {
    await api.post(`/graduations/systems/${systemId}/levels`, {
      name: levelForm.name.trim(),
      order: Number(levelForm.order),
      color: levelForm.color.trim() || undefined,
    })
    levelFormOpenForSystemId.value = null
    await loadSystems()
  } catch (error) {
    levelFormError.value = error instanceof ApiError ? error.message : 'Não foi possível adicionar o nível.'
  } finally {
    isSubmittingLevel.value = false
  }
}

// --- Seção 2: registrar graduação de aluno ---------------------------------

const students = ref<Student[]>([])
const studentsError = ref('')

const selectedStudentId = ref('')
const history = ref<StudentGraduation[]>([])
const isLoadingHistory = ref(false)
const historyError = ref('')

const registrationForm = reactive({ graduationLevelId: '', graduatedAt: '', notes: '' })
const isRegistering = ref(false)
const registrationError = ref('')
const registrationSuccess = ref('')

/** Combina os níveis de todos os sistemas ATIVOS num único select, rotulado
 * "Sistema — Nível" (a organização pode ter mais de um sistema configurado). */
const levelOptions = computed(() => {
  const options: { id: number; label: string; color: string | null }[] = []
  for (const system of systems.value) {
    if (!system.isActive) continue
    for (const level of system.levels) {
      options.push({ id: level.id, label: `${system.name} — ${level.name}`, color: level.color })
    }
  }
  return options
})

async function loadStudents(): Promise<void> {
  studentsError.value = ''
  try {
    students.value = await api.get<Student[]>('/students')
  } catch (error) {
    studentsError.value = error instanceof ApiError ? error.message : 'Não foi possível carregar os alunos.'
  }
}

async function loadHistory(studentId: number): Promise<void> {
  isLoadingHistory.value = true
  historyError.value = ''
  try {
    history.value = await api.get<StudentGraduation[]>(`/graduations/students/${studentId}`)
  } catch (error) {
    historyError.value = error instanceof ApiError ? error.message : 'Não foi possível carregar o histórico do aluno.'
  } finally {
    isLoadingHistory.value = false
  }
}

watch(selectedStudentId, (value) => {
  registrationSuccess.value = ''
  if (value) {
    void loadHistory(Number(value))
  } else {
    history.value = []
  }
})

async function submitRegistration(): Promise<void> {
  registrationError.value = ''
  registrationSuccess.value = ''

  if (!selectedStudentId.value) {
    registrationError.value = 'Selecione um aluno.'
    return
  }
  if (!registrationForm.graduationLevelId) {
    registrationError.value = 'Selecione o nível alcançado.'
    return
  }
  if (!registrationForm.graduatedAt) {
    registrationError.value = 'Informe a data da graduação.'
    return
  }

  isRegistering.value = true
  try {
    await api.post(`/graduations/students/${selectedStudentId.value}`, {
      graduationLevelId: Number(registrationForm.graduationLevelId),
      graduatedAt: registrationForm.graduatedAt,
      notes: registrationForm.notes.trim() || undefined,
    })
    registrationSuccess.value = 'Graduação registrada com sucesso.'
    registrationForm.graduationLevelId = ''
    registrationForm.graduatedAt = ''
    registrationForm.notes = ''
    await loadHistory(Number(selectedStudentId.value))
  } catch (error) {
    registrationError.value = error instanceof ApiError ? error.message : 'Não foi possível registrar a graduação.'
  } finally {
    isRegistering.value = false
  }
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
}

onMounted(() => {
  void loadSystems()
  void loadStudents()
})
</script>

<template>
  <div>
    <div>
      <h1 class="text-2xl font-semibold tracking-tight text-slate-900">Graduações</h1>
      <p class="mt-1 text-sm text-slate-500">
        Configure o sistema de graduação do grupo e registre a evolução dos alunos.
      </p>
    </div>

    <!-- Seção 1: sistemas de graduação -->
    <section class="mt-8">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-slate-900">Sistema de graduação</h2>
        <button
          type="button"
          class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
          @click="openSystemModal"
        >
          + Novo sistema
        </button>
      </div>

      <p v-if="systemsError" class="mt-4 text-sm text-red-600">{{ systemsError }}</p>

      <div v-if="isLoadingSystems" class="mt-4 text-sm text-slate-400">Carregando…</div>
      <div
        v-else-if="systems.length === 0"
        class="mt-4 rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-400"
      >
        Nenhum sistema de graduação cadastrado ainda.
      </div>

      <div v-else class="mt-4 space-y-4">
        <div v-for="system in systems" :key="system.id" class="rounded-xl border border-slate-200 bg-white p-4">
          <div class="flex items-start justify-between">
            <div>
              <h3 class="font-medium text-slate-900">{{ system.name }}</h3>
              <p v-if="system.description" class="mt-0.5 text-sm text-slate-500">{{ system.description }}</p>
              <span
                v-if="!system.isActive"
                class="mt-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600"
              >
                Inativo
              </span>
            </div>
            <button
              type="button"
              class="text-sm font-medium text-slate-600 hover:text-slate-900"
              @click="levelFormOpenForSystemId === system.id ? closeLevelForm() : openLevelForm(system)"
            >
              + Adicionar nível
            </button>
          </div>

          <div v-if="system.levels.length > 0" class="mt-3 flex flex-wrap gap-2">
            <span
              v-for="level in system.levels"
              :key="level.id"
              class="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700"
            >
              <span
                v-if="level.color"
                class="h-2.5 w-2.5 rounded-full"
                :style="{ backgroundColor: level.color }"
              ></span>
              {{ level.order }}. {{ level.name }}
            </span>
          </div>
          <p v-else class="mt-3 text-sm text-slate-400">Nenhum nível cadastrado neste sistema ainda.</p>

          <!-- Mini-form: adicionar nível -->
          <form
            v-if="levelFormOpenForSystemId === system.id"
            class="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4"
            @submit.prevent="submitLevel(system.id)"
          >
            <div class="min-w-[10rem] flex-1">
              <label class="mb-1 block text-xs font-medium text-slate-700">Nome do nível</label>
              <input
                v-model="levelForm.name"
                type="text"
                class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
              />
            </div>
            <div class="w-24">
              <label class="mb-1 block text-xs font-medium text-slate-700">Ordem</label>
              <input
                v-model="levelForm.order"
                type="number"
                min="0"
                class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
              />
            </div>
            <div class="w-28">
              <label class="mb-1 block text-xs font-medium text-slate-700">Cor</label>
              <input
                v-model="levelForm.color"
                type="color"
                class="h-[38px] w-full cursor-pointer rounded-md border border-slate-300 px-1 py-1"
              />
            </div>
            <div class="flex gap-2">
              <button
                type="submit"
                :disabled="isSubmittingLevel"
                class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {{ isSubmittingLevel ? 'Salvando…' : 'Adicionar' }}
              </button>
              <button
                type="button"
                class="rounded-md px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
                @click="closeLevelForm"
              >
                Cancelar
              </button>
            </div>
            <p v-if="levelFormError" class="w-full text-sm text-red-600">{{ levelFormError }}</p>
          </form>
        </div>
      </div>
    </section>

    <!-- Modal: novo sistema de graduação -->
    <div v-if="isSystemModalOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
      <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h2 class="text-lg font-semibold text-slate-900">Novo sistema de graduação</h2>

        <form class="mt-4 space-y-4" @submit.prevent="submitSystem">
          <div>
            <label class="mb-1 block text-sm font-medium text-slate-700">Nome</label>
            <input
              v-model="systemForm.name"
              type="text"
              required
              class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
            />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-slate-700">Descrição (opcional)</label>
            <textarea
              v-model="systemForm.description"
              rows="2"
              class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
            ></textarea>
          </div>

          <p v-if="systemFormError" class="text-sm text-red-600">{{ systemFormError }}</p>

          <div class="flex justify-end gap-2 pt-2">
            <button
              type="button"
              class="rounded-md px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              @click="closeSystemModal"
            >
              Cancelar
            </button>
            <button
              type="submit"
              :disabled="isSubmittingSystem"
              class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {{ isSubmittingSystem ? 'Salvando…' : 'Salvar' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Seção 2: registrar graduação de aluno -->
    <section class="mt-10">
      <h2 class="text-lg font-semibold text-slate-900">Registrar graduação de aluno</h2>

      <p v-if="studentsError" class="mt-2 text-sm text-red-600">{{ studentsError }}</p>

      <div class="mt-4 rounded-xl border border-slate-200 bg-white p-4">
        <div class="grid gap-3 sm:grid-cols-2">
          <div>
            <label class="mb-1 block text-sm font-medium text-slate-700">Aluno</label>
            <select
              v-model="selectedStudentId"
              class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
            >
              <option value="">Selecione…</option>
              <option v-for="student in students" :key="student.id" :value="String(student.id)">
                {{ student.name }}
              </option>
            </select>
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-slate-700">Nível alcançado</label>
            <select
              v-model="registrationForm.graduationLevelId"
              class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
            >
              <option value="">Selecione…</option>
              <option v-for="option in levelOptions" :key="option.id" :value="String(option.id)">
                {{ option.label }}
              </option>
            </select>
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-slate-700">Data</label>
            <input
              v-model="registrationForm.graduatedAt"
              type="date"
              class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
            />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-slate-700">Observação (opcional)</label>
            <input
              v-model="registrationForm.notes"
              type="text"
              class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
            />
          </div>
        </div>

        <p v-if="registrationError" class="mt-3 text-sm text-red-600">{{ registrationError }}</p>
        <p v-if="registrationSuccess" class="mt-3 text-sm text-emerald-600">{{ registrationSuccess }}</p>

        <div class="mt-4 flex justify-end">
          <button
            type="button"
            :disabled="isRegistering"
            class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            @click="submitRegistration"
          >
            {{ isRegistering ? 'Registrando…' : 'Registrar graduação' }}
          </button>
        </div>
      </div>

      <!-- Histórico do aluno selecionado -->
      <div v-if="selectedStudentId" class="mt-6">
        <h3 class="text-sm font-semibold text-slate-900">Histórico de graduações</h3>

        <p v-if="historyError" class="mt-2 text-sm text-red-600">{{ historyError }}</p>
        <div v-else-if="isLoadingHistory" class="mt-2 text-sm text-slate-400">Carregando…</div>
        <div
          v-else-if="history.length === 0"
          class="mt-2 rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-400"
        >
          Este aluno ainda não tem graduações registradas.
        </div>
        <ul v-else class="mt-2 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          <li v-for="item in history" :key="item.id" class="flex items-center justify-between px-4 py-3 text-sm">
            <div class="flex items-center gap-2">
              <span
                v-if="item.graduationLevel.color"
                class="h-2.5 w-2.5 rounded-full"
                :style="{ backgroundColor: item.graduationLevel.color }"
              ></span>
              <span class="font-medium text-slate-900">{{ item.graduationLevel.name }}</span>
              <span v-if="item.notes" class="text-slate-500">— {{ item.notes }}</span>
            </div>
            <span class="text-slate-500">{{ formatDate(item.graduatedAt) }}</span>
          </li>
        </ul>
      </div>
    </section>
  </div>
</template>
