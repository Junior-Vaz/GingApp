<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import ApplicationStatusChip from '@/components/groupApplications/ApplicationStatusChip.vue'
import EmailVerificationBadge from '@/components/groupApplications/EmailVerificationBadge.vue'
import InstagramLink from '@/components/groupApplications/InstagramLink.vue'
import {
  APPROVE_BLOCKED_HINT,
  DECISION_ONLY_SUPER_HINT,
  INSTAGRAM_CHECK_HINT,
  claimedRoleText,
  formatPhone,
  isAwaitingEmail,
  type GroupApplication,
} from '@/utils/groupApplications'
import { formatDateTime } from '@/utils/format'

/** Detalhe do pedido: todos os campos da resposta (a senha nunca existe nela). Decidir só para super admin. */
const props = defineProps<{ application: GroupApplication | null; canDecide: boolean }>()

const emit = defineEmits<{ (event: 'close'): void; (event: 'approve'): void; (event: 'reject'): void }>()

const dialog = ref<HTMLElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)
let previouslyFocused: HTMLElement | null = null

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

watch(
  () => props.application !== null,
  async (isOpen) => {
    if (isOpen) {
      previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
      await nextTick()
      closeButton.value?.focus()
    } else {
      previouslyFocused?.focus?.()
      previouslyFocused = null
    }
  },
)

onBeforeUnmount(() => previouslyFocused?.focus?.())

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.stopPropagation()
    emit('close')
    return
  }
  if (event.key !== 'Tab' || !dialog.value) return
  const items = Array.from(dialog.value.querySelectorAll<HTMLElement>(FOCUSABLE))
  if (items.length === 0) return
  const first = items[0]!
  const last = items[items.length - 1]!
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}
</script>

