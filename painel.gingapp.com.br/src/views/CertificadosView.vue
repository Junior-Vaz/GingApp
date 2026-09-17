<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { api, ApiError } from '@/utils/api'

interface Student {
  id: number
  name: string
}

interface Certificate {
  id: number
  title: string
  issuedAt: string | null
  student: { id: number; name: string }
}

interface CertificateFormState {
  studentId: string
  title: string
  issuedAt: string
}

const certificates = ref<Certificate[]>([])
const students = ref<Student[]>([])
const isLoading = ref(false)
const listError = ref('')

const isModalOpen = ref(false)
const isSubmitting = ref(false)
const formError = ref('')

function emptyForm(): CertificateFormState {
  return { studentId: '', title: '', issuedAt: '' }
}

const form = reactive<CertificateFormState>(emptyForm())

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
}

async function loadAll(): Promise<void> {
  isLoading.value = true
  listError.value = ''
  try {
    const [allCertificates, allStudents] = await Promise.all([
      api.get<Certificate[]>('/certificates'),
      api.get<Student[]>('/students'),
    ])
    certificates.value = allCertificates
    students.value = allStudents
  } catch (error) {
    listError.value = error instanceof ApiError ? error.message : 'Não foi possível carregar os certificados.'
  } finally {
    isLoading.value = false
  }
}

function openCreateModal(): void {
  Object.assign(form, emptyForm())
  formError.value = ''
  isModalOpen.value = true
}

function closeModal(): void {
  isModalOpen.value = false
}

async function submitForm(): Promise<void> {
  formError.value = ''
  if (!form.studentId) {
    formError.value = 'Selecione o aluno.'
    return
  }
  if (form.title.trim().length < 2) {
    formError.value = 'Informe o título (mínimo 2 caracteres).'
    return
  }

  isSubmitting.value = true
  try {
    await api.post('/certificates', {
      studentId: Number(form.studentId),
      title: form.title.trim(),
      issuedAt: form.issuedAt || undefined,
    })
    isModalOpen.value = false
    await loadAll()
  } catch (error) {
    formError.value = error instanceof ApiError ? error.message : 'Não foi possível emitir o certificado.'
  } finally {
    isSubmitting.value = false
  }
}

async function remove(certificate: Certificate): Promise<void> {
  if (!confirm(`Apagar o certificado "${certificate.title}" de ${certificate.student.name}? O QR Code dele deixa de validar.`)) {
    return
  }
  try {
    await api.delete(`/certificates/${certificate.id}`)
    await loadAll()
  } catch (error) {
    listError.value = error instanceof ApiError ? error.message : 'Não foi possível apagar o certificado.'
  }
}

onMounted(() => {
  void loadAll()
})
</script>

<template>
  <div>
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-slate-900">Certificados</h1>
        <p class="mt-1 text-sm text-slate-500">Emita certificados para os alunos — cada um ganha um QR Code de verificação.</p>
      </div>
      <button
        type="button"
        class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
        @click="openCreateModal"
      >
        + Emitir certificado
      </button>
    </div>

    <p v-if="listError" class="mt-4 text-sm text-red-600">{{ listError }}</p>

    <div class="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th class="px-4 py-3 font-medium">Aluno</th>
            <th class="px-4 py-3 font-medium">Título</th>
            <th class="px-4 py-3 font-medium">Emitido em</th>
            <th class="px-4 py-3 font-medium"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-if="isLoading">
            <td colspan="4" class="px-4 py-8 text-center text-slate-400">Carregando…</td>
          </tr>
          <tr v-else-if="certificates.length === 0">
            <td colspan="4" class="px-4 py-8 text-center text-slate-400">Nenhum certificado emitido ainda.</td>
          </tr>
          <tr v-for="cert in certificates" v-else :key="cert.id" class="hover:bg-slate-50">
            <td class="px-4 py-3 font-medium text-slate-900">{{ cert.student.name }}</td>
            <td class="px-4 py-3 text-slate-600">{{ cert.title }}</td>
            <td class="px-4 py-3 text-slate-600">{{ formatDate(cert.issuedAt) }}</td>
            <td class="px-4 py-3 text-right">
              <button type="button" class="text-sm font-medium text-red-600 hover:text-red-700" @click="remove(cert)">
                Apagar
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Modal emitir certificado -->
    <div v-if="isModalOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
      <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h2 class="text-lg font-semibold text-slate-900">Emitir certificado</h2>

        <form class="mt-4 space-y-4" @submit.prevent="submitForm">
          <div>
            <label class="mb-1 block text-sm font-medium text-slate-700">Aluno</label>
            <select
              v-model="form.studentId"
              class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
            >
              <option value="">Selecione…</option>
              <option v-for="student in students" :key="student.id" :value="String(student.id)">
                {{ student.name }}
              </option>
            </select>
          </div>

          <div>
            <label class="mb-1 block text-sm font-medium text-slate-700">Título</label>
            <input
              v-model="form.title"
              type="text"
              placeholder="ex.: Participação no Workshop Capoeira Angola"
              class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
            />
          </div>

          <div>
            <label class="mb-1 block text-sm font-medium text-slate-700">Data de emissão (opcional)</label>
            <input
              v-model="form.issuedAt"
              type="date"
              class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
            />
          </div>

          <p v-if="formError" class="text-sm text-red-600">{{ formError }}</p>

          <div class="flex justify-end gap-2 pt-2">
            <button
              type="button"
              class="rounded-md px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              @click="closeModal"
            >
              Cancelar
            </button>
            <button
              type="submit"
              :disabled="isSubmitting"
              class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {{ isSubmitting ? 'Emitindo…' : 'Emitir' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
