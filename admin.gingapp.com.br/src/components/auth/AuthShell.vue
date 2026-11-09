<script setup lang="ts">
// Moldura das telas de acesso (login, esqueci/redefinir senha): no desktop dois painéis (marca + cartão),
// no celular só o cartão com a marca no topo. Mesma linguagem do login do painel, em versão "equipe interna".
import AppIcon, { type IconName } from '@/components/ui/AppIcon.vue'

const BENEFITS: ReadonlyArray<{ icon: IconName; text: string }> = [
  { icon: 'groups', text: 'Grupos, planos e assinaturas da plataforma' },
  { icon: 'inbox', text: 'Pedidos de adesão e decisões da equipe' },
  { icon: 'finance', text: 'Livro-caixa e transparência financeira' },
  { icon: 'lgpd', text: 'Auditoria de ações sensíveis e pedidos LGPD' },
]
</script>

<template>
  <div class="min-h-screen bg-white lg:grid lg:grid-cols-2">
    <!-- Desktop: marca e o que o admin faz. -->
    <aside
      class="relative hidden flex-col justify-between overflow-hidden border-r px-12 py-12 lg:flex"
      data-testid="login-benefits"
    >
      <div
        class="pointer-events-none absolute -left-24 -top-24 size-96 rounded-full bg-secondary/70 blur-3xl"
        aria-hidden="true"
      />
      <img src="/logo.png" alt="GingApp" width="1550" height="312" class="relative h-11 w-auto self-start object-contain" />
      <div class="auth-enter relative">
        <h2 class="max-w-md text-3xl font-extrabold leading-tight text-slate-900">Central da equipe GingApp.</h2>
        <ul class="mt-8 grid max-w-md gap-4">
          <li v-for="benefit in BENEFITS" :key="benefit.text" class="flex items-center gap-3 text-base text-slate-700">
            <span class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
              <AppIcon :name="benefit.icon" :size="20" />
            </span>
            {{ benefit.text }}
          </li>
        </ul>
      </div>
      <p class="relative text-sm text-slate-500">Acesso restrito à equipe interna da plataforma.</p>
    </aside>

    <div class="flex min-h-screen flex-col items-center justify-center px-4 py-8 sm:px-5 lg:min-h-0 lg:px-12">
      <div class="auth-enter w-full max-w-sm">
        <div class="mb-6 flex flex-col items-center gap-3 text-center lg:hidden">
          <img src="/logo.png" alt="GingApp" width="1550" height="312" class="h-11 w-auto object-contain" />
        </div>
        <div class="rounded-xl border bg-white p-6 shadow-md sm:p-7">
          <slot />
        </div>
        <slot name="footer" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.auth-enter {
  animation: auth-enter 0.45s cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes auth-enter {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .auth-enter {
    animation: none;
  }
}
</style>