<template>
  <div v-if="application" class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-8" @keydown="onKeydown">
    <div
      ref="dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="application-detail-title"
      class="card w-full max-w-2xl p-6 shadow-xl"
      data-testid="application-detail"
    >
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div class="min-w-0">
          <h2 id="application-detail-title" class="break-words text-lg font-semibold text-slate-900">{{ application.groupName }}</h2>
          <p class="text-sm text-slate-600">Pedido nº {{ application.id }} · {{ formatDateTime(application.createdAt) }}</p>
        </div>
        <ApplicationStatusChip :status="application.status" />
      </div>

      <dl class="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <div>
          <dt class="text-xs font-medium uppercase tracking-wide text-slate-600">Solicitante</dt>
          <dd class="break-words text-slate-900" data-testid="detail-applicant">{{ application.applicantName }}</dd>
        </div>
        <div>
          <dt class="text-xs font-medium uppercase tracking-wide text-slate-600">Cargo informado</dt>
          <dd class="text-slate-900" data-testid="detail-role">
            {{ claimedRoleText(application) }}
            <span class="block text-xs text-slate-600">Só informativo: ao aprovar, a pessoa vira administradora do grupo.</span>
          </dd>
        </div>
        <div>
          <dt class="text-xs font-medium uppercase tracking-wide text-slate-600">E-mail</dt>
          <dd class="break-all text-slate-900" data-testid="detail-email">{{ application.email }}</dd>
          <dd class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <EmailVerificationBadge :verification="application.emailVerification" />
            <span v-if="application.emailVerification === 'VERIFIED' && application.emailVerifiedAt" class="text-xs text-slate-600" data-testid="detail-email-verified-at">
              em {{ formatDateTime(application.emailVerifiedAt) }}
            </span>
          </dd>
        </div>
        <div>
          <dt class="text-xs font-medium uppercase tracking-wide text-slate-600">Instagram</dt>
          <dd class="text-slate-900" data-testid="detail-instagram"><InstagramLink :handle="application.instagram" /></dd>
        </div>
        <div>
          <dt class="text-xs font-medium uppercase tracking-wide text-slate-600">Telefone</dt>
          <dd class="text-slate-900" data-testid="detail-phone">{{ formatPhone(application.phone) }}</dd>
        </div>
        <div>
          <dt class="text-xs font-medium uppercase tracking-wide text-slate-600">Cidade / UF</dt>
          <dd class="text-slate-900" data-testid="detail-city">{{ application.city }} / {{ application.state }}</dd>
        </div>
        <div>
          <dt class="text-xs font-medium uppercase tracking-wide text-slate-600">Alunos (estimativa)</dt>
          <dd class="text-slate-900" data-testid="detail-students">{{ application.estimatedStudents ?? '—' }}</dd>
        </div>
        <div class="sm:col-span-2">
          <dt class="text-xs font-medium uppercase tracking-wide text-slate-600">Sobre o grupo (texto do solicitante)</dt>
          <dd class="whitespace-pre-line break-words text-slate-900" data-testid="detail-message">{{ application.message || '—' }}</dd>
        </div>
      </dl>

      <p
        v-if="application.status === 'PENDING' || application.status === 'UNVERIFIED'"
        class="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900"
        data-testid="detail-check-hint"
      >
        {{ INSTAGRAM_CHECK_HINT }}
      </p>

      <dl v-if="application.status !== 'PENDING' && application.status !== 'UNVERIFIED'" class="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 border-t border-slate-200 pt-4 text-sm sm:grid-cols-2" data-testid="detail-decision">
        <div>
          <dt class="text-xs font-medium uppercase tracking-wide text-slate-600">Decidido em</dt>
          <dd class="text-slate-900" data-testid="detail-decided-at">{{ formatDateTime(application.decidedAt) }}</dd>
        </div>
        <div>
          <dt class="text-xs font-medium uppercase tracking-wide text-slate-600">Decidido por</dt>
          <dd class="text-slate-900" data-testid="detail-decided-by">{{ application.decidedBy?.name ?? '—' }}</dd>
        </div>
        <div v-if="application.organization" class="sm:col-span-2">
          <dt class="text-xs font-medium uppercase tracking-wide text-slate-600">Grupo criado</dt>
          <dd class="break-words text-slate-900" data-testid="detail-organization">
            {{ application.organization.name }} <span class="text-slate-600">({{ application.organization.slug }})</span>
          </dd>
        </div>
        <div v-if="application.rejectionReason" class="sm:col-span-2">
          <dt class="text-xs font-medium uppercase tracking-wide text-slate-600">Motivo mostrado ao solicitante</dt>
          <dd class="whitespace-pre-line break-words text-slate-900" data-testid="detail-reason">{{ application.rejectionReason }}</dd>
        </div>
      </dl>

      <div v-if="application.internalNote" class="mt-4 rounded-md bg-slate-50 px-3 py-2 text-sm" data-testid="detail-note">
        <p class="text-xs font-medium uppercase tracking-wide text-slate-600">Nota interna (só a equipe vê)</p>
        <p class="mt-1 whitespace-pre-line break-words text-slate-900">{{ application.internalNote }}</p>
      </div>

      <p v-if="application.status === 'PENDING' && !canDecide" class="mt-4 text-sm text-slate-600" data-testid="detail-read-only">{{ DECISION_ONLY_SUPER_HINT }}</p>

      <p v-if="canDecide && isAwaitingEmail(application)" id="application-detail-blocked" class="mt-4 text-sm text-slate-700" data-testid="detail-approve-blocked">{{ APPROVE_BLOCKED_HINT }}</p>

      <div class="mt-6 flex flex-wrap justify-end gap-2">
        <button ref="closeButton" type="button" data-testid="detail-close" class="btn btn-ghost" @click="emit('close')">Fechar</button>
        <template v-if="canDecide && application.status === 'PENDING'">
          <button type="button" data-testid="detail-reject" class="btn btn-secondary border-red-300 text-red-800 hover:bg-red-50" @click="emit('reject')">Não aprovar</button>
          <button type="button" data-testid="detail-approve" class="btn btn-primary" @click="emit('approve')">Aprovar</button>
        </template>
        <!-- E-mail ainda não confirmado: o servidor recusaria (409 EMAIL_NOT_VERIFIED); o botão fica desabilitado com a dica. -->
        <button
          v-else-if="canDecide && isAwaitingEmail(application)"
          type="button"
          disabled
          aria-disabled="true"
          aria-describedby="application-detail-blocked"
          :title="APPROVE_BLOCKED_HINT"
          data-testid="detail-approve"
          class="btn btn-primary"
        >
          Aprovar
        </button>
      </div>
    </div>
  </div>
</template>
