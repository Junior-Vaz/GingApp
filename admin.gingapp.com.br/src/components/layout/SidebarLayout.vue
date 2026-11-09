<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ChangePasswordModal from '@/components/ChangePasswordModal.vue'
import TermsGateModal from '@/components/TermsGateModal.vue'
import TwoFactorModal from '@/components/TwoFactorModal.vue'
import AppIcon, { type IconName } from '@/components/ui/AppIcon.vue'
import { routes } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { usePendingApplicationsStore } from '@/stores/pendingApplications'
import { fetchTwoFactorStatus } from '@/utils/twoFactor'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const isChangePasswordOpen = ref(false)
const isTwoFactorOpen = ref(false)

// Senha provisória pendente: o servidor barra todas as rotas (403 MUST_CHANGE_PASSWORD), então só a troca aparece.
const mustChangePassword = computed(() => authStore.user?.mustChangePassword === true)
// Aceite dos Termos/Política pendente (vem depois da troca de senha obrigatória).
const needsTerms = computed(() => !mustChangePassword.value && authStore.user?.termsAcceptanceRequired === true)

// Incentivo (opt-in): só aparece com a confirmação do servidor de que a 2FA está desativada (undefined = não mostra).
const showTwoFactorNudge = computed(
  () => !mustChangePassword.value && !needsTerms.value && authStore.user?.twoFactorEnabled === false,
)

onMounted(async () => {
  // Atualiza o estado da 2FA (GET /auth/me). Com senha provisória/termos pendentes o servidor barra tudo: nem tenta.
  if (mustChangePassword.value || needsTerms.value) return
  try {
    const status = await fetchTwoFactorStatus()
    authStore.updateUser(status)
  } catch {
    /* indisponível: o aviso simplesmente não aparece */
  }
})

const isPlatformUser = computed(() => authStore.user?.userType === 'PLATFORM')

// Contador de pedidos de adesão pendentes no menu (só equipe da plataforma). Falha na contagem não quebra o menu.
const pendingApplications = usePendingApplicationsStore()
onMounted(() => {
  if (mustChangePassword.value || needsTerms.value || !isPlatformUser.value) return
  void pendingApplications.refresh()
})

const APPLICATIONS_PATH = '/pedidos-de-adesao'
function badgeFor(path: string): number {
  return path === APPLICATIONS_PATH && pendingApplications.count ? pendingApplications.count : 0
}

// Ícone de cada item do menu (só visual; a lista e os rótulos continuam vindo das rotas).
const NAV_ICONS: Record<string, IconName> = {
  '/dashboard': 'dashboard',
  '/organizations': 'groups',
  '/pedidos-de-adesao': 'inbox',
  '/plans': 'plans',
  '/team': 'team',
  '/settings': 'settings',
  '/announcements': 'announcements',
  '/sponsors': 'sponsors',
  '/financeiro': 'finance',
  '/audit': 'audit',
  '/lgpd': 'lgpd',
  '/duplicates': 'duplicates',
}

const navItems = computed(() =>
  routes
    .filter((r) => typeof r.path === 'string' && r.meta?.navLabel && (!r.meta.platformOnly || isPlatformUser.value))
    .map((r) => ({ path: r.path, label: r.meta!.navLabel as string, icon: NAV_ICONS[r.path] ?? ('dashboard' as IconName) })),
)

// Telas filhas (ex.: /sponsors/campaigns/3/report) mantêm o item do menu marcado.
function isActive(path: string): boolean {
  return route.path === path || route.path.startsWith(`${path}/`)
}

function handleLogout(): void {
  authStore.logout()
  router.push({ name: 'login' })
}

const userName = computed(() => authStore.user?.name ?? 'Usuário')
const userInitials = computed(() => {
  const parts = userName.value.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? 'U'
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  return (first + last).toUpperCase()
})
// Nome da tela atual no topo (rotas sem item de menu usam o título do metadado).
const pageLabel = computed(() => (route.meta.navLabel ?? route.meta.title ?? '') as string)

// --- Gaveta do menu (celular/tablet, < lg) --------------------------------------------------------
// No desktop o menu é fixo (CSS); `drawerOpen` só vale quando o botão de hambúrguer está visível.
const drawerOpen = ref(false)
const sidebarEl = ref<HTMLElement | null>(null)
const menuButton = ref<HTMLButtonElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)
const DRAWER_FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'

// "Ir para o conteúdo" (teclado): foca o <main> sem mexer na URL.
function skipToContent(): void {
  document.getElementById('conteudo')?.focus()
}

