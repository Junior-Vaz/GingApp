import { afterEach, describe, expect, it, vi } from 'vitest'
import DuplicatePeopleView from '@/views/DuplicatePeopleView.vue'
import { flushPromises, makeUser, mockFetch, mountView, type Call } from './helpers'

const GROUP = {
  key: 'ana-aluna|2010-05-04',
  birthDate: '2010-05-04',
  people: [
    {
      id: 1,
      gingappCode: 'GNG-AAAA',
      name: 'Ana Aluna',
      birthDate: '2010-05-04',
      documentKind: 'CPF',
      documentMasked: '***.456.789-**',
      hasLogin: true,
      createdAt: '2026-01-10T12:00:00.000Z',
      enrollments: [{ studentId: 10, status: 'ACTIVE', organization: { id: 3, name: 'Grupo Um' } }],
    },
    {
      id: 2,
      gingappCode: 'GNG-BBBB',
      name: 'Ana Aluna',
      birthDate: '2010-05-04',
      documentKind: null,
      documentMasked: null,
      hasLogin: false,
      createdAt: '2026-02-10T12:00:00.000Z',
      enrollments: [{ studentId: 11, status: 'INACTIVE', organization: { id: 4, name: 'Grupo Dois' } }],
    },
  ],
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('DuplicatePeopleView (Duplicatas de fichas)', () => {
  it('lista os grupos, compara as fichas e mescla com confirmação irreversível', async () => {
    let merged = false
    const { calls } = mockFetch((call: Call) => {
      if (call.path === '/people/duplicates') {
        return { body: merged ? { total: 0, groups: [] } : { total: 1, groups: [GROUP] } }
      }
      if (call.path === '/people/merge' && call.method === 'POST') {
        merged = true
        return { body: { person: { id: 1, gingappCode: 'GNG-AAAA', name: 'Ana Aluna' }, mergedPersonId: 2, movedStudents: 1 } }
      }
      return undefined
    })
    const { wrapper } = await mountView(DuplicatePeopleView)

    expect(wrapper.get('h1').text()).toBe('Duplicatas de fichas')
    expect(wrapper.get('[data-testid="person-1"]').text()).toContain('GNG-AAAA')
    expect(wrapper.get('[data-testid="person-1"]').text()).toContain('***.456.789-**')
    expect(wrapper.get('[data-testid="person-1"]').text()).toContain('04/05/2010')
    expect(wrapper.get('[data-testid="person-2"]').text()).toContain('Grupo Dois')

    await wrapper.get('[data-testid="merge-open"]').trigger('click')
    expect(wrapper.get('[data-testid="merge-dialog"]').text()).toContain('IRREVERSÍVEL')
    expect(wrapper.get('[data-testid="confirm-keep"]').text()).toContain('GNG-AAAA')
    expect(wrapper.get('[data-testid="confirm-merge"]').text()).toContain('GNG-BBBB')

    await wrapper.get('[data-testid="merge-confirm"]').trigger('click')
    await flushPromises()
    const post = calls.find((c) => c.method === 'POST') as Call
    expect(post.body).toEqual({ keepId: 1, mergeId: 2 })
    expect(wrapper.get('[data-testid="merge-notice"]').text()).toContain('Matrículas movidas: 1')
    expect(wrapper.find('[data-testid="empty"]').exists()).toBe(true)
    expect(calls.filter((c) => c.path === '/people/duplicates')).toHaveLength(2)
  })

  it('409 PERSON_MERGE_SAME_GROUP mostra a mensagem em português', async () => {
    mockFetch((call: Call) => {
      if (call.path === '/people/duplicates') return { body: { total: 1, groups: [GROUP] } }
      if (call.path === '/people/merge') {
        return {
          status: 409,
          body: {
            statusCode: 409,
            error: 'Conflict',
            code: 'PERSON_MERGE_SAME_GROUP',
            message: 'same group',
            organizations: [{ id: 3, name: 'Grupo Um' }],
          },
        }
      }
      return undefined
    })
    const { wrapper } = await mountView(DuplicatePeopleView)
    await wrapper.get('[data-testid="merge-open"]').trigger('click')
    await wrapper.get('[data-testid="merge-confirm"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="merge-error"]').text()).toBe(
      'As duas fichas têm matrícula no mesmo grupo (Grupo Um); resolva no grupo antes de mesclar.',
    )
    expect(wrapper.find('[data-testid="merge-dialog"]').exists()).toBe(false)
  })

  it('lista vazia mostra o estado vazio; erro de carga mostra alerta', async () => {
    mockFetch((call: Call) => (call.path === '/people/duplicates' ? { body: { total: 0, groups: [] } } : undefined))
    const { wrapper } = await mountView(DuplicatePeopleView)
    expect(wrapper.get('[data-testid="empty"]').text()).toContain('Nenhuma duplicata')
    wrapper.unmount()

    mockFetch(() => ({ status: 500, body: { message: 'Falha interna' } }))
    const second = await mountView(DuplicatePeopleView)
    expect(second.wrapper.get('[data-testid="load-error"]').text()).toContain('Falha interna')
  })

  it('PLATFORM sem super admin não carrega nem mescla', async () => {
    const { calls } = mockFetch(() => ({ body: { total: 0, groups: [] } }))
    const { wrapper } = await mountView(DuplicatePeopleView, makeUser({ id: 2, isSuperAdmin: false }))
    expect(wrapper.find('[data-testid="readonly-note"]').exists()).toBe(true)
    expect(calls).toHaveLength(0)
  })
})
