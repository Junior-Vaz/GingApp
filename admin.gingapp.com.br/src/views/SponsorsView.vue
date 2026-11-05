<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import PaginationBar from '@/components/PaginationBar.vue'
import FieldShell from '@/components/sponsors/FieldShell.vue'
import ImageUploadField from '@/components/sponsors/ImageUploadField.vue'
import SponsorsTabs from '@/components/sponsors/SponsorsTabs.vue'
import { ApiError, errorMessage } from '@/utils/api'
import {
  emptySponsorForm,
  imageSrc,
  serverFieldErrors,
  SPONSOR_LIMITS,
  sponsorPayload,
  sponsorToForm,
  validateSponsorForm,
  type Sponsor,
  type SponsorFieldErrors,
  type SponsorFormState,
} from '@/utils/sponsors'
import { sponsorsApi } from '@/utils/sponsorsApi'

const PAGE_SIZE = 20
const SEARCH_DEBOUNCE_MS = 300
const FIELDS = ['name', 'logo', 'contactName', 'contactEmail', 'contactPhone', 'document', 'notes'] as const

const sponsors = ref<Sponsor[]>([])
const total = ref(0)
const offset = ref(0)
const search = ref('')
const isLoading = ref(false)
const listError = ref('')
const notice = ref('')

// formulário (criar/editar)
const formOpen = ref(false)
const editing = ref<Sponsor | null>(null)
const form = reactive<SponsorFormState>(emptySponsorForm())
const fieldErrors = reactive<SponsorFieldErrors>({})
const generalErrors = ref<string[]>([])
const isSaving = ref(false)
const nameInput = ref<HTMLInputElement | null>(null)
let openerEl: HTMLElement | null = null

// exclusão
const deleteTarget = ref<Sponsor | null>(null)
const isDeleting = ref(false)
const deleteError = ref('')

let requestSeq = 0
let searchTimer: ReturnType<typeof setTimeout> | null = null

const inputClass =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-600 focus:ring-2 focus:ring-slate-400 aria-[invalid=true]:border-red-600'

async function load(): Promise<void> {
  const seq = ++requestSeq
  isLoading.value = true
  listError.value = ''
  try {
    const page = await sponsorsApi.listSponsors({ q: search.value.trim(), limit: PAGE_SIZE, offset: offset.value })
    if (seq !== requestSeq) return
    sponsors.value = page.items
    total.value = page.total
  } catch (e) {
    if (seq !== requestSeq) return
    listError.value = errorMessage(e, 'Não foi possível carregar os patrocinadores.')
  } finally {
    if (seq === requestSeq) isLoading.value = false
  }
}

watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    offset.value = 0
    void load()
  }, SEARCH_DEBOUNCE_MS)
})

function changeOffset(value: number): void {
  offset.value = value
  void load()
}

function clearErrors(): void {
  for (const key of FIELDS) delete fieldErrors[key]
  generalErrors.value = []
}

async function openForm(sponsor: Sponsor | null): Promise<void> {
  openerEl = document.activeElement instanceof HTMLElement ? document.activeElement : null
  editing.value = sponsor
  Object.assign(form, sponsor ? sponsorToForm(sponsor) : emptySponsorForm())
  clearErrors()
  formOpen.value = true
  await nextTick()
  nameInput.value?.focus()
}

function closeForm(): void {
  if (isSaving.value) return
  formOpen.value = false
  editing.value = null
  openerEl?.focus?.()
  openerEl = null
}

async function submitForm(): Promise<void> {
  if (isSaving.value) return
  clearErrors()
  const problems = validateSponsorForm(form)
  if (Object.keys(problems).length > 0) {
    Object.assign(fieldErrors, problems)
    return
  }
  isSaving.value = true
  try {
    const body = sponsorPayload(form)
    const saved = editing.value ? await sponsorsApi.updateSponsor(editing.value.id, body) : await sponsorsApi.createSponsor(body)
    const wasEditing = editing.value !== null
    formOpen.value = false
    editing.value = null
    notice.value = wasEditing ? `Patrocinador "${saved?.name ?? body.name}" atualizado.` : `Patrocinador "${saved?.name ?? body.name}" cadastrado.`
    await load()
  } catch (e) {
    if (e instanceof ApiError && e.status === 400) {
      const server = serverFieldErrors(e, FIELDS)
      Object.assign(fieldErrors, server.fields)
      generalErrors.value = server.general
    } else {
      generalErrors.value = [errorMessage(e, 'Não foi possível salvar o patrocinador.')]
    }
  } finally {
    isSaving.value = false
  }
}

function openDelete(sponsor: Sponsor): void {
  deleteTarget.value = sponsor
  deleteError.value = ''
}

function closeDelete(): void {
  if (isDeleting.value) return
  deleteTarget.value = null
}

/** 409 SPONSOR_HAS_CAMPAIGNS (ou 409 sem código): mensagem clara em vez do texto cru do servidor. */
function deleteErrorText(e: unknown): string {
  if (e instanceof ApiError && (e.code === 'SPONSOR_HAS_CAMPAIGNS' || e.status === 409)) {
    return 'Este patrocinador não pode ser excluído porque tem campanhas. Exclua as campanhas dele primeiro (aba Campanhas) e tente de novo.'
  }
  return errorMessage(e, 'Não foi possível excluir o patrocinador.')
}