async function openDrawer(): Promise<void> {
  drawerOpen.value = true
  await nextTick()
  closeButton.value?.focus()
}

function closeDrawer(restoreFocus = true): void {
  if (!drawerOpen.value) return
  drawerOpen.value = false
  if (restoreFocus) void nextTick(() => menuButton.value?.focus())
}

// ESC fecha a gaveta; Tab/Shift+Tab ficam presos nela enquanto aberta.
function onSidebarKeydown(event: KeyboardEvent): void {
  if (!drawerOpen.value) return
  if (event.key === 'Escape') {
    event.stopPropagation()
    closeDrawer()
    return
  }
  if (event.key !== 'Tab' || !sidebarEl.value) return
  const items = Array.from(sidebarEl.value.querySelectorAll<HTMLElement>(DRAWER_FOCUSABLE))
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

// Navegou: fecha a gaveta (o foco vai para a nova tela, não de volta ao hambúrguer).
watch(
  () => route.fullPath,
  () => closeDrawer(false),
)
// Com a gaveta aberta a página atrás não rola.
watch(drawerOpen, (open) => {
  document.body.style.overflow = open ? 'hidden' : ''
})

let desktopQuery: MediaQueryList | null = null
function onDesktopChange(event: MediaQueryListEvent): void {
  if (event.matches) closeDrawer(false)
}
onMounted(() => {
  // Ao ampliar a janela para desktop o menu vira fixo: a gaveta não pode ficar "aberta" escondida.
  if (typeof window.matchMedia === 'function') {
    desktopQuery = window.matchMedia('(min-width: 1024px)')
    desktopQuery.addEventListener?.('change', onDesktopChange)
  }
})
onBeforeUnmount(() => {
  desktopQuery?.removeEventListener?.('change', onDesktopChange)
  document.body.style.overflow = ''
})
</script>

<template>
  <div class="app-root flex min-h-screen bg-white text-slate-900">
    <a
      href="#conteudo"
      class="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
      @click.prevent="skipToContent"
    >
      Ir para o conteúdo
    </a>

    <!-- Fundo escurecido da gaveta (só < lg, só aberta). Clicar fecha. -->
    <div
      v-if="drawerOpen"
      class="app-chrome fixed inset-0 z-30 bg-slate-950/40 lg:hidden"
      data-testid="drawer-overlay"
      aria-hidden="true"
      @click="closeDrawer()"
    />

    <aside
      id="app-sidebar"
      ref="sidebarEl"
      aria-label="Menu lateral"
      class="app-chrome fixed inset-y-0 left-0 z-40 flex w-64 max-w-[85vw] flex-col border-r bg-white transition-[transform,visibility] duration-200 ease-out motion-reduce:transition-none lg:sticky lg:top-0 lg:h-screen lg:max-w-none lg:shrink-0 lg:translate-x-0 lg:visible"
      :class="drawerOpen ? 'translate-x-0 shadow-xl' : 'max-lg:invisible max-lg:-translate-x-full'"
      data-testid="sidebar"
      @keydown="onSidebarKeydown"
    >
      <div class="flex h-14 shrink-0 items-center justify-between gap-2 border-b px-4">
        <RouterLink to="/dashboard" class="flex min-w-0 items-center gap-2 rounded-md" aria-label="GingApp - ir para o Painel">
          <img src="/logo.png" alt="GingApp" width="1550" height="312" class="h-7 w-auto shrink-0 object-contain" />
          <span class="chip chip-neutral !px-2 !py-0 text-[11px]">Admin</span>
        </RouterLink>
        <button
          ref="closeButton"
          type="button"
          class="flex size-10 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900 lg:hidden"
          aria-label="Fechar menu"
          @click="closeDrawer()"
        >
          <AppIcon name="close" />
        </button>
      </div>

      <nav class="flex-1 overflow-y-auto px-3 py-3" aria-label="Principal">
        <ul class="space-y-0.5">
          <li v-for="item in navItems" :key="item.path">
            <RouterLink
              :to="item.path"
              class="group relative flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
              :class="
                isActive(item.path)
                  ? 'bg-secondary text-primary'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              "
              :aria-current="isActive(item.path) ? 'page' : undefined"
            >
              <span
                v-if="isActive(item.path)"
                class="absolute inset-y-2 left-0 w-1 rounded-r-full bg-primary"
                aria-hidden="true"
              />
              <AppIcon :name="item.icon" :size="18" :class="isActive(item.path) ? 'text-primary' : 'text-slate-500 group-hover:text-slate-700'" />
              <span class="min-w-0 flex-1 truncate" :class="isActive(item.path) ? 'font-semibold' : ''">{{ item.label }}</span>
              <span
                v-if="badgeFor(item.path) > 0"
                class="min-w-[1.25rem] rounded-full bg-amber-500 px-1.5 py-0.5 text-center text-[11px] font-semibold leading-none text-slate-950 tabular-nums"
                data-testid="pending-applications-badge"
                :title="`${badgeFor(item.path)} pedido(s) de adesão aguardando decisão`"
              >
                {{ badgeFor(item.path) }}
                <span class="sr-only"> pendentes</span>
              </span>
            </RouterLink>
          </li>
        </ul>
      </nav>

      <div class="shrink-0 border-t p-3">
        <div class="flex items-center gap-3 px-2 pb-2">
          <span
            class="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground"
            aria-hidden="true"
          >
            {{ userInitials }}
          </span>
          <div class="min-w-0">
            <p class="truncate text-sm font-semibold text-slate-900" data-testid="sidebar-user">{{ userName }}</p>
            <p v-if="authStore.user?.email" class="truncate text-xs text-slate-500">{{ authStore.user.email }}</p>
          </div>
        </div>
        <button
          type="button"
          data-testid="change-password"
          class="flex min-h-10 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
          @click="isChangePasswordOpen = true"
        >
          <AppIcon name="key" :size="18" class="text-slate-500" />
          Alterar senha
        </button>
        <button
          type="button"
          data-testid="two-factor"
          class="flex min-h-10 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
          @click="isTwoFactorOpen = true"
        >
          <AppIcon name="shield" :size="18" class="text-slate-500" />
          Verificação em duas etapas
        </button>
      </div>
    </aside>

    <div class="flex min-w-0 flex-1 flex-col">
      <header class="app-chrome sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-white/95 px-3 backdrop-blur sm:px-5 lg:px-8">
        <button
          ref="menuButton"
          type="button"
          class="-ml-1 flex size-10 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100 lg:hidden"
          aria-label="Abrir menu"
          aria-controls="app-sidebar"
          :aria-expanded="drawerOpen"
          data-testid="menu-toggle"
          @click="openDrawer"
        >
          <AppIcon name="menu" :size="22" />
        </button>
        <img src="/logo.png" alt="" width="1550" height="312" class="h-6 w-auto object-contain lg:hidden" />
        <p v-if="pageLabel" class="hidden min-w-0 truncate text-sm font-semibold text-slate-700 lg:block" data-testid="topbar-page">
          {{ pageLabel }}
        </p>
        <div class="ml-auto flex items-center gap-1 sm:gap-2">
          <span class="hidden max-w-[14rem] truncate text-sm text-slate-600 sm:block" data-testid="topbar-user">{{ userName }}</span>
          <span
            class="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground sm:hidden"
            aria-hidden="true"
          >
            {{ userInitials }}
          </span>
          <button
            type="button"
            class="btn btn-secondary btn-sm min-h-10 sm:min-h-9"
            data-testid="logout"
            @click="handleLogout"
          >
            <AppIcon name="logout" :size="16" />
            Sair
          </button>
        </div>
      </header>

      <main id="conteudo" tabindex="-1" class="app-main min-w-0 flex-1 outline-none">
        <div class="page-enter mx-auto max-w-7xl px-3 py-5 sm:px-5 sm:py-6 lg:px-8 lg:py-8">
          <div
            v-if="showTwoFactorNudge"
            role="note"
            data-testid="two-factor-nudge"
            class="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900"
          >
            <span>Recomendado: ative a verificação em duas etapas.</span>
            <button type="button" class="min-h-10 font-semibold underline" @click="isTwoFactorOpen = true">Ativar agora</button>
          </div>
          <p v-if="mustChangePassword" role="alert" data-testid="must-change-password" class="text-sm text-slate-600">
            Altere a senha provisória na janela aberta para liberar o admin.
          </p>
          <RouterView v-else />
        </div>
      </main>
    </div>

    <ChangePasswordModal v-if="mustChangePassword" forced @close="() => undefined" />
    <ChangePasswordModal v-else-if="isChangePasswordOpen" @close="isChangePasswordOpen = false" />
    <TwoFactorModal v-if="isTwoFactorOpen && !mustChangePassword" @close="isTwoFactorOpen = false" />
    <TermsGateModal v-if="needsTerms" @logout="handleLogout" />
  </div>
</template>
