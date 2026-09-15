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
const document = { id, title:'Согласие', displayVersion:'2', contentHash:'a'.repeat(64), html:'<p>Отдельный текст согласия.</p>', effectiveAt:'2026-09-07T09:00:00Z' }
const kinds = [
  { value:1, name:'Согласие на обработку персональных данных', routeAlias:'personal-data-consent' },
  { value:2, name:'Пользовательское соглашение', routeAlias:'user-agreement' },
  { value:3, name:'Правила заказа товаров', routeAlias:'order-rules' },
  { value:4, name:'Политика обработки персональных данных', routeAlias:'privacy-policy' }
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
async function mountCenter(path = '/') {
  router = createAppRouter(createMemoryHistory())
  await router.push(path)
  const mode = path.startsWith('/legal/') ? 'legal' : path.startsWith('/consents') ? 'consents' : 'notice'
  const section = path === '/consents/personal-data' ? 'personal' : 'auto'
  wrapper = mount(ConsentCenter, { props:{ mode, section }, global:{ plugins:[createSarafanVuetify(), router] } })
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
    grant:vi.fn().mockResolvedValue(), requestWithdrawal:vi.fn().mockResolvedValue(), resetCustomer:vi.fn(), dispose:vi.fn()
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
it.each(['/', '/legal/privacy-policy'])(
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

it('renews personal consent and shows the latest manual request', async () => {
  h.session.customer.value = { id:7 }
  h.store.kindName.mockImplementation(kind => kind === LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT
    ? 'Серверное название согласия'
    : kinds.find(item => item.value === kind)?.name)
  h.store.mine.value = {
    statuses:[{ kind:LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT, status:'renewal-required' }],
    history:[{ id:'1', kind:LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT, decision:'grant', at:'2026-09-01T10:00:00Z', documentId:id, displayVersion:'1' }],
    withdrawalRequest:{ customerId:7, requestedAt:'2026-09-01T10:00:00Z', processed:true }
  }
  await mountCenter('/consents'); await flushPromises()
  expect(wrapper.get('h1').text()).toBe('Серверное название согласия')
  expect(wrapper.find('.page-kicker').exists()).toBe(false)
  expect(wrapper.text()).not.toContain('Здесь можно проверить актуальность согласия')
  expect(wrapper.text()).not.toContain('Состояние согласия')
  expect(wrapper.text()).toContain('Действующий документ')
  expect(wrapper.get('.consent-history-section').attributes('open')).toBeUndefined()
  expect(wrapper.findAll('.consent-history a').map(link => link.attributes('href'))).toEqual([`/legal/${id}`])
  expect(wrapper.text()).toContain('Обработан')
  expect(wrapper.text()).not.toContain('не отключает учётную запись')
  await state().grant(); expect(h.store.grant).not.toHaveBeenCalled()
  await wrapper.find('.consent-page__panel--personal input[type=checkbox]').setValue(true)
  await click('Дать согласие'); expect(h.store.grant).toHaveBeenCalledWith(document, expect.any(String))
  expect(wrapper.emitted('personal-consent-granted')).toHaveLength(1)
  await click('Прекратить использовать систему и отозвать согласие на хранение и обработку персональных данных')
  expect(h.store.requestWithdrawal).toHaveBeenCalledWith()
  await state().openPersonal(); await flushPromises()
  expect(wrapper.findComponent(LegalDocumentReader).exists()).toBe(true)
  h.store.loadMine.mockClear()
  vi.spyOn(globalThis.document, 'visibilityState', 'get').mockReturnValue('visible')
  globalThis.dispatchEvent(new globalThis.Event('focus')); await flushPromises()
  expect(h.store.loadMine).toHaveBeenCalled()
  await click('На главную')
  expect(router.currentRoute.value.name).toBe('home')
  h.session.customer.value = null; await flushPromises()
  expect(wrapper.text()).not.toContain('Покупатель')
  expect(h.store.resetCustomer).toHaveBeenCalledTimes(2)
})
it('shows consent history newest first without ordinal markers', async () => {
  h.session.customer.value = { id:7 }
  h.store.mine.value = {
    statuses:[],
    history:[
      { id:'oldest', kind:1, decision:'grant', at:'2026-09-09T10:00:00Z', documentId:id, displayVersion:'1' },
      { id:'newest', kind:2, decision:'grant', at:'2026-09-14T20:14:00Z', documentId:id, displayVersion:'3' },
      { id:'middle', kind:3, decision:'grant', at:'2026-09-14T16:05:00Z', documentId:id, displayVersion:'2' }
    ],
    withdrawalRequest:null
  }
  h.store.current.mockResolvedValue({
    document:{
      ...document,
      html:'<h1>Согласие на хранение и обработку персональных данных</h1><p>Текст.</p>'
    }
  })

  await mountCenter('/consents'); await flushPromises()

  const list = wrapper.get('.consent-history')
  expect(list.element.tagName).toBe('UL')
  expect(list.findAll('li').map(item => item.get('a').text())).toEqual([
    'Версия 3',
    'Версия 2',
    'Версия 1'
  ])
  expect(wrapper.get('.consent-section--document .legal-document__body h1').text())
    .toBe('Согласие на хранение и обработку персональных данных')
})
it('uses a generic consent-page heading while legal operations are loading', async () => {
  h.session.customer.value = { id:7 }
  h.store.kindName.mockReturnValue(undefined)
  const pending = deferred()
  h.store.loadOps.mockReturnValueOnce(pending.promise)
  await mountCenter('/consents')
  await nextTick()
  expect(wrapper.get('h1').text()).toBe('Загрузка юридического документа')
  pending.resolve({ kinds })
  await flushPromises()
})
it('shows personal-data and withdrawal failures without losing consent choices or identity', async () => {
  h.session.customer.value = { id:7 }
  h.store.loadMine.mockRejectedValueOnce(denied())
  await mountCenter('/consents'); await flushPromises()
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(false)
  expect(wrapper.get('.consent-page h1').text()).toBe('Согласие на обработку персональных данных')
  expect(wrapper.get('.consent-page__alert').text())
    .toBe('Сервис временно недоступен. Пожалуйста, повторите позже')
  await click('Повторить')
  expect(h.store.current).toHaveBeenCalledWith(LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT)
  h.store.loadMine.mockRejectedValueOnce(denied()); await state().openPersonal(); await flushPromises()
  expect(wrapper.text()).toContain('Сервис временно недоступен. Пожалуйста, повторите позже')
  await click('Повторить')
  await wrapper.find('.consent-page__panel--personal input[type=checkbox]').setValue(true)
  h.store.grant.mockRejectedValueOnce(denied()); await click('Дать согласие')
  expect(state().accepted).toBe(true)
  await click('Повторить')
  h.store.requestWithdrawal.mockRejectedValueOnce(denied())
  await click('Прекратить использовать систему и отозвать согласие на хранение и обработку персональных данных')
  expect(h.session.customer.value.id).toBe(7)
  await click('Повторить')
  h.store.current.mockResolvedValue({ document:null }); await state().openPersonal(); await flushPromises()
  expect(wrapper.find('.consent-page__panel--personal').findComponent(LegalDocumentReader).exists()).toBe(false)
  expect(wrapper.text()).toContain('Документ о согласии на обработку персональных данных пока не действует.')
})
it('makes immutable and current legal links available without login as routed pages', async () => {
  await mountCenter('/legal/privacy-policy'); await flushPromises()
  expect(h.store.current).toHaveBeenCalledWith(LEGAL_DOCUMENT_KIND.PRIVACY_POLICY)
  expect(wrapper.text()).toContain('Отдельный текст согласия.')
  expect(wrapper.find('.legal-document-page').exists()).toBe(true)
  expect(wrapper.findComponent(UiDialog).exists()).toBe(false)
  expect(button('Скачать Markdown')).toBeUndefined()
  expect(button('Повторить')).toBeUndefined()
  expect(button('Печать').classes()).toEqual(expect.arrayContaining(['ui-button--secondary']))
  vi.stubGlobal('print', vi.fn()); await click('Печать'); expect(globalThis.print).toHaveBeenCalled()
  await state().retry()
  await click('На главную'); expect(router.currentRoute.value.name).toBe('home')
  h.store.ensureOps.mockClear()
  await router.push(`/legal/${id}`); await flushPromises()
  expect(h.store.read).toHaveBeenCalledWith(id)
  expect(h.store.ensureOps).not.toHaveBeenCalled()
  h.store.current.mockResolvedValue({ document:null })
  await router.push('/legal/privacy-policy'); await flushPromises()
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
  await mountCenter('/legal/privacy-policy'); await flushPromises()
  expect(wrapper.get('.consent-page__document-title').text()).toBe('Название документа')
  expect(wrapper.findAll('h1')).toHaveLength(1)
  expect(wrapper.get('h1').text()).toBe('Канонический заголовок')
})
it('provides a semantic route heading when the canonical document has no h1', async () => {
  await mountCenter('/legal/privacy-policy'); await flushPromises()
  expect(wrapper.findAll('h1')).toHaveLength(1)
  expect(wrapper.get('h1').text()).toBe(document.title)
})
it('keeps a semantic route heading when the canonical document is rejected', async () => {
  h.store.current.mockResolvedValue({ document:{ ...document, html:'<script>alert(1)</script>' } })
  await mountCenter('/legal/privacy-policy'); await flushPromises()
  expect(wrapper.findAll('h1')).toHaveLength(1)
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(true)
  h.store.current.mockResolvedValue({ document })
  await click('Повторить')
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(false)
  expect(wrapper.findComponent(LegalDocumentReader).exists()).toBe(true)
})
it('falls back safely if defensive legal-heading parsing fails', async () => {
  await mountCenter('/legal/privacy-policy'); await flushPromises()
  state().document = { ...document, html:'<script>alert(1)</script>' }
  await nextTick()
  expect(state().legalDocumentHasH1).toBe(false)
})
it('rejects invalid legal effective dates before rendering and permits retry', async () => {
  h.store.current.mockResolvedValue({ document:{ ...document, effectiveAt:'not-a-date' } })
  await mountCenter('/legal/privacy-policy'); await flushPromises()
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(true)
  h.store.current.mockResolvedValue({ document })
  await click('Повторить')
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(false)
  expect(wrapper.findComponent(LegalDocumentReader).exists()).toBe(true)
})
it('refreshes a current legal route at the server document boundary', async () => {
  const current = { ...document, title:'Текущая версия' }
  const replacement = { ...document, title:'Новая версия' }
  h.store.current
    .mockResolvedValueOnce({
      document:current,
      serverNow:'2026-09-10T08:00:00.000Z',
      nextChangeAt:'2026-09-10T08:00:00.100Z'
    })
    .mockResolvedValue({ document:replacement, serverNow:'2026-09-10T08:00:00.100Z', nextChangeAt:null })
  await mountCenter('/legal/privacy-policy'); await flushPromises()
  expect(wrapper.get('.consent-page__document-title').text()).toBe('Текущая версия')
  await vi.waitFor(() => expect(wrapper.get('.consent-page__document-title').text()).toBe('Новая версия'))
  expect(h.store.current).toHaveBeenCalledTimes(2)
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
  await mountCenter('/legal/privacy-policy'); await flushPromises()
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
  await mountCenter('/legal/privacy-policy'); await flushPromises()
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(true)
})
it('loads a legal document without associating the authenticated browser', async () => {
  h.session.customer.value = { id:7 }
  await mountCenter('/legal/privacy-policy'); await flushPromises()
  expect(h.store).not.toHaveProperty('associate')
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(false)
  expect(wrapper.findComponent(LegalDocumentReader).exists()).toBe(true)
})
it('removes foreground listeners when a pending mount load is unmounted', async () => {
  const pending = deferred()
  h.store.current.mockImplementationOnce(() => pending.promise)
  vi.spyOn(globalThis.document, 'visibilityState', 'get').mockReturnValue('visible')
  await mountCenter('/legal/privacy-policy'); await nextTick()
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
  await mountCenter('/legal/privacy-policy'); await nextTick()
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
  await mountCenter('/legal/privacy-policy'); await nextTick()
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
  await mountCenter('/legal/privacy-policy'); await nextTick()
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
  await mountCenter('/legal/privacy-policy'); await nextTick()
  await router.push('/legal/user-agreement'); await flushPromises()
  staleCatalogue.resolve({ kinds }); await flushPromises()
  expect(wrapper.get('.consent-page__document-title').text()).toBe('Документ после смены маршрута')
  expect(h.store.current).toHaveBeenCalledTimes(1)
})
it('keeps a pending legal load current when the customer session changes', async () => {
  const pending = deferred()
  h.store.current.mockImplementationOnce(() => pending.promise)
  await mountCenter('/legal/privacy-policy'); await nextTick()
  h.session.customer.value = { id:7 }
  await nextTick()
  pending.resolve({ document }); await flushPromises()
  expect(wrapper.findComponent(LegalDocumentReader).exists()).toBe(true)
  expect(wrapper.text()).toContain('Отдельный текст согласия.')
  expect(h.store.current).toHaveBeenCalledTimes(1)
})
it('reloads the personal document when refreshed history crosses its boundary', async () => {
  const replacement = { ...document, html:'<p>Новое персональное согласие.</p>' }
  h.session.customer.value = { id:7 }
  await mountCenter('/consents/personal-data'); await flushPromises()
  h.store.current.mockClear()
  h.store.current.mockResolvedValue({ document:replacement })
  h.store.mine.value = {
    statuses:[], history:[], withdrawalRequest:null,
    serverNow:'2026-09-10T08:00:00Z', nextChangeAt:'2026-09-10T08:01:00Z'
  }
  await nextTick()
  h.store.mine.value = null
  await nextTick()
  h.store.mine.value = {
    statuses:[], history:[], withdrawalRequest:null,
    serverNow:'2026-09-10T08:01:00Z', nextChangeAt:null
  }
  await flushPromises()
  expect(h.store.current).toHaveBeenCalledWith(LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT)
  expect(wrapper.find('.consent-page__panel--personal').text()).toContain('Новое персональное согласие')
})
it('recovers a missing personal document when history crosses its boundary', async () => {
  const replacement = { ...document, html:'<p>Персональное согласие стало доступно.</p>' }
  h.session.customer.value = { id:7 }
  h.store.current.mockResolvedValueOnce({ document:null }).mockResolvedValue({ document:replacement })
  await mountCenter('/consents/personal-data'); await flushPromises()
  expect(wrapper.text()).toContain('Документ о согласии на обработку персональных данных пока не действует.')
  h.store.mine.value = {
    statuses:[], history:[], withdrawalRequest:null,
    serverNow:'2026-09-10T08:00:00Z', nextChangeAt:'2026-09-10T08:01:00Z'
  }
  await nextTick()
  h.store.mine.value = null
  await nextTick()
  h.store.mine.value = {
    statuses:[], history:[], withdrawalRequest:null,
    serverNow:'2026-09-10T08:01:00Z', nextChangeAt:null
  }
  await flushPromises()
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(false)
  expect(wrapper.find('.consent-page__panel--personal').text()).toContain('Персональное согласие стало доступно.')
})
it('queues a personal boundary refresh until the active operation completes', async () => {
  const pendingGrant = deferred()
  const replacement = { ...document, html:'<p>Согласие после границы.</p>' }
  h.session.customer.value = { id:7 }
  h.store.grant.mockImplementationOnce(() => pendingGrant.promise)
  await mountCenter('/consents/personal-data'); await flushPromises()
  h.store.mine.value = {
    statuses:[], history:[], withdrawalRequest:null,
    serverNow:'2026-09-10T08:00:00Z', nextChangeAt:'2026-09-10T08:01:00Z'
  }
  await nextTick()
  await wrapper.find('input[type=checkbox]').setValue(true)
  h.store.current.mockClear()
  h.store.current.mockResolvedValue({ document:replacement })
  button('Дать согласие').trigger('click')
  await nextTick()
  h.store.mine.value = null
  await nextTick()
  h.store.mine.value = {
    statuses:[], history:[], withdrawalRequest:null,
    serverNow:'2026-09-10T08:01:00Z', nextChangeAt:null
  }
  await nextTick()
  expect(h.store.current).not.toHaveBeenCalled()
  pendingGrant.resolve(); await flushPromises()
  expect(h.store.current).toHaveBeenCalledWith(LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT)
  expect(wrapper.find('.consent-page__panel--personal').text()).toContain('Согласие после границы.')
})
it('ignores consent work completed for a previous customer identity', async () => {
  const staleHistory = deferred()
  h.session.customer.value = { id:7 }
  h.store.loadMine
    .mockImplementationOnce(() => staleHistory.promise)
    .mockResolvedValueOnce()
  await mountCenter('/consents'); await nextTick()
  h.session.customer.value = { id:8 }
  await flushPromises()
  staleHistory.reject(denied()); await flushPromises()
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(false)
  expect(wrapper.get('h1').text()).toBe('Согласие на обработку персональных данных')
  expect(h.store.current).toHaveBeenCalledWith(LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT)
  expect(h.store.current).toHaveBeenCalledTimes(1)
})

it('ignores a stale personal-data load after the customer changes', async () => {
  const staleHistory = deferred()
  const selected = { ...document, title:'Согласие нового покупателя', html:'<p>Документ нового покупателя.</p>' }
  h.session.customer.value = { id:7 }
  h.store.loadMine
    .mockImplementationOnce(() => staleHistory.promise)
    .mockResolvedValueOnce()
  h.store.current.mockResolvedValue({ document:selected })
  await mountCenter('/consents/personal-data'); await nextTick()
  h.session.customer.value = { id:8 }
  await flushPromises()
  staleHistory.resolve(); await flushPromises()
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(false)
  expect(wrapper.find('.consent-page__panel--personal').text()).toContain('Документ нового покупателя.')
  expect(h.store.current).toHaveBeenCalledTimes(1)
})



it('ignores a stale personal document response after the customer changes', async () => {
  const stalePersonal = deferred()
  const selected = { ...document, html:'<p>Актуальное персональное согласие.</p>' }
  h.session.customer.value = { id:7 }
  h.store.current
    .mockImplementationOnce(() => stalePersonal.promise)
    .mockResolvedValueOnce({ document:selected })
  await mountCenter('/consents/personal-data'); await nextTick()
  h.session.customer.value = { id:8 }
  await flushPromises()
  stalePersonal.resolve({ document:{ ...document, html:'<p>Устаревшее персональное согласие.</p>' } }); await flushPromises()
  expect(wrapper.find('.consent-page__panel--personal').text()).toContain('Актуальное персональное согласие.')
  expect(wrapper.text()).not.toContain('Устаревшее персональное согласие.')
})
it('does not start loaders whose route or identity scope has already expired', async () => {
  await mountCenter('/consents/personal-data'); await flushPromises()
  h.store.current.mockClear()
  h.store.loadMine.mockClear()
  const expired = () => false
  const action = vi.fn()
  await state().perform(action, undefined, expired)
  await state().showPersonal(expired)
  expect(action).not.toHaveBeenCalled()
  expect(h.store.current).not.toHaveBeenCalled()
  expect(h.store).not.toHaveProperty('loadCookies')
  expect(h.store.loadMine).not.toHaveBeenCalled()
})

it('retries the failed explicit consent section', async () => {
  h.session.customer.value = { id:7 }
  h.store.personalProblem.value = null
  h.store.loadMine.mockReset().mockResolvedValue()
  await mountCenter('/consents/personal-data'); await flushPromises()
  h.store.personalProblem.value = denied()
  h.store.loadMine.mockImplementation(async () => { h.store.personalProblem.value = null })
  await nextTick()
  await click('Повторить')
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(false)
})
it('reloads a failed cached catalogue before refreshing an explicit consent section', async () => {
  h.session.customer.value = { id:7 }
  await mountCenter('/consents/personal-data'); await flushPromises()
  h.store.opsProblem.value = denied()
  h.store.loadOps.mockImplementation(async () => { h.store.opsProblem.value = null })
  await nextTick()
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(false)
  expect(wrapper.find('.consent-page__alert').exists()).toBe(true)
  await click('Повторить')
  expect(h.store.loadOps).toHaveBeenCalledTimes(1)
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(false)

  wrapper.unmount()
  h.session.customer.value = { id:7 }
  h.store.opsProblem.value = null
  h.store.loadOps.mockClear()
  await mountCenter('/consents/personal-data'); await flushPromises()
  h.store.opsProblem.value = denied()
  h.store.loadOps.mockImplementation(async () => { h.store.opsProblem.value = null })
  await nextTick()
  await click('Повторить')
  expect(h.store.loadOps).toHaveBeenCalledTimes(1)
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(false)
})
it('stops consent document loading when catalogue recovery outlives the page', async () => {
  h.session.customer.value = { id:7 }
  await mountCenter('/consents'); await flushPromises()
  const pendingOps = deferred()
  h.store.current.mockClear()
  h.store.opsProblem.value = denied()
  h.store.loadOps.mockImplementationOnce(() => pendingOps.promise)
  state().openPersonal()
  await nextTick()
  wrapper.unmount()
  pendingOps.resolve({ kinds }); await flushPromises()
  expect(h.store.current).not.toHaveBeenCalled()

  h.store.opsProblem.value = null
  await mountCenter('/consents/personal-data'); await flushPromises()
  const personalOps = deferred()
  h.store.current.mockClear()
  h.store.loadMine.mockClear()
  h.store.opsProblem.value = denied()
  h.store.loadOps.mockImplementationOnce(() => personalOps.promise)
  state().openPersonal()
  await nextTick()
  wrapper.unmount()
  personalOps.resolve({ kinds }); await flushPromises()
  expect(h.store.loadMine).not.toHaveBeenCalled()
  expect(h.store.current).not.toHaveBeenCalled()
})
it('refreshes only the visible explicit consent section when returning to the page', async () => {
  h.session.customer.value = { id:7 }
  vi.spyOn(globalThis.document, 'visibilityState', 'get').mockReturnValue('visible')
  await mountCenter('/consents/personal-data'); await flushPromises()
  h.store.current.mockClear()
  globalThis.dispatchEvent(new globalThis.Event('focus')); await flushPromises()
  expect(h.store.current).toHaveBeenCalledTimes(1)
  expect(h.store.current).toHaveBeenCalledWith(LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT)

  wrapper.unmount()
  await mountCenter('/consents/personal-data'); await flushPromises()
  h.store.current.mockClear()
  globalThis.dispatchEvent(new globalThis.Event('focus')); await flushPromises()
  expect(h.store.current).toHaveBeenCalledTimes(1)
  expect(h.store.current).toHaveBeenCalledWith(LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT)
})
it('preserves unsent consent choices on foreground refresh until the document changes', async () => {
  h.session.customer.value = { id:7 }
  vi.spyOn(globalThis.document, 'visibilityState', 'get').mockReturnValue('visible')
  await mountCenter('/consents'); await flushPromises()
  const personalChoice = wrapper.find('.consent-page__panel--personal input[type=checkbox]')
  await personalChoice.setValue(true)

  globalThis.dispatchEvent(new globalThis.Event('focus')); await flushPromises()
  expect(personalChoice.element.checked).toBe(true)

  const replacement = { ...document, id:'22222222-2222-2222-2222-222222222222', contentHash:'b'.repeat(64) }
  h.store.current.mockResolvedValue({ document:replacement })
  globalThis.dispatchEvent(new globalThis.Event('focus')); await flushPromises()
  expect(personalChoice.element.checked).toBe(false)
})
it('queues a foreground refresh without superseding an active consent operation', async () => {
  const pendingGrant = deferred()
  h.session.customer.value = { id:7 }
  h.store.grant.mockImplementationOnce(() => pendingGrant.promise)
  vi.spyOn(globalThis.document, 'visibilityState', 'get').mockReturnValue('visible')
  await mountCenter('/consents/personal-data'); await flushPromises()
  await wrapper.find('input[type=checkbox]').setValue(true)
  h.store.current.mockClear()
  button('Дать согласие').trigger('click')
  await nextTick()
  globalThis.dispatchEvent(new globalThis.Event('focus'))
  await nextTick()
  expect(h.store.current).not.toHaveBeenCalled()
  pendingGrant.resolve(); await flushPromises()
  expect(h.store.current).toHaveBeenCalledTimes(1)
  expect(state().busy).toBe(false)
})
it('cancels a foreground refresh when the customer identity changes', async () => {
  const staleDocument = deferred()
  h.session.customer.value = { id:7 }
  vi.spyOn(globalThis.document, 'visibilityState', 'get').mockReturnValue('visible')
  await mountCenter('/consents'); await flushPromises()
  h.store.current.mockClear()
  h.store.current
    .mockImplementationOnce(() => staleDocument.promise)
    .mockResolvedValue({ document })

  globalThis.dispatchEvent(new globalThis.Event('focus'))
  await vi.waitFor(() => expect(h.store.current).toHaveBeenCalledTimes(1))
  h.session.customer.value = { id:8 }
  await flushPromises()
  expect(h.store.current.mock.calls.filter(([kind]) => kind === LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT)).toHaveLength(2)

  staleDocument.resolve({ document }); await flushPromises()
  expect(h.store.current.mock.calls.filter(([kind]) => kind === LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT)).toHaveLength(2)
  expect(state().personalDocument).toEqual(document)
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





it('opens a consent hash that was present before the customer session was restored', async () => {
  await mountCenter('/consents'); await flushPromises()
  expect(wrapper.get('h1').text()).toBe('Согласие на обработку персональных данных')
  expect(wrapper.find('.consent-page__panel--personal').exists()).toBe(false)
  expect(button('Дать согласие')).toBeUndefined()
  h.session.customer.value = { id:7 }
  await flushPromises()
  expect(wrapper.get('h1').text()).toBe('Согласие на обработку персональных данных')
  expect(wrapper.find('.consent-page__panel--personal').exists()).toBe(true)
  expect(button('Дать согласие')).toBeTruthy()
  expect(h.store.current).toHaveBeenCalledWith(LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT)
  await click('На главную')
  expect(router.currentRoute.value.name).toBe('home')
})

it('reuses idempotent consent keys but only refreshes status after a withdrawal failure', async () => {
  h.session.customer.value = { id:7 }
  await mountCenter('/consents/personal-data'); await flushPromises()
  await wrapper.findAll('input[type=checkbox]')[0].setValue(true)
  h.store.grant.mockRejectedValueOnce(denied())
  await click('Дать согласие'); await click('Повторить')
  expect(h.store.grant.mock.calls[1][1]).toBe(h.store.grant.mock.calls[0][1])
  h.store.loadMine.mockClear()
  h.store.requestWithdrawal.mockRejectedValue(denied())
  await click('Прекратить использовать систему и отозвать согласие на хранение и обработку персональных данных')
  await click('Повторить')
  expect(h.store.requestWithdrawal).toHaveBeenCalledTimes(1)
  expect(h.store.loadMine).toHaveBeenCalledTimes(1)
})
it('starts a new personal consent decision after logout and same-customer login', async () => {
  h.session.customer.value = { id:7 }
  await mountCenter('/consents/personal-data'); await flushPromises()
  await wrapper.find('input[type=checkbox]').setValue(true)
  h.store.grant.mockRejectedValueOnce(denied())
  await click('Дать согласие')
  const failedKey = h.store.grant.mock.calls[0][1]

  h.session.customer.value = null
  await flushPromises()
  h.session.customer.value = { id:7 }
  await flushPromises()
  await wrapper.find('.consent-page__panel--personal input[type=checkbox]').setValue(true)
  await click('Дать согласие')
  expect(h.store.grant.mock.calls[1][1]).not.toBe(failedKey)
})

it('disables repeat submission while the latest request is pending and enables it after processing', async () => {
  h.session.customer.value = { id:7 }
  h.store.mine.value = { statuses:[], history:[], withdrawalRequest:{ customerId:7, requestedAt:'2026-09-01T10:00:00Z', processed:false } }
  await mountCenter('/consents/personal-data'); await flushPromises()
  const action = button('Прекратить использовать систему и отозвать согласие на хранение и обработку персональных данных')
  expect(action.attributes('disabled')).toBeDefined()
  expect(wrapper.text()).toContain('Ожидает ручной обработки')
  h.store.mine.value.withdrawalRequest.processed = true; await nextTick()
  expect(action.attributes('disabled')).toBeUndefined()
})

it('reloads changed versions and resets affirmation without accepting the replacement automatically', async () => {
  const changed = new ProblemError(coreProblem(409, 'consent-version-changed'))
  h.session.customer.value = { id:7 }
  await mountCenter('/consents/personal-data'); await flushPromises()
  await wrapper.findAll('input[type=checkbox]')[0].setValue(true)
  h.store.grant.mockRejectedValueOnce(changed)
  await click('Дать согласие')
  expect(wrapper.findAll('input[type=checkbox]')[0].element.checked).toBe(false)
  expect(h.store.grant).toHaveBeenCalledTimes(1)
  await wrapper.findAll('input[type=checkbox]')[0].setValue(true)
  h.store.grant.mockRejectedValueOnce(changed); h.store.current.mockRejectedValueOnce(denied())
  await click('Дать согласие')
  expect(wrapper.findComponent(LegalDocumentReader).exists()).toBe(false)
  expect(wrapper.text()).toContain('Сервис временно недоступен. Пожалуйста, повторите позже')
  await click('Повторить')
  expect(wrapper.findComponent(LegalDocumentReader).exists()).toBe(true)
  expect(h.store.grant).toHaveBeenCalledTimes(2)
})
