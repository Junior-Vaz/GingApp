import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'

import LoginView from '../views/LoginView.vue'
import MobileLayout from '../components/layout/MobileLayout.vue'
import HomeView from '../views/HomeView.vue'
import JornadaView from '../views/JornadaView.vue'
import AulasView from '../views/AulasView.vue'
import FrequenciaView from '../views/FrequenciaView.vue'
import FinanceiroView from '../views/FinanceiroView.vue'
import EventosView from '../views/EventosView.vue'
import RodasView from '../views/RodasView.vue'
import ComunidadeView from '../views/ComunidadeView.vue'
import NotificacoesView from '../views/NotificacoesView.vue'
import PerfilView from '../views/PerfilView.vue'
import CertificateVerificationView from '../views/CertificateVerificationView.vue'
import PassportVerificationView from '../views/PassportVerificationView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: LoginView,
      meta: { requiresAuth: false },
    },
    {
      // Aberta pelo QR Code de um certificado físico/PDF — quem escaneia não tem (nem
      // precisa ter) conta GingApp, por isso fora do /app autenticado.
      path: '/verificar/:code',
      name: 'verify-certificate',
      component: CertificateVerificationView,
      meta: { requiresAuth: false },
    },
    {
      // Aberta pelo QR Code do Passaporte compartilhado — mesmo motivo do certificado acima.
      path: '/verificar-passaporte/:code',
      name: 'verify-passport',
      component: PassportVerificationView,
      meta: { requiresAuth: false },
    },
    {
      path: '/app',
      component: MobileLayout,
      meta: { requiresAuth: true },
      children: [
        { path: '', name: 'home', component: HomeView },
        { path: 'jornada', name: 'jornada', component: JornadaView },
        { path: 'aulas', name: 'aulas', component: AulasView },
        { path: 'frequencia', name: 'frequencia', component: FrequenciaView },
        { path: 'financeiro', name: 'financeiro', component: FinanceiroView },
        { path: 'eventos', name: 'eventos', component: EventosView },
        { path: 'rodas', name: 'rodas', component: RodasView },
        { path: 'comunidade', name: 'comunidade', component: ComunidadeView },
        { path: 'notificacoes', name: 'notificacoes', component: NotificacoesView },
        { path: 'perfil', name: 'perfil', component: PerfilView },
      ],
    },
    { path: '/', redirect: '/app' },
    { path: '/:pathMatch(.*)*', redirect: '/app' },
  ],
})

// Guard simples: sem token → /login. Autorização real é sempre validada no
// backend (mesmo padrão do painel/admin — ver PLANO_PROJETO.md §5.3).
router.beforeEach((to) => {
  const auth = useAuthStore()

  if (to.meta.requiresAuth !== false && !auth.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }

  if (to.name === 'login' && auth.isAuthenticated) {
    return { path: '/app' }
  }

  return true
})

export default router
