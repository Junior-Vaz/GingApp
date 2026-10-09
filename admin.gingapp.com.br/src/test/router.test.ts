import { describe, expect, it } from 'vitest'
import router, { routes } from '@/router'

describe('router do admin', () => {
  it('não tem mais a rota nem o item de menu "Audit"', () => {
    expect(routes.find((r) => r.path === '/audit')).toBeUndefined()
    const labels = routes.filter((r) => r.meta?.navLabel).map((r) => r.meta!.navLabel)
    expect(labels).toEqual(['Dashboard', 'Organizations', 'Plans', 'Team', 'Settings', 'Announcements'])
  })

  it('"/" e rotas desconhecidas (como /audit) caem no dashboard', () => {
    expect(router.resolve('/').fullPath).toBe('/') // redirect é aplicado na navegação
    const root = routes.find((r) => r.path === '/')
    expect(root?.redirect).toBe('/dashboard')
    const fallback = routes.find((r) => r.path === '/:pathMatch(.*)*')
    expect(fallback?.redirect).toBe('/dashboard')
    expect(router.resolve('/audit').matched[0].path).toBe('/:pathMatch(.*)*')
  })
})
