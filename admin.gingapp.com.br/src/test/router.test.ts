import { describe, expect, it } from 'vitest'
import router, { routes } from '@/router'

describe('router do admin', () => {
  it('tem a rota /audit e o item de menu "Auditoria" (em português)', () => {
    expect(routes.find((r) => r.path === '/audit')?.name).toBe('audit')
    const labels = routes.filter((r) => r.meta?.navLabel).map((r) => r.meta!.navLabel)
    expect(labels).toEqual(['Painel', 'Grupos', 'Planos', 'Equipe', 'Configurações', 'Avisos', 'Auditoria', 'Pedidos LGPD'])
  })

  it('"/" e rotas desconhecidas (como /logs) caem no dashboard', () => {
    expect(router.resolve('/').fullPath).toBe('/') // redirect é aplicado na navegação
    const root = routes.find((r) => r.path === '/')
    expect(root?.redirect).toBe('/dashboard')
    const fallback = routes.find((r) => r.path === '/:pathMatch(.*)*')
    expect(fallback?.redirect).toBe('/dashboard')
    expect(router.resolve('/logs').matched[0].path).toBe('/:pathMatch(.*)*')
  })
})
