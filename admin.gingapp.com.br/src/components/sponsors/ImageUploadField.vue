<script setup lang="ts">
import { computed, ref } from 'vue'
import { errorMessage } from '@/utils/api'
import {
  imageSrc,
  SPONSOR_IMAGE_MAX_BYTES,
  SPONSOR_IMAGE_RECOMMENDED,
  SPONSOR_IMAGE_TYPES,
  validateImageFile,
} from '@/utils/sponsors'
import { sponsorsApi } from '@/utils/sponsorsApi'

const props = withDefaults(
  defineProps<{
    modelValue: string
    label: string
    /** 'image' = foto de fundo do slide (recomendada 1200×630); 'logo' = marca do patrocinador. */
    kind?: 'image' | 'logo'
    hint?: string
    error?: string
    disabled?: boolean
    testid?: string
  }>(),
  { kind: 'image', hint: '', error: '', disabled: false, testid: 'image' },
)

const emit = defineEmits<{ (event: 'update:modelValue', value: string): void }>()

const isUploading = ref(false)
const localError = ref('')
const dimensionWarning = ref('')

const preview = computed(() => imageSrc(props.modelValue))
const inputId = computed(() => `upload-${props.testid}`)
const messageId = computed(() => `upload-msg-${props.testid}`)
const accept = SPONSOR_IMAGE_TYPES.join(',')

/** Lê largura/altura no navegador (melhor esforço: se não der, simplesmente não avisa). */
function readDimensions(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file)
      const img = new Image()
      img.onload = () => {
        URL.revokeObjectURL(url)
        resolve({ width: img.naturalWidth, height: img.naturalHeight })
      }
      img.onerror = () => {
        URL.revokeObjectURL(url)
        resolve(null)
      }
      img.src = url
    } catch {
      resolve(null)
    }
  })
}

async function onPick(event: Event): Promise<void> {
  const el = event.target as HTMLInputElement
  const file = el.files?.[0]
  el.value = '' // permite escolher o mesmo arquivo de novo depois de corrigir
  if (!file) return
  localError.value = ''
  dimensionWarning.value = ''

  const invalid = validateImageFile(file)
  if (invalid) {
    localError.value = invalid
    return
  }

  isUploading.value = true
  if (props.kind === 'image') {
    void readDimensions(file).then((size) => {
      if (size && (size.width < SPONSOR_IMAGE_RECOMMENDED.width || size.height < SPONSOR_IMAGE_RECOMMENDED.height)) {
        dimensionWarning.value = `A imagem tem ${size.width}×${size.height} px; o recomendado é ${SPONSOR_IMAGE_RECOMMENDED.width}×${SPONSOR_IMAGE_RECOMMENDED.height} px ou mais. Ela pode ficar borrada.`
      }
    })
  }
  try {
    const url = await sponsorsApi.uploadImage(file)
    emit('update:modelValue', url)
  } catch (e) {
    localError.value = errorMessage(e, 'Não foi possível enviar a imagem.')
  } finally {
    isUploading.value = false
  }
}

function remove(): void {
  localError.value = ''
  dimensionWarning.value = ''
  emit('update:modelValue', '')
}

const shownError = computed(() => localError.value || props.error)
</script>

<template>
  <div :data-testid="`${testid}-field`">
    <label :for="inputId" class="mb-1 block text-sm font-medium text-slate-700">{{ label }}</label>
    <div class="flex items-start gap-3">
      <div
        class="flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-slate-300 bg-slate-100"
        :class="kind === 'logo' ? 'h-16 w-16' : 'h-[84px] w-40'"
      >
        <img v-if="preview" :src="preview" :alt="`Prévia: ${label}`" class="h-full w-full object-contain" :data-testid="`${testid}-preview`" />
        <span v-else class="px-2 text-center text-xs text-slate-600">Sem imagem</span>
      </div>
      <div class="min-w-0 flex-1">
        <input
          :id="inputId"
          type="file"
          :accept="accept"
          :disabled="disabled || isUploading"
          :aria-describedby="messageId"
          :aria-invalid="shownError ? 'true' : undefined"
          :data-testid="`${testid}-input`"
          class="block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-slate-800"
          @change="onPick"
        />
        <p :id="messageId" class="mt-1 text-xs text-slate-600">
          <template v-if="isUploading">Enviando…</template>
          <template v-else>
            {{ hint || `JPEG, PNG ou WebP, até ${SPONSOR_IMAGE_MAX_BYTES / 1024} KB.` }}
          </template>
        </p>
        <button
          v-if="modelValue"
          type="button"
          :disabled="disabled || isUploading"
          class="mt-1 text-xs font-medium text-red-700 underline hover:text-red-800 disabled:opacity-60"
          :data-testid="`${testid}-remove`"
          @click="remove"
        >
          Remover imagem
        </button>
        <p v-if="dimensionWarning" role="status" class="mt-1 text-xs text-amber-800" :data-testid="`${testid}-dimension-warning`">{{ dimensionWarning }}</p>
        <p v-if="shownError" role="alert" class="mt-1 text-xs font-medium text-red-700" :data-testid="`${testid}-error`">{{ shownError }}</p>
      </div>
    </div>
  </div>
</template>
