import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean
    navLabel?: string
  }
}

export const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    meta: { requiresAuth: false },
  },
  {
    path: '/termos',
    name: 'terms',
    component: () => import('@/views/LegalView.vue'),
    props: { type: 'terms' },
    meta: { requiresAuth: false },
  },
  {
    path: '/privacidade',
    name: 'privacy',
    component: () => import('@/views/LegalView.vue'),
    props: { type: 'privacy' },
    meta: { requiresAuth: false },
  },
  {
    path: '/',
    redirect: '/dashboard',
  },
  {
    path: '/dashboard',
    name: 'dashboard',
    component: () => import('@/views/DashboardView.vue'),
    meta: { requiresAuth: true, navLabel: 'Dashboard' },
  },
  {
    path: '/organizations',
    name: 'organizations',
    component: () => import('@/views/OrganizationsView.vue'),
    meta: { requiresAuth: true, navLabel: 'Organizations' },
  },
  {
    path: '/organizations/:id',
    name: 'organization-detail',
    component: () => import('@/views/OrganizationDetailView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/plans',
    name: 'plans',
    component: () => import('@/views/PlansView.vue'),
    meta: { requiresAuth: true, navLabel: 'Plans' },
  },
  {
    path: '/team',
    name: 'team',
    component: () => import('@/views/TeamView.vue'),
    meta: { requiresAuth: true, navLabel: 'Team' },
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@/views/SettingsView.vue'),
    meta: { requiresAuth: true, navLabel: 'Settings' },
  },
  {
    path: '/announcements',
    name: 'announcements',
    component: () => import('@/views/AnnouncementsView.vue'),
    meta: { requiresAuth: true, navLabel: 'Announcements' },
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

export default router
