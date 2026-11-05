<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import FieldShell from '@/components/sponsors/FieldShell.vue'
import ImageUploadField from '@/components/sponsors/ImageUploadField.vue'
import SponsorSlidePreview from '@/components/sponsors/SponsorSlidePreview.vue'
import SponsorStatusChip from '@/components/sponsors/SponsorStatusChip.vue'
import { ApiError, errorMessage } from '@/utils/api'
import { setFlash } from '@/utils/flash'
import { formatDateTime } from '@/utils/format'
import {
  approvalText,
  BRAZIL_STATES,
  campaignPayload,
  campaignToForm,
  checkDestinationUrl,
  contentChanged,
  emptyCampaignForm,
  serverFieldErrors,
  SPONSOR_CATEGORIES,
  SPONSOR_IMAGE_RECOMMENDED,
  SPONSOR_LIMITS,
  validateCampaignForm,
  type CampaignFormState,
  type Sponsor,
  type SponsorCampaign,
} from '@/utils/sponsors'
import { sponsorsApi } from '@/utils/sponsorsApi'

type FieldKey = keyof CampaignFormState
const FIELD_KEYS = Object.keys(emptyCampaignForm()) as FieldKey[]
/** O servidor usa `priceCents`; o formulário chama de `price`. */
const SERVER_FIELD_ALIASES: Record<string, FieldKey> = { priceCents: 'price' }

const route = useRoute()
const router = useRouter()

const campaignId = computed(() => (route.params.id ? Number(route.params.id) : null))
const isEdit = computed(() => campaignId.value !== null)

const sponsors = ref<Sponsor[]>([])
const original = ref<SponsorCampaign | null>(null)
const originalForm = ref<CampaignFormState | null>(null)
const form = reactive<CampaignFormState>(emptyCampaignForm())

const isLoading = ref(true)
const loadError = ref('')
const isSaving = ref(false)
const submitted = ref(false)
const touched = reactive<Partial<Record<FieldKey, boolean>>>({})
const serverErrors = reactive<Partial<Record<FieldKey, string>>>({})
const generalErrors = ref<string[]>([])
const confirmDraft = ref(false)

const inputClass =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-600 focus:ring-2 focus:ring-slate-400 aria-[invalid=true]:border-red-600'

const errors = computed(() => validateCampaignForm(form))
const urlCheck = computed(() => checkDestinationUrl(form.destinationUrl))

function shown(field: FieldKey): string | undefined {
  if (serverErrors[field]) return serverErrors[field]
  if (field === 'destinationUrl' && form.destinationUrl.trim() !== '') return errors.value[field]
  return submitted.value || touched[field] ? errors.value[field] : undefined
}
const touch = (field: FieldKey) => () => {
  touched[field] = true
}

// Editar um campo some com o erro que o servidor tinha apontado para ele.
watch(
  () => ({ ...form }),
  (now, before) => {
    for (const key of FIELD_KEYS) if (now[key] !== before[key]) delete serverErrors[key]
  },
)

const sponsorOptions = computed(() => {
  const list = [...sponsors.value]
  const current = original.value
  if (current && !list.some((s) => s.id === current.sponsorId)) {
    list.push({
      id: current.sponsorId,
      name: current.sponsor?.name ?? current.sponsorName ?? `Patrocinador #${current.sponsorId}`,
      logo: current.sponsor?.logo ?? null,
    } as Sponsor)
  }
  return list
})
const selectedSponsor = computed(() => sponsorOptions.value.find((s) => String(s.id) === form.sponsorId) ?? null)

const counters = computed(() => ({
  title: form.title.trim().length,
  text: form.text.trim().length,
  cta: form.ctaLabel.trim().length,
  billing: form.billingNote.length,
}))

const isLive = computed(() => original.value?.status === 'ACTIVE')
const willResetToDraft = computed(() => isLive.value && originalForm.value !== null && contentChanged(originalForm.value, form))

function toggleState(uf: string): void {
  form.states = form.states.includes(uf) ? form.states.filter((s) => s !== uf) : [...form.states, uf]
}
const allSelected = computed(() => form.states.length === BRAZIL_STATES.length)

