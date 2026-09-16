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
    path: '/alunos',
    name: 'alunos',
    component: () => import('@/views/AlunosView.vue'),
    meta: { requiresAuth: true, navLabel: 'Alunos' },
  },
  {
    path: '/professores',
    name: 'professores',
    component: () => import('@/views/ProfessoresView.vue'),
    meta: { requiresAuth: true, navLabel: 'Professores' },
  },
  {
    path: '/turmas',
    name: 'turmas',
    component: () => import('@/views/TurmasView.vue'),
    meta: { requiresAuth: true, navLabel: 'Turmas' },
  },
  {
    path: '/aulas',
    name: 'aulas',
    component: () => import('@/views/AulasView.vue'),
    meta: { requiresAuth: true, navLabel: 'Aulas' },
  },
  {
    path: '/frequencia',
    name: 'frequencia',
    component: () => import('@/views/FrequenciaView.vue'),
    meta: { requiresAuth: true, navLabel: 'Frequência' },
  },
  {
    path: '/graduacoes',
    name: 'graduacoes',
    component: () => import('@/views/GraduacoesView.vue'),
    meta: { requiresAuth: true, navLabel: 'Graduações' },
  },
  {
    path: '/financeiro',
    name: 'financeiro',
    component: () => import('@/views/FinanceiroView.vue'),
    meta: { requiresAuth: true, navLabel: 'Financeiro' },
  },
  {
    path: '/eventos',
    name: 'eventos',
    component: () => import('@/views/EventosView.vue'),
    meta: { requiresAuth: true, navLabel: 'Eventos' },
  },
  {
    path: '/rodas',
    name: 'rodas',
    component: () => import('@/views/RodasView.vue'),
    meta: { requiresAuth: true, navLabel: 'Rodas' },
  },
  {
    path: '/comunicados',
    name: 'comunicados',
    component: () => import('@/views/ComunicadosView.vue'),
    meta: { requiresAuth: true, navLabel: 'Comunicados' },
  },
  {
    path: '/relatorios',
    name: 'relatorios',
    component: () => import('@/views/RelatoriosView.vue'),
    meta: { requiresAuth: true, navLabel: 'Relatórios' },
  },
  {
    path: '/unidades',
    name: 'unidades',
    component: () => import('@/views/UnidadesView.vue'),
    meta: { requiresAuth: true, navLabel: 'Unidades' },
  },
  {
    path: '/configuracoes',
    name: 'configuracoes',
    component: () => import('@/views/ConfiguracoesView.vue'),
    meta: { requiresAuth: true, navLabel: 'Configurações' },
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
 * /dashboard. A autorização real (RBAC, isolamento por organização) é
 * sempre validada no backend.
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
