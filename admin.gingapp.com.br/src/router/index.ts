import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean
    navLabel?: string
    /** Título da aba do navegador quando a rota não tem navLabel. */
    title?: string
  }
}

export const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    meta: { requiresAuth: false, title: 'Entrar' },
  },
  {
    path: '/esqueci-senha',
    name: 'forgot-password',
    component: () => import('@/views/ForgotPasswordView.vue'),
    meta: { requiresAuth: false },
  },
  {
    path: '/redefinir-senha',
    name: 'reset-password',
    component: () => import('@/views/ResetPasswordView.vue'),
    meta: { requiresAuth: false },
  },
  {
    path: '/termos',
    name: 'terms',
    component: () => import('@/views/LegalView.vue'),
    props: { type: 'terms' },
    meta: { requiresAuth: false, title: 'Termos de Uso' },
  },
  {
    path: '/privacidade',
    name: 'privacy',
    component: () => import('@/views/LegalView.vue'),
    props: { type: 'privacy' },
    meta: { requiresAuth: false, title: 'Política de Privacidade' },
  },
  {
    path: '/',
    redirect: '/dashboard',
  },
  {
    path: '/dashboard',
    name: 'dashboard',
    component: () => import('@/views/DashboardView.vue'),
    meta: { requiresAuth: true, navLabel: 'Painel' },
  },
  {
    path: '/organizations',
    name: 'organizations',
    component: () => import('@/views/OrganizationsView.vue'),
    meta: { requiresAuth: true, navLabel: 'Grupos' },
  },
  {
    path: '/organizations/:id',
    name: 'organization-detail',
    component: () => import('@/views/OrganizationDetailView.vue'),
    meta: { requiresAuth: true, title: 'Grupo' },
  },
  {
    path: '/plans',
    name: 'plans',
    component: () => import('@/views/PlansView.vue'),
    meta: { requiresAuth: true, navLabel: 'Planos' },
  },
  {
    path: '/team',
    name: 'team',
    component: () => import('@/views/TeamView.vue'),
    meta: { requiresAuth: true, navLabel: 'Equipe' },
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@/views/SettingsView.vue'),
    meta: { requiresAuth: true, navLabel: 'Configurações' },
  },
  {
    path: '/announcements',
    name: 'announcements',
    component: () => import('@/views/AnnouncementsView.vue'),
    meta: { requiresAuth: true, navLabel: 'Avisos' },
  },
  {
    path: '/audit',
    name: 'audit',
    component: () => import('@/views/AuditView.vue'),
    meta: { requiresAuth: true, navLabel: 'Auditoria' },
  },
  {
    path: '/lgpd',
    name: 'lgpd',
    component: () => import('@/views/DataDeletionRequestsView.vue'),
    meta: { requiresAuth: true, navLabel: 'Pedidos LGPD' },
  },
  {
    path: '/duplicates',
    name: 'duplicates',
    component: () => import('@/views/DuplicatePeopleView.vue'),
    meta: { requiresAuth: true, navLabel: 'Duplicatas' },
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/dashboard',
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

/**
 * Guard simples (padrão GestorPrint, PLANO_PROJETO.md §5.3): sem token →
 * redireciona para /login; com token acessando /login → redireciona para
 * /dashboard. A autorização real (PlatformOnlyGuard, RBAC) é sempre
 * validada no backend.
 */
router.beforeEach((to) => {
  const authStore = useAuthStore()

  if (to.meta.requiresAuth !== false && !authStore.isAuthenticated) {
    return { name: 'login' }
  }

  if (to.name === 'login' && authStore.isAuthenticated) {
    return { name: 'dashboard' }
  }

  return true
})

/** Título da aba: "<tela> · Admin GingApp" (só texto exibido; nomes e caminhos das rotas não mudam). */
router.afterEach((to) => {
  const page = to.meta.navLabel ?? to.meta.title
  document.title = page ? `${page} · Admin GingApp` : 'Admin GingApp'
})

export default router
