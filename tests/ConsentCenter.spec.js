// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application
import { ref, nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { createSarafanVuetify } from '../src/plugins/vuetify.js'
import ConsentCenter from '../src/components/ConsentCenter.vue'
import SiteFooter from '../src/components/SiteFooter.vue'
import UiDialog from '../src/components/ui/UiDialog.vue'
import LegalDocumentReader from '../src/components/LegalDocumentReader.vue'
import { createAppRouter } from '../src/router.js'
import { createInternalProblem } from '../src/errors/problem.js'
import { problem as coreProblem } from './fixtures/http.js'
import { ProblemError } from '../src/errors/problem.js'
import { LEGAL_DOCUMENT_KIND } from '../src/consentFormatting.js'
const h = vi.hoisted(() => ({ session:{}, store:{} }))
vi.mock('../src/stores/session.js', () => ({ useSession:() => h.session }))
vi.mock('../src/stores/consents.js', () => ({ useConsents:() => h.store }))
const id = '11111111-1111-1111-1111-111111111111'
const document = { id, kind:1, title:'Согласие', displayVersion:'2', contentHash:'a'.repeat(64), html:'<p>Отдельный текст согласия.</p>', effectiveAt:'2026-09-07T09:00:00Z' }
const kinds = [
  { value:1, name:'Согласие на обработку персональных данных', routeAlias:'personal-data-consent' },
  { value:2, name:'Пользовательское соглашение', routeAlias:'user-agreement' },
]
const denied = () => createInternalProblem('serviceUnavailable')
function deferred() {
  let resolve
  let reject
  const promise = new Promise((accept, decline) => { resolve = accept; reject = decline })
  return { promise, resolve, reject }
}
let wrapper
let router
const state = () => wrapper.vm.$.setupState
const button = text => wrapper.findAll('button').find(x => x.text() === text)
async function click(text) { expect(button(text), text).toBeTruthy(); await button(text).trigger('click'); await flushPromises() }
async function mountCenter(path = '/', attachToDocument = false) {
  router = createAppRouter(createMemoryHistory())
  await router.push(path)
  const mode = path.startsWith('/legal/') ? 'legal' : path.startsWith('/consents') ? 'consents' : 'notice'
  const section = path === '/consents/personal-data' ? 'personal' : 'auto'
  wrapper = mount(ConsentCenter, {
    props:{ mode, section },
    ...(attachToDocument ? { attachTo:globalThis.document.body } : {}),
    global:{ plugins:[createSarafanVuetify(), router], stubs:{ VDialog:{ props:['modelValue'], template:'<section v-if="modelValue"><slot /></section>' } } }
  })
  return wrapper
}
beforeEach(() => {
  h.session.customer = ref(null)
  Object.assign(h.store, {
    mine:ref(null), ops:ref({ kinds }), opsProblem:ref(null), personalProblem:ref(null),
    current:vi.fn().mockResolvedValue({ document }), read:vi.fn().mockResolvedValue(document), source:vi.fn().mockResolvedValue(new globalThis.Blob(['text'])),
    loadOps:vi.fn().mockResolvedValue({ kinds }), ensureOps:vi.fn().mockResolvedValue({ kinds }),
    kindByAlias:vi.fn(alias => kinds.find(item => item.routeAlias === alias)?.value),
    kindName:vi.fn(kind => kinds.find(item => item.value === kind)?.name),
    routeAlias:vi.fn(kind => kinds.find(item => item.value === kind)?.routeAlias),
    loadMine:vi.fn().mockResolvedValue(),
    acquireNoticeSuppression:vi.fn(() => vi.fn()),
    missingKinds:vi.fn(async requested => {
      await h.store.loadMine()
      return requested.filter(kind => h.store.mine.value?.statuses.find(row => row.kind === kind)?.status !== 'current')
    }),
    grant:vi.fn(async artifact => {
      const row = h.store.mine.value.statuses.find(row => row.kind === artifact.kind)
      row.status = 'current'
    }), requestWithdrawal:vi.fn().mockResolvedValue(), resetCustomer:vi.fn(), dispose:vi.fn()
  })
  globalThis.history.replaceState(null, '', '/')
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:test'); globalThis.URL.revokeObjectURL = vi.fn()
  vi.spyOn(globalThis.HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})
afterEach(() => { wrapper?.unmount(); vi.useRealTimers(); vi.restoreAllMocks(); globalThis.history.replaceState(null, '', '/') })

it('loads legal footer links on a fresh anonymous public visit', async () => {
  h.store.ops.value = null
  h.store.loadOps.mockImplementation(async () => { h.store.ops.value = { kinds } })
  await mountCenter(); await flushPromises()
  const footer = mount(SiteFooter, { global:{ plugins:[router] } })
  try {
    expect(h.store.loadOps).toHaveBeenCalledTimes(1)
    expect(h.store.loadMine).not.toHaveBeenCalled()
    expect(footer.findAll('nav a').map(link => link.attributes('href'))).toEqual(kinds.map(kind => `/legal/${kind.routeAlias}`))
  } finally { footer.unmount() }
})
it.each(['/consents', '/consents/personal-data'])(
  'loads legal footer links on a fresh anonymous visit to %s',
  async path => {
    h.store.ops.value = null
    h.store.loadOps.mockImplementation(async () => { h.store.ops.value = { kinds } })
    await mountCenter(path); await flushPromises()
    const footer = mount(SiteFooter, { global:{ plugins:[router] } })
    try {
      expect(h.store.loadOps).toHaveBeenCalledTimes(1)
      expect(h.store.loadMine).not.toHaveBeenCalled()
      expect(footer.findAll('nav a').map(link => link.attributes('href'))).toEqual(kinds.map(kind => `/legal/${kind.routeAlias}`))
    } finally { footer.unmount() }
  }
)
it('presents and retries a legal catalogue failure on an anonymous consent page', async () => {
  h.store.opsProblem.value = denied()
  h.store.loadOps.mockRejectedValueOnce(denied()).mockImplementation(async () => {
    h.store.opsProblem.value = null
  })
  await mountCenter('/consents'); await flushPromises()
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(false)
  expect(wrapper.find('.consent-page').exists()).toBe(true)
  expect(wrapper.get('.consent-page__alert').text())
    .toBe('Сервис временно недоступен. Пожалуйста, повторите позже')
  expect(wrapper.find('.consent-page__alert strong').exists()).toBe(false)
  await click('Повторить')
  expect(h.store.loadOps).toHaveBeenCalledTimes(2)
  expect(h.store.loadMine).not.toHaveBeenCalled()
  expect(wrapper.find('.consent-page__alert').exists()).toBe(false)
})
it('recovers a stale catalogue failure and retries a new failure without a customer', async () => {
  h.store.opsProblem.value = denied()
  h.store.loadOps.mockRejectedValueOnce(denied()).mockImplementation(async () => {
    h.store.opsProblem.value = null
  })
  await mountCenter(); await flushPromises()
  expect(wrapper.find('.consent-recovery-notice').exists()).toBe(true)
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(false)
  await click('Повторить')
  expect(h.store.loadOps).toHaveBeenCalledTimes(2)
  expect(h.store.loadMine).not.toHaveBeenCalled()
  expect(wrapper.find('.consent-recovery-notice').exists()).toBe(false)
})
it('presents malformed HTTP responses with one simple retry message', async () => {
  h.store.opsProblem.value = createInternalProblem('protocolError')
  await mountCenter(); await flushPromises()

  const notice = wrapper.get('.consent-recovery-notice')
  expect(notice.attributes('aria-live')).toBe('polite')
  expect(notice.text()).toContain('Сервис временно недоступен. Пожалуйста, повторите позже')
  expect(notice.text().split('Сервис временно недоступен. Пожалуйста, повторите позже')).toHaveLength(2)
  expect(notice.get('.consent-recovery-notice__message').text()).toBe('Сервис временно недоступен. Пожалуйста, повторите позже')
  expect(notice.find('.ui-alert').exists()).toBe(false)
  expect(notice.text()).not.toContain('Не удалось обновить согласия')
  expect(notice.text()).not.toContain('Некорректный ответ сервиса')
  expect(notice.text()).not.toContain('неподдерживаемом формате')
  await wrapper.setProps({ noticeSuppressed:true })
  expect(wrapper.find('.consent-recovery-notice').exists()).toBe(false)
  await wrapper.setProps({ noticeSuppressed:false })
  expect(wrapper.find('.consent-recovery-notice').exists()).toBe(true)
})
it('replaces a Core server detail with the safe notice message', async () => {
  const serverProblem = new ProblemError(coreProblem(503, 'core-failed', {
    title:'Ошибка внутреннего сервиса', detail:'Внутренняя диагностическая информация'
  }))
  h.store.opsProblem.value = serverProblem
  h.store.loadOps.mockRejectedValueOnce(serverProblem)
  await mountCenter(); await flushPromises()

  expect(wrapper.get('.consent-recovery-notice__message').text())
    .toBe('Сервис временно недоступен. Пожалуйста, повторите позже')
  expect(wrapper.text()).not.toContain('Внутренняя диагностическая информация')
})

it('does not load customer history after catalogue loading outlives the notice', async () => {
  h.session.customer.value = { id:7 }
  const pending = deferred()
  h.store.loadOps.mockReturnValueOnce(pending.promise)
  await mountCenter(); await nextTick()
  wrapper.unmount()
  pending.resolve({ kinds }); await flushPromises()
  expect(h.store.loadMine).not.toHaveBeenCalled()
})
it('cancels customer-history work when a consent route unmounts', async () => {
  h.session.customer.value = { id:7 }
  await mountCenter('/consents'); await flushPromises()
  h.store.resetCustomer.mockClear()

  wrapper.unmount()

  expect(h.store.resetCustomer).toHaveBeenCalledTimes(1)
})
it.each(['/', '/legal/personal-data-consent'])(
  'does not reset customer history when the %s controller unmounts',
  async path => {
    h.session.customer.value = { id:7 }
    await mountCenter(path); await flushPromises()
    h.store.resetCustomer.mockClear()

    wrapper.unmount()

    expect(h.store.resetCustomer).not.toHaveBeenCalled()
  }
)
it('loads only the legal catalogue for an authenticated notice', async () => {
  h.session.customer.value = { id:7 }
  const pending = deferred()
  h.store.loadOps.mockReturnValueOnce(pending.promise)
  await mountCenter(); await nextTick()
  expect(h.store.loadMine).not.toHaveBeenCalled()
  pending.resolve({ kinds }); await flushPromises()
  expect(h.store.loadMine).not.toHaveBeenCalled()
})
it('does not present a consent-history failure outside consent routes', async () => {
  h.session.customer.value = { id:7 }
  h.store.personalProblem.value = denied()
  await mountCenter()
  await flushPromises()
  expect(h.store.loadMine).not.toHaveBeenCalled()
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(false)
  expect(wrapper.find('.consent-recovery-notice').exists()).toBe(false)
})

it('makes immutable and current legal links available without login as routed pages', async () => {
  await mountCenter('/legal/personal-data-consent'); await flushPromises()
  expect(h.store.current).toHaveBeenCalledWith(LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT)
  expect(wrapper.text()).toContain('Отдельный текст согласия.')
  expect(wrapper.find('.legal-document-page').exists()).toBe(true)
  expect(wrapper.findComponent(UiDialog).exists()).toBe(false)
  expect(button('Скачать Markdown')).toBeUndefined()
  expect(button('Повторить')).toBeUndefined()
  expect(button('На главную')).toBeUndefined()
  expect(button('Печать').classes()).toEqual(expect.arrayContaining(['ui-button--secondary']))
  vi.stubGlobal('print', vi.fn()); await click('Печать'); expect(globalThis.print).toHaveBeenCalled()
  await state().retry()
  h.store.ensureOps.mockClear()
  await router.push(`/legal/${id}`); await flushPromises()
  expect(h.store.read).toHaveBeenCalledWith(id)
  expect(h.store.ensureOps).not.toHaveBeenCalled()
  h.store.current.mockResolvedValue({ document:null })
  await router.push('/legal/personal-data-consent'); await flushPromises()
  expect(wrapper.text()).toContain('Документ пока не действует')
  expect(button('Повторить')).toBeTruthy()
  h.store.current.mockResolvedValue({ document })
  await click('Повторить')
  expect(wrapper.findComponent(LegalDocumentReader).exists()).toBe(true)
  h.store.current.mockRejectedValueOnce(denied()); await router.push('/legal/user-agreement'); await flushPromises()
  expect(wrapper.get('.service-unavailable-page h1').text())
    .toBe('Сервис временно недоступен. Пожалуйста, повторите позже')
  expect(wrapper.find('.service-unavailable-page .ui-alert').exists()).toBe(false)
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(true)
})
it('uses the canonical document heading without adding a competing page h1', async () => {
  h.store.current.mockResolvedValue({
    document:{ ...document, title:'Название документа', html:'<h1>Канонический заголовок</h1><p>Текст.</p>' }
  })
  await mountCenter('/legal/personal-data-consent'); await flushPromises()
  expect(wrapper.get('.consent-page__document-title').text()).toBe('Название документа')
  expect(wrapper.findAll('h1')).toHaveLength(1)
  expect(wrapper.get('h1').text()).toBe('Канонический заголовок')
})
it('provides a semantic route heading when the canonical document has no h1', async () => {
  await mountCenter('/legal/personal-data-consent'); await flushPromises()
  expect(wrapper.findAll('h1')).toHaveLength(1)
  expect(wrapper.get('h1').text()).toBe(document.title)
})
it('keeps a semantic route heading when the canonical document is rejected', async () => {
  h.store.current.mockResolvedValue({ document:{ ...document, html:'<script>alert(1)</script>' } })
  await mountCenter('/legal/personal-data-consent'); await flushPromises()
  expect(wrapper.findAll('h1')).toHaveLength(1)
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(true)
  h.store.current.mockResolvedValue({ document })
  await click('Повторить')
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(false)
  expect(wrapper.findComponent(LegalDocumentReader).exists()).toBe(true)
})
it('falls back safely if defensive legal-heading parsing fails', async () => {
  await mountCenter('/legal/personal-data-consent'); await flushPromises()
  state().document = { ...document, html:'<script>alert(1)</script>' }
  await nextTick()
  expect(state().legalDocumentHasH1).toBe(false)
})
it('rejects invalid legal effective dates before rendering and permits retry', async () => {
  h.store.current.mockResolvedValue({ document:{ ...document, effectiveAt:'not-a-date' } })
  await mountCenter('/legal/personal-data-consent'); await flushPromises()
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(true)
  h.store.current.mockResolvedValue({ document })
  await click('Повторить')
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(false)
  expect(wrapper.findComponent(LegalDocumentReader).exists()).toBe(true)
})
it('refreshes a current legal route at the server document boundary', async () => {
  vi.useFakeTimers()
  const current = { ...document, title:'Текущая версия' }
  const replacement = { ...document, title:'Новая версия' }
  h.store.current
    .mockResolvedValueOnce({
      document:current,
      serverNow:'2026-09-10T08:00:00.000Z',
      nextChangeAt:'2026-09-10T08:00:00.100Z'
    })
    .mockResolvedValue({ document:replacement, serverNow:'2026-09-10T08:00:00.100Z', nextChangeAt:null })
  await mountCenter('/legal/personal-data-consent'); await flushPromises()
  expect(wrapper.get('.consent-page__document-title').text()).toBe('Текущая версия')
  await vi.advanceTimersByTimeAsync(100)
  await flushPromises()
  expect(wrapper.get('.consent-page__document-title').text()).toBe('Новая версия')
  expect(h.store.current).toHaveBeenCalledTimes(2)
  vi.useRealTimers()
})
it('recovers a not-yet-effective legal route at its server boundary', async () => {
  const replacement = { ...document, title:'Версия после границы' }
  h.store.current
    .mockResolvedValueOnce({
      document:null,
      serverNow:'2026-09-10T08:00:00.000Z',
      nextChangeAt:'2026-09-10T08:00:00.100Z'
    })
    .mockResolvedValue({ document:replacement, serverNow:'2026-09-10T08:00:00.100Z', nextChangeAt:null })
  await mountCenter('/legal/personal-data-consent'); await flushPromises()
  expect(wrapper.text()).toContain('Документ пока не действует')
  await vi.waitFor(() => expect(wrapper.get('.consent-page__document-title').text()).toBe('Версия после границы'))
  expect(h.store.current).toHaveBeenCalledTimes(2)
})
it('rejects a non-future legal document boundary as a protocol outage', async () => {
  h.store.current.mockResolvedValue({
    document,
    serverNow:'2026-09-10T08:00:00Z',
    nextChangeAt:'2026-09-10T08:00:00Z'
  })
  await mountCenter('/legal/personal-data-consent'); await flushPromises()
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(true)
})
it('loads a legal document without associating the authenticated browser', async () => {
  h.session.customer.value = { id:7 }
  await mountCenter('/legal/personal-data-consent'); await flushPromises()
  expect(h.store).not.toHaveProperty('associate')
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(false)
  expect(wrapper.findComponent(LegalDocumentReader).exists()).toBe(true)
})
it('removes foreground listeners when a pending mount load is unmounted', async () => {
  const pending = deferred()
  h.store.current.mockImplementationOnce(() => pending.promise)
  vi.spyOn(globalThis.document, 'visibilityState', 'get').mockReturnValue('visible')
  await mountCenter('/legal/personal-data-consent'); await nextTick()
  wrapper.unmount()
  pending.resolve({ document }); await flushPromises()
  h.store.current.mockClear()
  globalThis.dispatchEvent(new globalThis.Event('focus')); await flushPromises()
  globalThis.document.dispatchEvent(new globalThis.Event('visibilitychange')); await flushPromises()
  expect(h.store.current).not.toHaveBeenCalled()
})
it('ignores a stale document response after route changes and refreshes the routed document on foreground', async () => {
  let resolve
  const historical = { ...document, title:'Исторический документ' }
  h.store.read.mockResolvedValue(historical)
  h.store.current.mockImplementationOnce(() => new Promise(r => { resolve = r }))
  await mountCenter('/legal/personal-data-consent'); await nextTick()
  expect(() => state().printLegal()).not.toThrow()
  await router.push(`/legal/${id}`); await flushPromises()
  resolve({ document }); await flushPromises()
  expect(wrapper.text()).toContain('Исторический документ')
  vi.spyOn(globalThis.document, 'visibilityState', 'get').mockReturnValue('hidden')
  globalThis.document.dispatchEvent(new globalThis.Event('visibilitychange')); expect(h.store).not.toHaveProperty('loadCookies')
  vi.spyOn(globalThis.document, 'visibilityState', 'get').mockReturnValue('visible')
  globalThis.document.dispatchEvent(new globalThis.Event('visibilitychange')); await flushPromises()
  expect(h.store).not.toHaveProperty('loadCookies')
  expect(h.store.read).toHaveBeenCalledTimes(2)
})
it('does not let a stale legal failure replace the newly selected document', async () => {
  const stale = deferred()
  const selected = { ...document, title:'Новый документ' }
  h.store.current
    .mockImplementationOnce(() => stale.promise)
    .mockResolvedValueOnce({ document:selected })
  await mountCenter('/legal/personal-data-consent'); await nextTick()
  await router.push('/legal/user-agreement'); await flushPromises()
  expect(wrapper.get('.consent-page__document-title').text()).toBe('Новый документ')
  stale.reject(denied()); await flushPromises()
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(false)
  expect(wrapper.get('.consent-page__document-title').text()).toBe('Новый документ')
})
it('keeps the replacement legal load current after the previous watcher is cleaned up', async () => {
  const stale = deferred()
  const selected = deferred()
  const replacement = { ...document, title:'Выбранный документ' }
  h.store.current
    .mockImplementationOnce(() => stale.promise)
    .mockImplementationOnce(() => selected.promise)
  await mountCenter('/legal/personal-data-consent'); await nextTick()
  await router.push('/legal/user-agreement'); await nextTick()
  stale.resolve({ document:{ ...document, title:'Устаревший документ' } }); await flushPromises()
  selected.resolve({ document:replacement }); await flushPromises()
  expect(wrapper.get('.consent-page__document-title').text()).toBe('Выбранный документ')
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(false)
})
it('stops a stale legal load after its catalogue request completes', async () => {
  const staleCatalogue = deferred()
  const selected = { ...document, title:'Документ после смены маршрута' }
  h.store.ensureOps
    .mockImplementationOnce(() => staleCatalogue.promise)
    .mockResolvedValueOnce({ kinds })
  h.store.current.mockResolvedValue({ document:selected })
  await mountCenter('/legal/personal-data-consent'); await nextTick()
  await router.push('/legal/user-agreement'); await flushPromises()
  staleCatalogue.resolve({ kinds }); await flushPromises()
  expect(wrapper.get('.consent-page__document-title').text()).toBe('Документ после смены маршрута')
  expect(h.store.current).toHaveBeenCalledTimes(1)
})
it('keeps a pending legal load current when the customer session changes', async () => {
  const pending = deferred()
  h.store.current.mockImplementationOnce(() => pending.promise)
  await mountCenter('/legal/personal-data-consent'); await nextTick()
  h.session.customer.value = { id:7 }
  await nextTick()
  pending.resolve({ document }); await flushPromises()
  expect(wrapper.findComponent(LegalDocumentReader).exists()).toBe(true)
  expect(wrapper.text()).toContain('Отдельный текст согласия.')
  expect(h.store.current).toHaveBeenCalledTimes(1)
})
it('renders a safe alert for rejected canonical HTML', () => {
  wrapper = mount(LegalDocumentReader, { props:{ document:{ ...document, html:'<script>alert(1)</script>' } } })
  expect(wrapper.find('script').exists()).toBe(false)
  expect(wrapper.find('[role=alert]').exists()).toBe(true)
})

it('renders the canonical document heading once and restores focus after a dialog closes', async () => {
  wrapper = mount(LegalDocumentReader, { props:{ document:{ ...document, html:'<h1>Согласие</h1><p>Текст.</p>' } } })
  expect(wrapper.findAll('h1, h2')).toHaveLength(1)
  expect(wrapper.get('h1').text()).toBe('Согласие')
  vi.stubGlobal('print', vi.fn())
  wrapper.vm.printDocument()
  expect(globalThis.print).toHaveBeenCalled()
  wrapper.unmount()

  const opener = globalThis.document.createElement('button')
  globalThis.document.body.append(opener)
  opener.focus()
  wrapper = mount(UiDialog, {
    props:{ modelValue:false, title:'Документ', titleId:'test-dialog-title' },
    slots:{ default:'Текст' },
    global:{ plugins:[createSarafanVuetify()], stubs:{ VDialog:{ props:['modelValue'], template:'<section v-if="modelValue"><slot /></section>' } } }
  })
  await wrapper.setProps({ modelValue:true })
  await wrapper.setProps({ modelValue:false })
  await nextTick()
  expect(globalThis.document.activeElement).toBe(opener)

  await wrapper.setProps({ modelValue:true })
  const HTMLElementCtor = globalThis.HTMLElement
  try {
    vi.stubGlobal('HTMLElement', undefined)
    await wrapper.setProps({ modelValue:false })
    await nextTick()
  } finally {
    vi.stubGlobal('HTMLElement', HTMLElementCtor)
  }
  opener.remove()

  await wrapper.setProps({ modelValue:true, hideHeader:true })
  expect(wrapper.find('.ui-dialog__header').exists()).toBe(false)
})

it('waits for a far-future legal replacement across the browser timer limit', async () => {
  vi.useFakeTimers({ toFake:['setTimeout', 'clearTimeout'] })
  const serverNow = '2026-09-10T08:00:00.000Z'
  const maximumTimerDelay = 2147483647
  const nextChangeAt = new Date(Date.parse(serverNow) + maximumTimerDelay + 100).toISOString()
  h.store.current
    .mockResolvedValueOnce({ document:{ ...document, title:'Текущая версия' }, serverNow, nextChangeAt })
    .mockResolvedValue({ document:{ ...document, title:'Будущая редакция', effectiveAt:nextChangeAt }, serverNow:nextChangeAt, nextChangeAt:null })
  await mountCenter('/legal/user-agreement'); await flushPromises()
  await vi.advanceTimersByTimeAsync(maximumTimerDelay); await flushPromises()
  expect(wrapper.get('.consent-page__document-title').text()).toBe('Текущая версия')
  expect(h.store.current).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(100); await flushPromises()
  expect(wrapper.get('.consent-page__document-title').text()).toBe('Будущая редакция')
  expect(h.store.current).toHaveBeenCalledTimes(2)
})

function customerConsents(statuses = ['renewal-required', 'current']) {
  return {
    customerId:7, serverNow:'2026-10-04T12:00:00Z', nextChangeAt:null,
    statuses:kinds.map((kind, index) => ({
      kind:kind.value, status:statuses[index],
      requiredVersion:statuses[index] === 'unavailable' ? null : id,
      acceptedVersion:null, decidedAt:null
    })),
    history:[], withdrawalRequest:null
  }
}
function authenticate(statuses) {
  h.session.customer.value = { id:7 }
  h.store.mine.value = customerConsents(statuses)
  h.store.current.mockImplementation(async kind => ({
    document:{ ...document, kind, title:kinds.find(row => row.value === kind).name },
    serverNow:'2026-10-04T12:00:00Z', nextChangeAt:null
  }))
}
const withdrawalLabel = 'Прекратить использовать систему и отозвать согласие на хранение и обработку персональных данных'

it.each(['/consents', '/consents/personal-data'])('lists both kinds and current-version links on %s', async path => {
  authenticate()
  await mountCenter(path); await flushPromises()
  expect(wrapper.get('h1').text()).toBe('Согласия')
  expect(wrapper.find('.consent-page__heading button').exists()).toBe(false)
  const rows = wrapper.findAll('.consent-documents__row')
  expect(rows.map(row => row.get('h3').text())).toEqual(kinds.map(kind => kind.name))
  expect(rows[0].text()).toContain('Требуется новое согласие')
  expect(rows[1].text()).toContain('Актуально')
  expect(rows.map(row => row.get('a').attributes('href'))).toEqual(kinds.map(kind => '/legal/' + kind.routeAlias))
  expect(button('Дать согласие')).toBeTruthy()
  expect(button('Принять соглашение')).toBeUndefined()
  expect(wrapper.find('.consent-history-section').element.tagName).toBe('SECTION')
  expect(wrapper.text()).toContain('Записей пока нет.')
  expect(wrapper.findComponent(LegalDocumentReader).exists()).toBe(false)
  expect(h.store.current).not.toHaveBeenCalled()
  const footer = mount(SiteFooter, { props:{ authenticated:true }, global:{ plugins:[router] } })
  try { expect(footer.findAll('a').at(-1).attributes('href')).toBe('/consents') }
  finally { footer.unmount() }
})

it('shows all document kinds in an expanded newest-first history with exact artifact links', async () => {
  authenticate(['current', 'current'])
  const historicId = '22222222-2222-2222-2222-222222222222'
  h.store.mine.value.history = [
    { id:'older', kind:1, decision:'grant', at:'2026-09-09T10:00:00Z', documentId:id, displayVersion:'1' },
    { id:'newer', kind:2, decision:'grant', at:'2026-09-14T20:14:00Z', documentId:historicId, displayVersion:'3' },
    { id:'middle', kind:1, decision:'refuse', at:'2026-09-14T16:05:00Z', documentId:id, displayVersion:'2' }
  ]
  await mountCenter('/consents'); await flushPromises()
  const list = wrapper.get('.consent-history')
  expect(list.element.tagName).toBe('UL')
  expect(list.findAll('strong').map(row => row.text())).toEqual([kinds[1].name, kinds[0].name, kinds[0].name])
  expect(list.findAll('a').map(link => [link.text(), link.attributes('href')])).toEqual([
    ['Версия 3', '/legal/' + historicId], ['Версия 2', '/legal/' + id], ['Версия 1', '/legal/' + id]
  ])
  expect(list.findAll('li')[1].text()).toContain('Отказ')
  expect(list.findAll('li')[0].text()).toContain('14.09.2026, 23:14 МСК')
  expect(wrapper.find('details').exists()).toBe(false)
  await list.get('a').trigger('click'); await flushPromises()
  expect(router.currentRoute.value.params.documentRef).toBe(historicId)
})

it('lists 200 returned decisions without hiding an older current consent status', async () => {
  authenticate(['current', 'current'])
  h.store.mine.value.history = Array.from({ length:200 }, (_, index) => ({
    id:String(index), kind:2, decision:'grant', documentId:id,
    displayVersion:String(index), at:'2026-10-04T12:00:00Z'
  }))
  await mountCenter('/consents'); await flushPromises()
  expect(wrapper.findAll('.consent-history li')).toHaveLength(200)
  expect(wrapper.findAll('.consent-documents__row')[0].text()).toContain('Актуально')
  expect(button('Дать согласие')).toBeUndefined()
})

it('shows unavailable documents without links or renewal actions', async () => {
  authenticate(['unavailable', 'missing'])
  h.store.mine.value.statuses.pop()
  await mountCenter('/consents'); await flushPromises()
  expect(wrapper.findAll('.consent-documents__row').every(row => row.text().includes('Документ недоступен'))).toBe(true)
  expect(wrapper.find('.consent-documents__row a').exists()).toBe(false)
  expect(button('Дать согласие')).toBeUndefined()
  expect(button('Принять соглашение')).toBeUndefined()
})

it('keeps a stable heading and a loading state until the authenticated history arrives', async () => {
  h.session.customer.value = { id:7 }
  const pending = deferred()
  h.store.loadMine.mockReturnValueOnce(pending.promise)
  await mountCenter('/consents'); await nextTick()
  expect(wrapper.get('h1').text()).toBe('Согласия')
  expect(wrapper.get('[aria-label="Загрузка согласий"]').text()).toContain('Загружаем согласия')
  expect(wrapper.text()).not.toContain('Записей пока нет.')
  h.store.mine.value = customerConsents()
  pending.resolve(); await flushPromises()
  expect(wrapper.find('.consent-documents').exists()).toBe(true)
})

it('loads history after session restoration and keeps anonymous direct access', async () => {
  await mountCenter('/consents'); await flushPromises()
  expect(wrapper.text()).toContain('Войдите в аккаунт')
  expect(h.store.loadMine).not.toHaveBeenCalled()
  authenticate()
  await flushPromises()
  expect(h.store.loadMine).toHaveBeenCalledOnce()
  expect(wrapper.find('.consent-documents').exists()).toBe(true)
  expect(button('На главную')).toBeUndefined()
})

it.each([1, 2])('renews only selected kind %s in the shared dialog', async kind => {
  authenticate(['missing', 'renewal-required'])
  await mountCenter('/consents'); await flushPromises()
  const action = kind === 1 ? 'Дать согласие' : 'Принять соглашение'
  await click(action)
  expect(h.store.missingKinds).toHaveBeenCalledWith([kind])
  expect(h.store.current).toHaveBeenCalledWith(kind)
  const choices = wrapper.findAll('.consent-registration input[type="checkbox"]')
  expect(choices).toHaveLength(1)
  expect(choices[0].element.checked).toBe(false)
  expect(button('Подтвердить и продолжить').attributes('disabled')).toBeDefined()
  await click(kinds[kind - 1].name)
  expect(wrapper.findComponent(LegalDocumentReader).exists()).toBe(true)
  await click('Вернуться к подтверждению')
  await wrapper.get('.consent-registration input[type="checkbox"]').setValue(true)
  await click('Подтвердить и продолжить')
  expect(h.store.grant).toHaveBeenCalledWith(expect.objectContaining({ kind, id }), expect.any(String))
  expect(wrapper.find('.consent-registration').exists()).toBe(false)
  expect(h.store.mine.value.statuses[kind - 1].status).toBe('current')
  expect(wrapper.emitted('personal-consent-granted')?.length ?? 0).toBe(kind === 1 ? 1 : 0)
})

it('cancels renewal without granting consent and returns focus to the action', async () => {
  authenticate()
  await mountCenter('/consents', true); await flushPromises()
  button('Дать согласие').element.focus()
  await click('Дать согласие')
  await click('Отмена')
  expect(h.store.grant).not.toHaveBeenCalled()
  expect(wrapper.emitted('personal-consent-granted')).toBeUndefined()
  expect(globalThis.document.activeElement).toBe(button('Дать согласие').element)
  expect(button('Дать согласие').attributes('disabled')).toBeUndefined()
})

it('keeps failed renewal choices and the retry key with one dialog error owner', async () => {
  authenticate()
  h.store.grant.mockRejectedValueOnce(denied())
  await mountCenter('/consents'); await flushPromises()
  await click('Дать согласие')
  await wrapper.get('.consent-registration input[type="checkbox"]').setValue(true)
  await click('Подтвердить и продолжить')
  const firstKey = h.store.grant.mock.calls[0][1]
  expect(wrapper.findAll('.ui-alert')).toHaveLength(1)
  expect(wrapper.find('.consent-page__alert').exists()).toBe(false)
  expect(wrapper.get('.consent-registration input').element.checked).toBe(true)
  await click('Подтвердить и продолжить')
  expect(h.store.grant.mock.calls[1][1]).toBe(firstKey)
  expect(wrapper.emitted('personal-consent-granted')).toHaveLength(1)
})

it('refreshes changed renewal versions without accepting the replacement', async () => {
  authenticate()
  const replacement = { ...document, id:'22222222-2222-2222-2222-222222222222', contentHash:'b'.repeat(64) }
  h.store.grant.mockRejectedValueOnce(new ProblemError(coreProblem(409, 'consent-version-changed')))
  await mountCenter('/consents'); await flushPromises()
  await click('Дать согласие')
  await wrapper.get('.consent-registration input').setValue(true)
  const firstKey = state().renewal.state.documents[0].key
  h.store.current.mockResolvedValue({ document:replacement, serverNow:'2026-10-04T12:00:00Z', nextChangeAt:null })
  await click('Подтвердить и продолжить')
  expect(wrapper.get('.consent-registration input').element.checked).toBe(false)
  expect(state().renewal.state.documents[0].key).not.toBe(firstKey)
  expect(h.store.grant).toHaveBeenCalledOnce()
  expect(wrapper.emitted('personal-consent-granted')).toBeUndefined()
})

it('recovers renewal preparation failures in place', async () => {
  authenticate()
  h.store.current.mockRejectedValueOnce(denied())
  await mountCenter('/consents'); await flushPromises()
  await click('Дать согласие')
  expect(wrapper.get('.consent-page__alert').text()).toBe('Сервис временно недоступен. Пожалуйста, повторите позже')
  expect(wrapper.find('.consent-registration').exists()).toBe(false)
  await click('Повторить')
  expect(wrapper.find('.consent-page__alert').exists()).toBe(false)
  await click('Дать согласие')
  expect(wrapper.find('.consent-registration').exists()).toBe(true)
})

it('ignores a late renewal grant after identity changes', async () => {
  authenticate()
  const pending = deferred()
  h.store.grant.mockReturnValueOnce(pending.promise)
  await mountCenter('/consents'); await flushPromises()
  await click('Дать согласие')
  await wrapper.get('.consent-registration input').setValue(true)
  button('Подтвердить и продолжить').trigger('click')
  await nextTick()
  h.session.customer.value = null
  await flushPromises()
  pending.resolve(); await flushPromises()
  expect(wrapper.find('.consent-registration').exists()).toBe(false)
  expect(wrapper.emitted('personal-consent-granted')).toBeUndefined()
  expect(wrapper.find('.consent-history-section').exists()).toBe(false)
})

it('ignores renewal preparation completed after unmount', async () => {
  authenticate()
  const pending = deferred()
  h.store.current.mockReturnValueOnce(pending.promise)
  await mountCenter('/consents'); await flushPromises()
  button('Дать согласие').trigger('click')
  await nextTick(); await nextTick()
  wrapper.unmount()
  pending.resolve({ document }); await flushPromises()
  expect(h.store.grant).not.toHaveBeenCalled()
  expect(wrapper.emitted('personal-consent-granted')).toBeUndefined()
})

it('owns history failures until recovery and releases notice suppression on unmount', async () => {
  authenticate()
  const release = vi.fn()
  h.store.acquireNoticeSuppression.mockReturnValue(release)
  h.store.loadMine.mockRejectedValueOnce(denied())
  await mountCenter('/consents'); await flushPromises()
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(false)
  expect(wrapper.get('.consent-page__alert').text()).toBe('Сервис временно недоступен. Пожалуйста, повторите позже')
  expect(release).not.toHaveBeenCalled()
  await click('Повторить')
  expect(release).toHaveBeenCalledOnce()
  expect(wrapper.find('.consent-page__alert').exists()).toBe(false)
  h.store.loadMine.mockRejectedValueOnce(denied())
  vi.spyOn(globalThis.document, 'visibilityState', 'get').mockReturnValue('visible')
  globalThis.dispatchEvent(new globalThis.Event('focus')); await flushPromises()
  wrapper.unmount()
  expect(release).toHaveBeenCalledTimes(2)
})

it('does not start customer history after catalogue recovery outlives the page', async () => {
  authenticate()
  const pending = deferred()
  h.store.opsProblem.value = denied()
  h.store.loadOps.mockReturnValueOnce(pending.promise)
  await mountCenter('/consents'); await nextTick()
  wrapper.unmount()
  pending.resolve({ kinds }); await flushPromises()
  expect(h.store.loadMine).not.toHaveBeenCalled()
})

it('discards stale history failures after switching customer identity', async () => {
  authenticate()
  const pending = deferred()
  h.store.loadMine.mockReturnValueOnce(pending.promise)
  await mountCenter('/consents'); await nextTick()
  h.session.customer.value = { id:8 }; await flushPromises()
  pending.reject(denied()); await flushPromises()
  expect(wrapper.find('.consent-page__alert').exists()).toBe(false)
  expect(h.store.loadMine).toHaveBeenCalledTimes(2)
})

it('queues foreground history refresh until renewal is closed', async () => {
  authenticate()
  await mountCenter('/consents'); await flushPromises()
  await click('Дать согласие')
  h.store.loadMine.mockClear()
  vi.spyOn(globalThis.document, 'visibilityState', 'get').mockReturnValue('visible')
  globalThis.dispatchEvent(new globalThis.Event('focus')); await flushPromises()
  expect(h.store.loadMine).not.toHaveBeenCalled()
  await click('Отмена')
  expect(h.store.loadMine).toHaveBeenCalledOnce()
})

it('retains a processing record and disables duplicate withdrawal requests', async () => {
  authenticate()
  h.store.mine.value.withdrawalRequest = { customerId:7, requestedAt:'2026-10-04T10:00:00Z', processed:false }
  await mountCenter('/consents'); await flushPromises()
  expect(button(withdrawalLabel).attributes('disabled')).toBeDefined()
  await state().requestWithdrawal()
  expect(h.store.requestWithdrawal).not.toHaveBeenCalled()
  expect(wrapper.get('.withdrawal-record').text()).toContain('Ожидает ручной обработки')
  h.store.mine.value.withdrawalRequest.processed = true
  await nextTick()
  expect(button(withdrawalLabel).attributes('disabled')).toBeUndefined()
  expect(wrapper.get('.withdrawal-record').text()).toContain('Обработан')
  await click(withdrawalLabel)
  expect(h.store.requestWithdrawal).toHaveBeenCalledOnce()
})

it('refreshes status instead of resubmitting an ambiguous withdrawal failure', async () => {
  authenticate()
  h.store.requestWithdrawal.mockRejectedValueOnce(denied())
  await mountCenter('/consents'); await flushPromises()
  await click(withdrawalLabel)
  expect(wrapper.find('.consent-page__alert').exists()).toBe(true)
  await click('Повторить')
  expect(h.store.requestWithdrawal).toHaveBeenCalledOnce()
  expect(h.store.loadMine).toHaveBeenCalledTimes(2)
  expect(wrapper.find('.consent-page__alert').exists()).toBe(false)
})

it('prevents renewal and withdrawal while another foreground action is pending', async () => {
  authenticate()
  const pending = deferred()
  h.store.requestWithdrawal.mockReturnValueOnce(pending.promise)
  await mountCenter('/consents'); await flushPromises()
  button(withdrawalLabel).trigger('click')
  await nextTick()
  await state().renew(1)
  await state().requestWithdrawal()
  expect(h.store.missingKinds).not.toHaveBeenCalled()
  expect(h.store.requestWithdrawal).toHaveBeenCalledOnce()
  pending.resolve(); await flushPromises()
  h.session.customer.value = null; await flushPromises()
  await state().renew(1)
  await state().requestWithdrawal()
  expect(h.store.missingKinds).not.toHaveBeenCalled()
})

it('keeps Print disabled until the document arrives and places its only action in the header', async () => {
  const pending = deferred()
  h.store.current.mockReturnValueOnce(pending.promise)
  await mountCenter('/legal/user-agreement'); await nextTick()
  expect(button('Печать').attributes('disabled')).toBeDefined()
  pending.resolve({ document }); await flushPromises()
  expect(button('Печать').attributes('disabled')).toBeUndefined()
  expect(wrapper.get('.legal-document-page__heading button').text()).toBe('Печать')
  expect(wrapper.findAll('button').map(item => item.text())).toEqual(['Печать'])
  expect(wrapper.find('.legal-document-page__panel button').exists()).toBe(false)
  expect(wrapper.get('#document-content').findComponent(LegalDocumentReader).exists()).toBe(true)
})

it('uses a UUID read for historical documents and preserves the saved artifact', async () => {
  const artifact = { ...document, displayVersion:'старое', html:'<h1>Архив</h1><p>Сохранённый текст.</p>' }
  h.store.read.mockResolvedValue(artifact)
  await mountCenter('/legal/' + id); await flushPromises()
  expect(h.store.read).toHaveBeenCalledWith(id)
  expect(h.store.current).not.toHaveBeenCalled()
  expect(wrapper.get('.legal-document__body').text()).toBe('АрхивСохранённый текст.')
  vi.stubGlobal('print', vi.fn(() => {
    const printed = globalThis.document.getElementById('sarafan-print-document')
    expect(printed.textContent).toContain('Сохранённый текст.')
    expect(printed.textContent).not.toContain('Печать')
    expect(printed.textContent).toContain('старое')
  }))
  await click('Печать')
  expect(globalThis.document.getElementById('sarafan-print-document')).toBeNull()
})


it('recovers a background history failure that has no foreground retry attempt', async () => {
  authenticate()
  await mountCenter('/consents'); await flushPromises()
  h.store.personalProblem.value = denied()
  h.store.loadMine.mockImplementationOnce(async () => { h.store.personalProblem.value = null })
  await nextTick()
  expect(wrapper.get('.consent-page__alert').text()).toBe('Сервис временно недоступен. Пожалуйста, повторите позже')
  await click('Повторить')
  expect(wrapper.find('.consent-page__alert').exists()).toBe(false)
  expect(h.store.loadMine).toHaveBeenCalledTimes(2)
})

it('refreshes a notice catalogue on tab return and retries a later catalogue failure', async () => {
  await mountCenter(); await flushPromises()
  vi.spyOn(globalThis.document, 'visibilityState', 'get').mockReturnValue('visible')
  globalThis.dispatchEvent(new globalThis.Event('focus')); await flushPromises()
  expect(h.store.loadOps).toHaveBeenCalledTimes(2)
  h.store.opsProblem.value = denied()
  h.store.loadOps.mockImplementationOnce(async () => { h.store.opsProblem.value = null })
  await nextTick()
  await click('Повторить')
  expect(wrapper.find('.consent-recovery-notice').exists()).toBe(false)
  expect(h.store.loadOps).toHaveBeenCalledTimes(3)
})

it('rejects an unknown legal alias with recoverable page feedback', async () => {
  h.store.read.mockRejectedValue(createInternalProblem('invalidInput'))
  await mountCenter('/legal/unknown-document'); await flushPromises()
  expect(h.store.current).not.toHaveBeenCalled()
  expect(h.store.read).toHaveBeenCalledWith('unknown-document')
  expect(wrapper.find('.consent-page__alert').exists()).toBe(true)
  expect(button('Повторить')).toBeTruthy()
})