async function confirmDelete(): Promise<void> {
  const sponsor = deleteTarget.value
  if (!sponsor || isDeleting.value) return
  isDeleting.value = true
  deleteError.value = ''
  try {
    await sponsorsApi.deleteSponsor(sponsor.id)
    deleteTarget.value = null
    notice.value = `Patrocinador "${sponsor.name}" excluído.`
    if (sponsors.value.length === 1 && offset.value > 0) offset.value = Math.max(0, offset.value - PAGE_SIZE)
    await load()
  } catch (e) {
    deleteError.value = deleteErrorText(e)
  } finally {
    isDeleting.value = false
  }
}

function onFormKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.stopPropagation()
    closeForm()
  }
}

onMounted(() => void load())
onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
})
</script>

<template>
  <div>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-slate-900">Patrocinadores</h1>
        <p class="mt-1 text-sm text-slate-600">Empresas que patrocinam o banner da Home do app. Os dados de contato, documento e observações são só do admin.</p>
      </div>
      <button
        type="button"
        data-testid="new-sponsor"
        class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        @click="openForm(null)"
      >
        + Novo patrocinador
      </button>
    </div>

    <SponsorsTabs class="mt-6" />

    <div class="max-w-md">
      <label for="sponsor-search" class="mb-1 block text-sm font-medium text-slate-800">Buscar</label>
      <input id="sponsor-search" v-model="search" type="search" placeholder="Nome, contato ou documento" data-testid="sponsor-search" :class="inputClass" />
    </div>

    <p v-if="notice" role="status" data-testid="notice" class="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900">{{ notice }}</p>
    <p v-if="listError" role="alert" data-testid="list-error" class="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
      {{ listError }}
      <button type="button" class="ml-2 font-medium underline" data-testid="retry" @click="load">Tentar de novo</button>
    </p>

    <div class="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div class="overflow-x-auto">
        <table class="w-full min-w-[820px] text-left text-sm" data-testid="sponsors-table">
          <caption class="sr-only">Lista de patrocinadores</caption>
          <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th scope="col" class="px-4 py-3 font-medium">Patrocinador</th>
              <th scope="col" class="px-4 py-3 font-medium">Contato</th>
              <th scope="col" class="px-4 py-3 font-medium">Documento</th>
              <th scope="col" class="px-4 py-3 font-medium">Observações</th>
              <th scope="col" class="px-4 py-3 text-right font-medium">Ações</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-if="isLoading">
              <td colspan="5" class="px-4 py-8 text-center text-slate-600" data-testid="loading">Carregando…</td>
            </tr>
            <tr v-else-if="sponsors.length === 0 && !listError">
              <td colspan="5" class="px-4 py-8 text-center text-slate-600" data-testid="empty">
                {{ search.trim() ? 'Nenhum patrocinador encontrado para essa busca.' : 'Nenhum patrocinador cadastrado ainda. Cadastre o primeiro para poder criar campanhas.' }}
              </td>
            </tr>
            <tr v-for="sponsor in isLoading ? [] : sponsors" :key="sponsor.id" :data-testid="`sponsor-${sponsor.id}`" class="align-top hover:bg-slate-50">
              <td class="px-4 py-3">
                <div class="flex items-center gap-3">
                  <img v-if="sponsor.logo" :src="imageSrc(sponsor.logo)" :alt="`Logo de ${sponsor.name}`" class="h-10 w-10 shrink-0 rounded-md border border-slate-200 bg-white object-contain" />
                  <span v-else aria-hidden="true" class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-slate-100 text-xs font-semibold text-slate-600">{{ sponsor.name.slice(0, 2).toUpperCase() }}</span>
                  <span class="font-medium text-slate-900">{{ sponsor.name }}</span>
                </div>
              </td>
              <td class="px-4 py-3 text-slate-700">
                <template v-if="sponsor.contactName || sponsor.contactEmail || sponsor.contactPhone">
                  <span v-if="sponsor.contactName" class="block">{{ sponsor.contactName }}</span>
                  <span v-if="sponsor.contactEmail" class="block break-all text-xs text-slate-600">{{ sponsor.contactEmail }}</span>
                  <span v-if="sponsor.contactPhone" class="block text-xs text-slate-600">{{ sponsor.contactPhone }}</span>
                </template>
                <span v-else class="text-slate-500">—</span>
              </td>
              <td class="px-4 py-3 text-slate-700">{{ sponsor.document || '—' }}</td>
              <td class="max-w-xs px-4 py-3 text-slate-700"><span class="line-clamp-2 break-words">{{ sponsor.notes || '—' }}</span></td>
              <td class="whitespace-nowrap px-4 py-3 text-right">
                <button type="button" data-action="edit" class="rounded px-2 py-1 text-sm font-medium text-slate-800 underline hover:bg-slate-100" :aria-label="`Editar ${sponsor.name}`" @click="openForm(sponsor)">Editar</button>
                <button type="button" data-action="delete" class="ml-1 rounded px-2 py-1 text-sm font-medium text-red-700 underline hover:bg-red-50" :aria-label="`Excluir ${sponsor.name}`" @click="openDelete(sponsor)">Excluir</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <PaginationBar :total="total" :offset="offset" :limit="PAGE_SIZE" :disabled="isLoading" @update:offset="changeOffset" />
    </div>

    <!-- Formulário criar/editar -->
    <div v-if="formOpen" class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-8" @keydown="onFormKeydown">
      <div role="dialog" aria-modal="true" aria-labelledby="sponsor-form-title" class="w-full max-w-xl rounded-xl bg-white p-6 shadow-xl" data-testid="sponsor-form">
        <h2 id="sponsor-form-title" class="text-lg font-semibold text-slate-900">{{ editing ? 'Editar patrocinador' : 'Novo patrocinador' }}</h2>

        <form class="mt-4 space-y-4" novalidate @submit.prevent="submitForm">
          <div v-if="generalErrors.length" role="alert" class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" data-testid="form-errors">
            <p v-for="message in generalErrors" :key="message">{{ message }}</p>
          </div>

          <FieldShell id="sp-name" label="Nome" required :error="fieldErrors.name" :counter="`${form.name.trim().length}/${SPONSOR_LIMITS.nameMax}`" :counter-over="form.name.trim().length > SPONSOR_LIMITS.nameMax" v-slot="{ describedby, invalid }">
            <input id="sp-name" ref="nameInput" v-model="form.name" type="text" autocomplete="off" :aria-describedby="describedby" :aria-invalid="invalid" :class="inputClass" data-testid="field-name" />
          </FieldShell>

          <ImageUploadField v-model="form.logo" label="Logo" kind="logo" testid="logo" hint="Aparece no selo do anúncio. JPEG, PNG ou WebP, até 250 KB." :error="fieldErrors.logo" />

          <fieldset class="space-y-3 rounded-lg border border-slate-200 p-4">
            <legend class="px-1 text-sm font-semibold text-slate-800">Contato comercial (nunca aparece no app)</legend>
            <FieldShell id="sp-contact-name" label="Nome do contato" :error="fieldErrors.contactName" v-slot="{ describedby, invalid }">
              <input id="sp-contact-name" v-model="form.contactName" type="text" autocomplete="off" :aria-describedby="describedby" :aria-invalid="invalid" :class="inputClass" data-testid="field-contactName" />
            </FieldShell>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FieldShell id="sp-contact-email" label="E-mail" :error="fieldErrors.contactEmail" v-slot="{ describedby, invalid }">
                <input id="sp-contact-email" v-model="form.contactEmail" type="email" autocomplete="off" :aria-describedby="describedby" :aria-invalid="invalid" :class="inputClass" data-testid="field-contactEmail" />
              </FieldShell>
              <FieldShell id="sp-contact-phone" label="Telefone" :error="fieldErrors.contactPhone" v-slot="{ describedby, invalid }">
                <input id="sp-contact-phone" v-model="form.contactPhone" type="tel" autocomplete="off" :aria-describedby="describedby" :aria-invalid="invalid" :class="inputClass" data-testid="field-contactPhone" />
              </FieldShell>
            </div>
          </fieldset>

          <FieldShell id="sp-document" label="Documento (CNPJ/CPF)" hint="Opcional. Visível só para a equipe da plataforma." :error="fieldErrors.document" v-slot="{ describedby, invalid }">
            <input id="sp-document" v-model="form.document" type="text" autocomplete="off" :aria-describedby="describedby" :aria-invalid="invalid" :class="inputClass" data-testid="field-document" />
          </FieldShell>

          <FieldShell id="sp-notes" label="Observações" :error="fieldErrors.notes" :counter="`${form.notes.length}/${SPONSOR_LIMITS.notesMax}`" :counter-over="form.notes.length > SPONSOR_LIMITS.notesMax" v-slot="{ describedby, invalid }">
            <textarea id="sp-notes" v-model="form.notes" rows="3" :aria-describedby="describedby" :aria-invalid="invalid" :class="inputClass" data-testid="field-notes"></textarea>
          </FieldShell>

          <div class="flex justify-end gap-2 pt-2">
            <button type="button" class="rounded-md px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100" :disabled="isSaving" @click="closeForm">Cancelar</button>
            <button type="submit" data-testid="sponsor-save" :disabled="isSaving" class="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60">
              {{ isSaving ? 'Salvando…' : 'Salvar' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Excluir -->
    <ConfirmDialog
      :open="deleteTarget !== null"
      title="Excluir patrocinador?"
      confirm-label="Excluir"
      danger
      :busy="isDeleting"
      :error="deleteError"
      @cancel="closeDelete"
      @confirm="confirmDelete"
    >
      <p>
        Você vai excluir <strong>{{ deleteTarget?.name }}</strong
        >. Essa ação não pode ser desfeita.
      </p>
      <p class="text-slate-600">Só é possível excluir um patrocinador que não tenha campanhas.</p>
    </ConfirmDialog>
  </div>
</template>