async function load(): Promise<void> {
  isLoading.value = true
  loadError.value = ''
  try {
    const [sponsorPage, campaign] = await Promise.all([
      sponsorsApi.listSponsors({ limit: 200 }),
      campaignId.value !== null ? sponsorsApi.getCampaign(campaignId.value) : Promise.resolve(null),
    ])
    sponsors.value = sponsorPage.items
    if (campaign) {
      original.value = campaign
      Object.assign(form, campaignToForm(campaign))
      originalForm.value = campaignToForm(campaign)
    }
  } catch (e) {
    loadError.value = errorMessage(e, isEdit.value ? 'Não foi possível carregar a campanha.' : 'Não foi possível carregar os patrocinadores.')
  } finally {
    isLoading.value = false
  }
}

function attemptSave(): void {
  if (isSaving.value) return
  submitted.value = true
  generalErrors.value = []
  if (Object.keys(errors.value).length > 0) {
    // Leva o foco ao primeiro campo com erro (teclado e leitor de tela).
    queueMicrotask(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
    return
  }
  if (willResetToDraft.value) {
    confirmDraft.value = true
    return
  }
  void save()
}

async function save(): Promise<void> {
  confirmDraft.value = false
  isSaving.value = true
  generalErrors.value = []
  try {
    const body = campaignPayload(form)
    if (isEdit.value && campaignId.value !== null) {
      const wasLive = isLive.value
      const saved = await sponsorsApi.updateCampaign(campaignId.value, body)
      const backToDraft = wasLive && saved?.status === 'DRAFT'
      setFlash(
        backToDraft
          ? `Campanha "${body.title}" salva e devolvida para RASCUNHO: peça a um super admin para ativá-la de novo.`
          : `Campanha "${body.title}" salva.`,
      )
    } else {
      await sponsorsApi.createCampaign(body)
      setFlash(`Campanha "${body.title}" criada como rascunho. Um super admin precisa ativá-la para ir ao ar.`)
    }
    await router.push('/sponsors/campaigns')
  } catch (e) {
    if (e instanceof ApiError && e.status === 400) {
      const server = serverFieldErrors(e, [...FIELD_KEYS, ...Object.keys(SERVER_FIELD_ALIASES)])
      for (const [name, message] of Object.entries(server.fields)) serverErrors[SERVER_FIELD_ALIASES[name] ?? (name as FieldKey)] = message
      generalErrors.value = server.general
      queueMicrotask(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
    } else {
      generalErrors.value = [errorMessage(e, 'Não foi possível salvar a campanha.')]
    }
  } finally {
    isSaving.value = false
  }
}

onMounted(() => void load())
</script>

<template>
  <div>
    <RouterLink to="/sponsors/campaigns" class="text-sm font-medium text-slate-700 underline hover:text-slate-900" data-testid="back">← Voltar para as campanhas</RouterLink>
    <h1 class="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{{ isEdit ? 'Editar campanha' : 'Nova campanha' }}</h1>

    <p v-if="isLoading" class="mt-6 text-sm text-slate-600" data-testid="loading">Carregando…</p>
    <p v-else-if="loadError" role="alert" class="mt-6 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800" data-testid="load-error">
      {{ loadError }}
      <button type="button" class="ml-2 font-medium underline" @click="load">Tentar de novo</button>
    </p>

    <template v-else>
      <p v-if="original" class="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-700" data-testid="campaign-meta">
        <SponsorStatusChip :status="original.effectiveStatus" />
        <span v-if="approvalText(original, formatDateTime)" data-testid="approval">{{ approvalText(original, formatDateTime) }}</span>
      </p>

      <p v-if="sponsorOptions.length === 0" role="status" class="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900" data-testid="no-sponsors">
        Nenhum patrocinador cadastrado. <RouterLink to="/sponsors" class="font-medium underline">Cadastre um patrocinador</RouterLink> antes de criar a campanha.
      </p>

      <p v-if="isLive" role="note" class="mt-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="live-warning">
        <strong>Esta campanha está ativa.</strong> Se você alterar o conteúdo (patrocinador, título, texto, imagem, botão, link ou categoria), ela
        <strong>volta para rascunho</strong> e precisa ser ativada de novo por um super admin.
      </p>

      <div class="mt-6 grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_400px]">
        <form class="space-y-5" novalidate data-testid="campaign-form" @submit.prevent="attemptSave">
          <div v-if="generalErrors.length" role="alert" class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" data-testid="form-errors">
            <p v-for="message in generalErrors" :key="message">{{ message }}</p>
          </div>

          <section class="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
            <h2 class="text-base font-semibold text-slate-900">Anúncio</h2>

            <FieldShell id="cf-sponsor" label="Patrocinador" required :error="shown('sponsorId')" v-slot="{ describedby, invalid }">
              <select id="cf-sponsor" v-model="form.sponsorId" :aria-describedby="describedby" :aria-invalid="invalid" :class="inputClass" data-testid="field-sponsorId" @blur="touch('sponsorId')()">
                <option value="">Escolha…</option>
                <option v-for="sponsor in sponsorOptions" :key="sponsor.id" :value="String(sponsor.id)">{{ sponsor.name }}</option>
              </select>
            </FieldShell>

            <FieldShell id="cf-title" label="Título" required :error="shown('title')" :counter="`${counters.title}/${SPONSOR_LIMITS.titleMax}`" :counter-over="counters.title > SPONSOR_LIMITS.titleMax" v-slot="{ describedby, invalid }">
              <input id="cf-title" v-model="form.title" type="text" autocomplete="off" :aria-describedby="describedby" :aria-invalid="invalid" :class="inputClass" data-testid="field-title" @blur="touch('title')()" />
            </FieldShell>

            <FieldShell id="cf-text" label="Texto" required hint="Texto puro, curto e direto. Não use HTML." :error="shown('text')" :counter="`${counters.text}/${SPONSOR_LIMITS.textMax}`" :counter-over="counters.text > SPONSOR_LIMITS.textMax" v-slot="{ describedby, invalid }">
              <textarea id="cf-text" v-model="form.text" rows="3" :aria-describedby="describedby" :aria-invalid="invalid" :class="inputClass" data-testid="field-text" @blur="touch('text')()"></textarea>
            </FieldShell>

            <ImageUploadField
              v-model="form.imageRef"
              label="Imagem de fundo"
              kind="image"
              testid="image"
              :hint="`Recomendado ${SPONSOR_IMAGE_RECOMMENDED.width}×${SPONSOR_IMAGE_RECOMMENDED.height} px. JPEG, PNG ou WebP, até 250 KB. Sem imagem, o slide usa um degradê verde.`"
              :error="shown('imageRef')"
            />

            <div data-testid="logo-readonly">
              <p class="text-sm font-medium text-slate-800">Logo</p>
              <p class="mt-1 text-xs text-slate-600">
                O logo vem do cadastro do patrocinador
                <template v-if="selectedSponsor?.logo">(já cadastrado, aparece na pré-visualização)</template>
                <template v-else>(este patrocinador ainda não tem logo)</template>.
                Para trocar, <RouterLink to="/sponsors" class="font-medium underline">edite o patrocinador</RouterLink>.
              </p>
            </div>

            <FieldShell id="cf-cta" label="Texto do botão" required :error="shown('ctaLabel')" :counter="`${counters.cta}/${SPONSOR_LIMITS.ctaMax}`" :counter-over="counters.cta > SPONSOR_LIMITS.ctaMax" v-slot="{ describedby, invalid }">
              <input id="cf-cta" v-model="form.ctaLabel" type="text" autocomplete="off" :aria-describedby="describedby" :aria-invalid="invalid" :class="inputClass" data-testid="field-ctaLabel" @blur="touch('ctaLabel')()" />
            </FieldShell>

            <FieldShell id="cf-url" label="Link de destino" required hint="O aluno vai para este endereço ao tocar no botão. Só https://, sem usuário/senha e sem IP." :error="shown('destinationUrl')" v-slot="{ describedby, invalid }">
              <input id="cf-url" v-model="form.destinationUrl" type="url" inputmode="url" autocomplete="off" placeholder="https://www.loja.com.br/oferta" :aria-describedby="describedby" :aria-invalid="invalid" :class="inputClass" data-testid="field-destinationUrl" @blur="touch('destinationUrl')()" />
            </FieldShell>
            <p v-if="form.destinationUrl.trim() && urlCheck.warning" role="status" class="-mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="url-warning">{{ urlCheck.warning }}</p>

            <FieldShell id="cf-category" label="Categoria" required hint="Só categorias permitidas. Bebida alcoólica, apostas, tabaco, conteúdo adulto, crédito predatório e política partidária não são aceitos." :error="shown('category')" v-slot="{ describedby, invalid }">
              <select id="cf-category" v-model="form.category" :aria-describedby="describedby" :aria-invalid="invalid" :class="inputClass" data-testid="field-category" @blur="touch('category')()">
                <option value="">Escolha…</option>
                <option v-for="category in SPONSOR_CATEGORIES" :key="category.value" :value="category.value">{{ category.label }}</option>
              </select>
            </FieldShell>
          </section>

          <section class="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
            <h2 class="text-base font-semibold text-slate-900">Quando e onde</h2>

            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FieldShell id="cf-starts" label="Início (horário de Brasília)" required :error="shown('startsAt')" v-slot="{ describedby, invalid }">
                <input id="cf-starts" v-model="form.startsAt" type="datetime-local" :aria-describedby="describedby" :aria-invalid="invalid" :class="inputClass" data-testid="field-startsAt" @blur="touch('startsAt')()" />
              </FieldShell>
              <FieldShell id="cf-ends" label="Fim (horário de Brasília)" required :hint="`Depois do início, em até ${SPONSOR_LIMITS.windowMaxDays} dias.`" :error="shown('endsAt')" v-slot="{ describedby, invalid }">
                <input id="cf-ends" v-model="form.endsAt" type="datetime-local" :aria-describedby="describedby" :aria-invalid="invalid" :class="inputClass" data-testid="field-endsAt" @blur="touch('endsAt')()" />
              </FieldShell>
            </div>

            <fieldset data-testid="states-field" :aria-describedby="shown('states') ? 'cf-states-error' : 'cf-states-hint'">
              <legend class="text-sm font-medium text-slate-800">Estados (UF)</legend>
              <p id="cf-states-hint" class="mt-1 text-xs text-slate-600" data-testid="states-summary">
                {{ form.states.length === 0 ? 'Nenhum estado marcado = Brasil todo.' : `${form.states.length} estado(s) marcado(s): só alunos dessas UFs veem o anúncio.` }}
              </p>
              <div class="mt-2 flex gap-2">
                <button type="button" class="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-100" data-testid="states-all" @click="form.states = allSelected ? [] : BRAZIL_STATES.map((s) => s.uf)">
                  {{ allSelected ? 'Desmarcar todos' : 'Marcar todos' }}
                </button>
                <button type="button" class="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-100" data-testid="states-clear" :disabled="form.states.length === 0" @click="form.states = []">Brasil todo (limpar)</button>
              </div>
              <div class="mt-3 grid grid-cols-3 gap-x-3 gap-y-1.5 sm:grid-cols-5 lg:grid-cols-9">
                <label v-for="state in BRAZIL_STATES" :key="state.uf" class="flex cursor-pointer items-center gap-1.5 text-sm text-slate-800" :title="state.name">
                  <input type="checkbox" class="h-4 w-4 rounded border-slate-400" :checked="form.states.includes(state.uf)" :data-testid="`uf-${state.uf}`" @change="toggleState(state.uf)" />
                  <span>{{ state.uf }}<span class="sr-only"> — {{ state.name }}</span></span>
                </label>
              </div>
              <p v-if="shown('states')" id="cf-states-error" role="alert" class="mt-1 text-xs font-medium text-red-700">{{ shown('states') }}</p>
            </fieldset>

            <FieldShell id="cf-weight" label="Peso na rotação" required :hint="`De ${SPONSOR_LIMITS.weightMin} a ${SPONSOR_LIMITS.weightMax}. Quando há várias campanhas na mesma região, as de peso maior aparecem mais vezes.`" :error="shown('weight')" v-slot="{ describedby, invalid }">
              <input id="cf-weight" v-model="form.weight" type="number" inputmode="numeric" :min="SPONSOR_LIMITS.weightMin" :max="SPONSOR_LIMITS.weightMax" step="1" :aria-describedby="describedby" :aria-invalid="invalid" :class="[inputClass, 'max-w-[8rem]']" data-testid="field-weight" @blur="touch('weight')()" />
            </FieldShell>
          </section>

          <section class="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
            <h2 class="text-base font-semibold text-slate-900">Cobrança (só para controle interno)</h2>
            <FieldShell id="cf-price" label="Preço (R$)" hint="Informativo: a cobrança é feita manualmente. Não aparece no app." :error="shown('price')" v-slot="{ describedby, invalid }">
              <input id="cf-price" v-model="form.price" type="text" inputmode="decimal" autocomplete="off" placeholder="1.500,00" :aria-describedby="describedby" :aria-invalid="invalid" :class="[inputClass, 'max-w-[12rem]']" data-testid="field-price" @blur="touch('price')()" />
            </FieldShell>
            <FieldShell id="cf-billing" label="Observação de cobrança" :error="shown('billingNote')" :counter="`${counters.billing}/${SPONSOR_LIMITS.billingNoteMax}`" :counter-over="counters.billing > SPONSOR_LIMITS.billingNoteMax" v-slot="{ describedby, invalid }">
              <textarea id="cf-billing" v-model="form.billingNote" rows="2" :aria-describedby="describedby" :aria-invalid="invalid" :class="inputClass" data-testid="field-billingNote"></textarea>
            </FieldShell>
          </section>

          <div class="flex flex-wrap items-center gap-3">
            <button type="submit" data-testid="campaign-save" :disabled="isSaving || sponsorOptions.length === 0" class="rounded-md bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60">
              {{ isSaving ? 'Salvando…' : isEdit ? 'Salvar alterações' : 'Criar campanha (rascunho)' }}
            </button>
            <RouterLink to="/sponsors/campaigns" class="rounded-md px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Cancelar</RouterLink>
            <p v-if="!isEdit" class="text-xs text-slate-600">A campanha nasce como rascunho. Só um super admin a coloca no ar.</p>
          </div>
        </form>

        <aside class="space-y-4 xl:sticky xl:top-4 xl:self-start" aria-label="Pré-visualização">
          <SponsorSlidePreview
            :title="form.title"
            :text="form.text"
            :cta-label="form.ctaLabel"
            :image-ref="form.imageRef"
            :logo-ref="selectedSponsor?.logo ?? ''"
            :sponsor-name="selectedSponsor?.name ?? ''"
          />
          <p class="text-xs text-slate-600">Textos muito longos podem ser cortados no app. Confira a prévia antes de salvar.</p>
          <p class="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-950" data-testid="label-warning" role="note">
            <strong>O selo “Patrocinado” é obrigatório</strong> e aparece sempre no anúncio. O anúncio <strong>não pode imitar aviso, notificação ou post do Mestre</strong>:
            nada de “Aviso importante”, “Nova mensagem” e semelhantes no título ou no texto.
          </p>
        </aside>
      </div>
    </template>

    <ConfirmDialog
      :open="confirmDraft"
      title="Salvar e voltar para rascunho?"
      confirm-label="Salvar e voltar para rascunho"
      :busy="isSaving"
      @cancel="confirmDraft = false"
      @confirm="save"
    >
      <p data-testid="draft-confirm-text">
        Você mudou o conteúdo de uma campanha que está ativa. Ao salvar, ela <strong>sai do ar e volta para rascunho</strong>, e um super admin precisará ativá-la de novo.
      </p>
    </ConfirmDialog>
  </div>
</template>
