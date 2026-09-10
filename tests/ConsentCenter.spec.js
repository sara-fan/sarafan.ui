// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application
import { ref, nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { createSarafanVuetify } from '../src/plugins/vuetify.js'
import ConsentCenter from '../src/components/ConsentCenter.vue'
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
const document = { id, title:'Согласие', displayVersion:'2', contentHash:'a'.repeat(64), html:'<p>Отдельный текст согласия.</p>', effectiveAt:'2026-09-07T09:00:00Z', cookieCategories:[0] }
const kinds = [
  { value:0, name:'Согласие на использование куки', routeAlias:'cookie-consent' },
  { value:1, name:'Согласие на обработку персональных данных', routeAlias:'personal-data-consent' },
  { value:2, name:'Пользовательское соглашение', routeAlias:'user-agreement' },
  { value:3, name:'Правила заказа товаров', routeAlias:'order-rules' },
  { value:4, name:'Политика обработки персональных данных', routeAlias:'privacy-policy' }
]
const cookieCategories = [{ value:0, name:'Обязательные', required:true }]
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
  const section = path === '/consents/cookies' ? 'cookies' : path === '/consents/personal-data' ? 'personal' : 'auto'
  wrapper = mount(ConsentCenter, { props:{ mode, section }, global:{ plugins:[createSarafanVuetify(), router] } })
  return wrapper
}
beforeEach(() => {
  h.session.customer = ref(null)
  Object.assign(h.store, {
    cookies:ref(null), mine:ref(null), ops:ref({ kinds, cookieCategories }), serviceAllowed:ref(false), opsProblem:ref(null), cookieProblem:ref(null), personalProblem:ref(null),
    current:vi.fn().mockResolvedValue({ document }), read:vi.fn().mockResolvedValue(document), source:vi.fn().mockResolvedValue(new globalThis.Blob(['text'])),
    loadOps:vi.fn().mockResolvedValue({ kinds, cookieCategories }), ensureOps:vi.fn().mockResolvedValue({ kinds, cookieCategories }),
    kindByAlias:vi.fn(alias => kinds.find(item => item.routeAlias === alias)?.value),
    kindName:vi.fn(kind => kinds.find(item => item.value === kind)?.name),
    routeAlias:vi.fn(kind => kinds.find(item => item.value === kind)?.routeAlias),
    cookieCategoryName:vi.fn(category => cookieCategories.find(item => item.value === category)?.name),
    requiredCookieCategories:vi.fn(() => cookieCategories.filter(item => item.required).map(item => item.value)),
    loadCookies:vi.fn().mockResolvedValue(), loadMine:vi.fn().mockResolvedValue(), associate:vi.fn().mockResolvedValue(),
    decideCookies:vi.fn().mockResolvedValue(), grant:vi.fn().mockResolvedValue(), requestWithdrawal:vi.fn().mockResolvedValue(), resetCustomer:vi.fn(), dispose:vi.fn()
  })
  globalThis.history.replaceState(null, '', '/')
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:test'); globalThis.URL.revokeObjectURL = vi.fn()
  vi.spyOn(globalThis.HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks(); globalThis.history.replaceState(null, '', '/') })

it('requires explicit mandatory куки consent with the canonical document and recoverable failures', async () => {
  await mountCenter(); await flushPromises()
  expect(wrapper.findAll('.cookie-notice__links a')).toHaveLength(5)
  expect(wrapper.text()).toContain('необходимо принять обязательные куки')
  expect(button('Отказаться')).toBeTruthy()
  expect(button('Согласия')).toBeTruthy()
  expect(wrapper.findAll('input[type=checkbox]')).toHaveLength(1)
  expect(wrapper.find('input[type=checkbox]').element.checked).toBe(false)
  expect(button('Принять обязательные куки').classes()).toContain('ui-button--primary')
  expect(button('Принять обязательные куки').attributes('disabled')).toBeDefined()
  await wrapper.find('input[type=checkbox]').setValue(true)
  h.store.decideCookies.mockRejectedValueOnce(denied())
  await click('Принять обязательные куки')
  expect(wrapper.find('.service-unavailable-page').text()).toContain('Сервис недоступен. Пожалуйста, повторите позже.')
  expect(wrapper.emitted('service-unavailable')).toContainEqual([true])
  expect(state().categories).toEqual([0])
  const key = h.store.decideCookies.mock.calls[0][3]
  await click('Повторить')
  expect(wrapper.emitted('service-unavailable')).toContainEqual([false])
  expect(h.store.decideCookies).toHaveBeenLastCalledWith(document, 'grant', [0], key)
  await click('Согласия')
  expect(router.currentRoute.value.name).toBe('consents')
  wrapper.unmount()
  await mountCenter('/consents/cookies'); await flushPromises()
  expect(wrapper.text()).toContain('Отдельный текст согласия.')
  expect(button('Принять обязательные куки').attributes('disabled')).toBeDefined()
  await wrapper.findAll('input[type=checkbox]')[0].setValue(true)
  await click('Отказаться')
  expect(h.store.decideCookies).toHaveBeenLastCalledWith(document, 'refuse', [], expect.any(String))
  h.store.cookies.value = { status:'current', categories:[0], documentId:id }
  await nextTick()
  await click('Отозвать согласие на использование куки')
  expect(h.store.read).toHaveBeenCalledWith(id)
  expect(h.store.decideCookies).toHaveBeenLastCalledWith(document, 'withdraw', [], expect.any(String))
  h.store.cookies.value = { status:'withdrawn', categories:[], documentId:id }
  await nextTick()
  expect(wrapper.text()).toContain('Отозвано')
  await click('Обновить документ')
  await state().retry()
  await click('На главную')
  expect(router.currentRoute.value.name).toBe('home')
})
it('keeps service unavailable and permits retry when the куки document is unavailable', async () => {
  h.store.current.mockResolvedValue({ document:null })
  await mountCenter(); await flushPromises()
  expect(button('Повторить загрузку')).toBeTruthy()
  await click('Повторить загрузку')
  await click('Согласия')
  wrapper.unmount()
  await mountCenter('/consents/cookies'); await flushPromises()
  expect(wrapper.text()).toContain('Использование сервиса недоступно')
  expect(button('Отказаться').attributes('disabled')).toBeDefined()
  await state().chooseCookies('refuse')
  expect(h.store.decideCookies).not.toHaveBeenCalled()
})

it('retries both catalogue and cookie status after an initial communication failure', async () => {
  h.store.loadOps.mockRejectedValueOnce(denied())
  h.store.cookieProblem.value = denied()
  h.store.loadCookies.mockImplementation(async () => { h.store.cookieProblem.value = null })
  await mountCenter(); await flushPromises()
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(true)
  await click('Повторить')
  expect(h.store.loadOps).toHaveBeenCalledTimes(2)
  expect(h.store.loadCookies).toHaveBeenCalledTimes(1)
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(false)
  expect(wrapper.find('.cookie-notice').exists()).toBe(true)
})
it('clears a stale cookie document failure when retry restores service access', async () => {
  h.store.current.mockRejectedValueOnce(denied())
  h.store.loadCookies
    .mockResolvedValueOnce()
    .mockImplementationOnce(async () => { h.store.serviceAllowed.value = true })
  await mountCenter(); await flushPromises()
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(true)
  expect(state().cookieDocumentProblem).toMatchObject({ type:expect.stringContaining('service-unavailable') })
  await click('Повторить')
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(false)
  expect(state().cookieDocumentProblem).toBeNull()
  expect(h.store.current).toHaveBeenCalledTimes(1)
})
it('keeps the outage page when retrying customer association still fails', async () => {
  h.session.customer.value = { id:7 }
  h.store.serviceAllowed.value = true
  h.store.associate.mockRejectedValue(denied())
  await mountCenter('/consents'); await flushPromises()
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(true)
  await click('Повторить')
  expect(h.store.associate).toHaveBeenCalledTimes(2)
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(true)
})
it('recovers every failed panel on the combined consent page with one retry', async () => {
  h.session.customer.value = { id:7 }
  h.store.current
    .mockRejectedValueOnce(denied())
    .mockRejectedValueOnce(denied())
    .mockResolvedValue({ document })
  await mountCenter('/consents'); await flushPromises()
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(true)
  expect(h.store.current).toHaveBeenCalledTimes(2)
  await click('Повторить')
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(false)
  expect(wrapper.find('.consent-page__panel--cookies').findComponent(LegalDocumentReader).exists()).toBe(true)
  expect(wrapper.find('.consent-page__panel--personal').findComponent(LegalDocumentReader).exists()).toBe(true)
  expect(h.store.current).toHaveBeenCalledTimes(5)
})
it('continues combined recovery when the latest ordinary retry still fails', async () => {
  h.session.customer.value = { id:7 }
  const ordinary = createInternalProblem('invalidInput', { detail:'История ещё не готова.' })
  h.store.current.mockRejectedValueOnce(denied()).mockResolvedValue({ document })
  h.store.loadMine
    .mockRejectedValueOnce(ordinary)
    .mockRejectedValueOnce(ordinary)
    .mockResolvedValue()
  await mountCenter('/consents'); await flushPromises()
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(true)
  await click('Повторить')
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(false)
  expect(wrapper.find('.consent-page__panel--cookies').findComponent(LegalDocumentReader).exists()).toBe(true)
  expect(wrapper.find('.consent-page__panel--personal').findComponent(LegalDocumentReader).exists()).toBe(true)
  expect(h.store.loadMine).toHaveBeenCalledTimes(3)
})
it('stops combined retry recovery before the second panel after unmount', async () => {
  h.session.customer.value = { id:7 }
  const retryCookie = deferred()
  h.store.current
    .mockRejectedValueOnce(denied())
    .mockResolvedValueOnce({ document })
    .mockImplementationOnce(() => retryCookie.promise)
    .mockResolvedValue({ document })
  await mountCenter('/consents'); await flushPromises()
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(true)
  button('Повторить').trigger('click')
  await vi.waitFor(() => expect(h.store.current).toHaveBeenCalledTimes(3))
  wrapper.unmount()
  retryCookie.resolve({ document }); await flushPromises()
  expect(h.store.current).toHaveBeenCalledTimes(3)
})
it('prioritizes a service outage over an ordinary error from the other consent panel', async () => {
  h.session.customer.value = { id:7 }
  h.store.cookieProblem.value = denied()
  h.store.personalProblem.value = createInternalProblem('invalidInput')
  await mountCenter('/consents'); await flushPromises()
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(true)
  expect(wrapper.text()).toContain('Сервис недоступен. Пожалуйста, повторите позже.')
})
it('refuses directly from the initial notice and then shows a grant-only recovery state', async () => {
  await mountCenter(); await flushPromises()
  await click('Отказаться')
  expect(h.store.decideCookies).toHaveBeenLastCalledWith(document, 'refuse', [], expect.any(String))
  h.store.cookies.value = { status:'refused', categories:[], documentId:id }
  await nextTick()
  expect(wrapper.text()).toContain('Обязательные куки отклонены')
  expect(button('Отказаться')).toBeUndefined()
  expect(button('Принять обязательные куки')).toBeTruthy()
  expect(wrapper.find('input[type=checkbox]').element.checked).toBe(false)
  h.store.loadCookies.mockClear(); h.store.loadMine.mockClear()
  vi.spyOn(globalThis.document, 'visibilityState', 'get').mockReturnValue('visible')
  globalThis.dispatchEvent(new globalThis.Event('focus')); await flushPromises()
  expect(h.store.loadCookies).toHaveBeenCalledTimes(1)
  expect(h.store.loadMine).toHaveBeenCalledTimes(1)
  h.store.serviceAllowed.value = true; await nextTick()
  h.store.current.mockClear()
  h.store.serviceAllowed.value = false; await flushPromises()
  expect(h.store.current).toHaveBeenCalledWith(LEGAL_DOCUMENT_KIND.COOKIE_CONSENT)
})

it('links authenticated visitors from the notice to the combined consent page', async () => {
  h.session.customer.value = { id:7 }
  await mountCenter(); await flushPromises()
  expect(wrapper.get('a[href="/consents"]').text()).toBe('Согласия')
  await wrapper.get('a[href="/consents"]').trigger('click'); await flushPromises()
  expect(router.currentRoute.value.name).toBe('consents')
})
it('retries a failed personal-history load from the notice outage page', async () => {
  h.session.customer.value = { id:7 }
  h.store.serviceAllowed.value = true
  h.store.loadMine.mockRejectedValueOnce(denied())
  await mountCenter(); await flushPromises()
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(true)
  await click('Повторить')
  expect(h.store.loadMine).toHaveBeenCalledTimes(2)
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(false)
})
it('presents and retries a late personal-history failure from the notice controller', async () => {
  h.session.customer.value = { id:7 }
  h.store.serviceAllowed.value = true
  await mountCenter(); await flushPromises()
  h.store.loadMine.mockClear()
  h.store.personalProblem.value = denied()
  h.store.loadMine.mockImplementation(async () => { h.store.personalProblem.value = null })
  await nextTick()
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(true)
  await click('Повторить')
  expect(h.store.loadMine).toHaveBeenCalledTimes(1)
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(false)
})
it('routes the inline notice retry through personal-history recovery', async () => {
  h.session.customer.value = { id:7 }
  await mountCenter(); await flushPromises()
  h.store.loadMine.mockClear()
  h.store.personalProblem.value = createInternalProblem('invalidInput', { detail:'История временно недоступна.' })
  h.store.loadMine.mockImplementation(async () => { h.store.personalProblem.value = null })
  await nextTick()
  expect(wrapper.find('.cookie-notice').text()).toContain('История временно недоступна.')
  await click('Повторить загрузку')
  expect(h.store.loadMine).toHaveBeenCalledTimes(1)
  expect(wrapper.text()).not.toContain('История временно недоступна.')
})
it('presents renewal copy, unknown statuses, and category deselection safely', async () => {
  await mountCenter(); await flushPromises()
  h.store.cookies.value = { status:'renewal-required', categories:[], documentId:id }
  await nextTick()
  expect(wrapper.text()).toContain('Требуется новое согласие на использование куки')
  expect(wrapper.text()).toContain('Документ изменился')
  h.store.cookies.value = { status:'withdrawn', categories:[], documentId:id }
  await nextTick()
  expect(wrapper.text()).toContain('Согласие на использование куки отозвано')
  h.store.cookies.value = { status:'unexpected', categories:[], documentId:id }
  await nextTick()
  await click('Согласия')
  wrapper.unmount()
  await mountCenter('/consents/cookies'); await flushPromises()
  expect(wrapper.text()).toContain('unexpected')
  const checkbox = wrapper.find('input[type=checkbox]')
  await checkbox.setValue(true)
  await checkbox.setValue(false)
  expect(checkbox.element.checked).toBe(false)
})
it('associates an observed browser, renews personal consent and shows the latest manual request', async () => {
  h.session.customer.value = { id:7 }
  h.store.serviceAllowed.value = true
  h.store.mine.value = {
    statuses:[{ kind:LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT, status:'renewal-required' }],
    history:[{ id:'1', kind:LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT, decision:'grant', at:'2026-09-01T10:00:00Z', documentId:id, displayVersion:'1' }, { id:'2', kind:LEGAL_DOCUMENT_KIND.COOKIE_CONSENT, decision:'refuse', at:'2026-09-01T10:00:00Z', associatedAt:'2026-09-02T10:00:00Z', documentId:id, displayVersion:'1' }],
    withdrawalRequest:{ customerId:7, requestedAt:'2026-09-01T10:00:00Z', processed:true }
  }
  await mountCenter('/consents'); await flushPromises()
  expect(h.store.associate).toHaveBeenCalled()
  expect(wrapper.get('h1').text()).toBe('Согласия')
  expect(wrapper.find('.consent-page__panel--cookies').text()).toContain('Согласие на использование куки')
  expect(wrapper.find('.consent-page__panel--personal').text()).toContain('Согласие на обработку персональных данных')
  expect(wrapper.text()).toContain('Требуется новое согласие')
  expect(wrapper.text()).toContain('Принятая версия1')
  expect(wrapper.text()).toContain('Актуальная версия2')
  expect(wrapper.findAll('.consent-history a').map(link => link.attributes('href'))).toEqual([`/legal/${id}`, `/legal/${id}`])
  expect(wrapper.text()).toContain('Связано с аккаунтом')
  expect(wrapper.text()).toContain('Обработан')
  expect(wrapper.text()).toContain('не отключает учётную запись')
  await state().grant(); expect(h.store.grant).not.toHaveBeenCalled()
  await wrapper.find('.consent-page__panel--personal input[type=checkbox]').setValue(true)
  await click('Дать согласие'); expect(h.store.grant).toHaveBeenCalledWith(document, expect.any(String))
  await click('Прекратить использовать систему и отозвать согласие на обработку персональных данных')
  expect(h.store.requestWithdrawal).toHaveBeenCalledWith()
  await click('Обновить')
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
it('shows personal-data and withdrawal failures without losing consent choices or identity', async () => {
  h.session.customer.value = { id:7 }; h.store.serviceAllowed.value = true
  h.store.associate.mockRejectedValueOnce(denied())
  await mountCenter('/consents'); await flushPromises(); expect(wrapper.text()).toContain('Сервис недоступен')
  await click('Повторить')
  expect(h.store.associate).toHaveBeenCalledTimes(2)
  expect(h.store.current).toHaveBeenCalledWith(LEGAL_DOCUMENT_KIND.COOKIE_CONSENT)
  expect(h.store.current).toHaveBeenCalledWith(LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT)
  h.store.loadMine.mockRejectedValueOnce(denied()); await click('Обновить')
  expect(wrapper.text()).toContain('Сервис недоступен')
  await click('Повторить')
  await wrapper.find('.consent-page__panel--personal input[type=checkbox]').setValue(true)
  h.store.grant.mockRejectedValueOnce(denied()); await click('Дать согласие')
  expect(state().accepted).toBe(true)
  await click('Повторить')
  h.store.requestWithdrawal.mockRejectedValueOnce(denied())
  await click('Прекратить использовать систему и отозвать согласие на обработку персональных данных')
  expect(h.session.customer.value.id).toBe(7)
  await click('Повторить')
  h.store.current.mockResolvedValue({ document:null }); await click('Обновить')
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
  await router.push(`/legal/${id}`); await flushPromises()
  expect(h.store.read).toHaveBeenCalledWith(id)
  h.store.current.mockResolvedValue({ document:null })
  await router.push('/legal/privacy-policy'); await flushPromises()
  expect(wrapper.text()).toContain('Документ пока не действует')
  h.store.current.mockRejectedValueOnce(denied()); await router.push('/legal/user-agreement'); await flushPromises()
  expect(wrapper.text()).toContain('Сервис недоступен. Пожалуйста, повторите позже.')
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
  expect(wrapper.get('h1').text()).toBe(document.title)
  expect(wrapper.find('[role=alert]').exists()).toBe(true)
})
it('loads a legal document without associating the authenticated browser', async () => {
  h.session.customer.value = { id:7 }
  h.store.serviceAllowed.value = true
  h.store.associate.mockRejectedValue(denied())
  await mountCenter('/legal/privacy-policy'); await flushPromises()
  expect(h.store.associate).not.toHaveBeenCalled()
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
  globalThis.document.dispatchEvent(new globalThis.Event('visibilitychange')); expect(h.store.loadCookies).not.toHaveBeenCalled()
  vi.spyOn(globalThis.document, 'visibilityState', 'get').mockReturnValue('visible')
  globalThis.document.dispatchEvent(new globalThis.Event('visibilitychange')); await flushPromises()
  expect(h.store.loadCookies).not.toHaveBeenCalled()
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
    .mockResolvedValueOnce({ kinds, cookieCategories })
  h.store.current.mockResolvedValue({ document:selected })
  await mountCenter('/legal/privacy-policy'); await nextTick()
  await router.push('/legal/user-agreement'); await flushPromises()
  staleCatalogue.resolve({ kinds, cookieCategories }); await flushPromises()
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
it('ignores consent work completed for a previous customer identity', async () => {
  const staleAssociation = deferred()
  h.session.customer.value = { id:7 }
  h.store.serviceAllowed.value = true
  h.store.associate
    .mockImplementationOnce(() => staleAssociation.promise)
    .mockResolvedValueOnce()
  await mountCenter('/consents'); await nextTick()
  h.session.customer.value = { id:8 }
  await flushPromises()
  staleAssociation.reject(denied()); await flushPromises()
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(false)
  expect(wrapper.get('h1').text()).toBe('Согласия')
  expect(h.store.current).toHaveBeenCalledWith(LEGAL_DOCUMENT_KIND.COOKIE_CONSENT)
  expect(h.store.current).toHaveBeenCalledWith(LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT)
})
it('stops a successful association callback after the customer changes', async () => {
  const staleAssociation = deferred()
  h.session.customer.value = { id:7 }
  h.store.serviceAllowed.value = true
  h.store.associate
    .mockImplementationOnce(() => staleAssociation.promise)
    .mockResolvedValueOnce()
  await mountCenter('/consents'); await nextTick()
  h.session.customer.value = { id:8 }
  await flushPromises()
  staleAssociation.resolve(); await flushPromises()
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(false)
  expect(h.store.current).toHaveBeenCalledTimes(2)
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
it('ignores a stale cookie failure after the customer changes', async () => {
  const staleCookie = deferred()
  const selected = { ...document, html:'<p>Куки нового покупателя.</p>' }
  h.session.customer.value = { id:7 }
  h.store.current
    .mockImplementationOnce(() => staleCookie.promise)
    .mockResolvedValueOnce({ document:selected })
  await mountCenter('/consents/cookies'); await nextTick()
  h.session.customer.value = { id:8 }
  await flushPromises()
  staleCookie.reject(denied()); await flushPromises()
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(false)
  expect(wrapper.find('.consent-page__panel--cookies').text()).toContain('Куки нового покупателя.')
  expect(state().cookieDocumentBusy).toBe(false)
})
it('ignores a stale successful cookie document after the customer changes', async () => {
  const staleCookie = deferred()
  const selected = { ...document, html:'<p>Актуальные куки.</p>' }
  h.session.customer.value = { id:7 }
  h.store.current
    .mockImplementationOnce(() => staleCookie.promise)
    .mockResolvedValueOnce({ document:selected })
  await mountCenter('/consents/cookies'); await nextTick()
  h.session.customer.value = { id:8 }
  await flushPromises()
  staleCookie.resolve({ document:{ ...document, html:'<p>Устаревшие куки.</p>' } }); await flushPromises()
  expect(wrapper.find('.consent-page__panel--cookies').text()).toContain('Актуальные куки.')
  expect(wrapper.text()).not.toContain('Устаревшие куки.')
})
it('stops a stale cookie load before requesting its document', async () => {
  const staleStatus = deferred()
  h.session.customer.value = { id:7 }
  h.store.loadCookies
    .mockImplementationOnce(() => staleStatus.promise)
    .mockResolvedValueOnce()
  await mountCenter('/consents/cookies'); await nextTick()
  h.session.customer.value = { id:8 }
  await flushPromises()
  staleStatus.resolve(); await flushPromises()
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(false)
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
  await mountCenter('/consents/cookies'); await flushPromises()
  h.store.current.mockClear()
  h.store.loadCookies.mockClear()
  h.store.loadMine.mockClear()
  const expired = () => false
  const action = vi.fn()
  await state().perform(action, undefined, expired)
  await state().fetchCookieDocument(false, expired)
  await state().openCookies(expired)
  await state().showPersonal(expired)
  expect(action).not.toHaveBeenCalled()
  expect(h.store.current).not.toHaveBeenCalled()
  expect(h.store.loadCookies).not.toHaveBeenCalled()
  expect(h.store.loadMine).not.toHaveBeenCalled()
})
it('retries the failed explicit consent section', async () => {
  h.session.customer.value = { id:7 }
  await mountCenter('/consents/cookies'); await flushPromises()
  h.store.cookieProblem.value = denied()
  h.store.loadCookies.mockImplementation(async () => { h.store.cookieProblem.value = null })
  await nextTick()
  await click('Повторить')
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(false)

  wrapper.unmount()
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
  await mountCenter('/consents/cookies'); await flushPromises()
  h.store.opsProblem.value = denied()
  h.store.loadOps.mockImplementation(async () => { h.store.opsProblem.value = null })
  await nextTick()
  expect(wrapper.find('.service-unavailable-page').exists()).toBe(true)
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
  const cookieOps = deferred()
  h.store.current.mockClear()
  h.store.opsProblem.value = denied()
  h.store.loadOps.mockImplementationOnce(() => cookieOps.promise)
  state().openCookies()
  await nextTick()
  wrapper.unmount()
  cookieOps.resolve({ kinds, cookieCategories }); await flushPromises()
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
  personalOps.resolve({ kinds, cookieCategories }); await flushPromises()
  expect(h.store.loadMine).not.toHaveBeenCalled()
  expect(h.store.current).not.toHaveBeenCalled()
})
it('refreshes only the visible explicit consent section when returning to the page', async () => {
  h.session.customer.value = { id:7 }
  vi.spyOn(globalThis.document, 'visibilityState', 'get').mockReturnValue('visible')
  await mountCenter('/consents/cookies'); await flushPromises()
  h.store.current.mockClear()
  globalThis.dispatchEvent(new globalThis.Event('focus')); await flushPromises()
  expect(h.store.current).toHaveBeenCalledTimes(1)
  expect(h.store.current).toHaveBeenCalledWith(LEGAL_DOCUMENT_KIND.COOKIE_CONSENT)

  wrapper.unmount()
  await mountCenter('/consents/personal-data'); await flushPromises()
  h.store.current.mockClear()
  globalThis.dispatchEvent(new globalThis.Event('focus')); await flushPromises()
  expect(h.store.current).toHaveBeenCalledTimes(1)
  expect(h.store.current).toHaveBeenCalledWith(LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT)
})
it('stops a combined foreground refresh before the second panel after unmount', async () => {
  h.session.customer.value = { id:7 }
  await mountCenter('/consents'); await flushPromises()
  const pendingCookie = deferred()
  h.store.current.mockClear()
  h.store.current.mockImplementationOnce(() => pendingCookie.promise)
  vi.spyOn(globalThis.document, 'visibilityState', 'get').mockReturnValue('visible')
  globalThis.dispatchEvent(new globalThis.Event('focus'))
  await vi.waitFor(() => expect(h.store.current).toHaveBeenCalledTimes(1))
  wrapper.unmount()
  pendingCookie.resolve({ document })
  await flushPromises()
  expect(h.store.current).toHaveBeenCalledTimes(1)
})
it('refreshes the cookie document when a routed receipt boundary is crossed', async () => {
  await mountCenter('/consents/cookies'); await flushPromises()
  h.store.serviceAllowed.value = true
  await flushPromises()
  h.store.current.mockClear()
  h.store.loadCookies.mockImplementationOnce(async () => { h.store.serviceAllowed.value = true })
  h.store.serviceAllowed.value = false
  await flushPromises()
  expect(h.store.loadCookies).toHaveBeenCalledTimes(2)
  expect(h.store.current).toHaveBeenCalledWith(LEGAL_DOCUMENT_KIND.COOKIE_CONSENT)
  expect(wrapper.findComponent(LegalDocumentReader).exists()).toBe(true)
  expect(state().busy).toBe(false)
  expect(state().cookieDocumentBusy).toBe(false)
})
it('finishes loading the routed cookie document when refreshed status becomes current', async () => {
  h.store.loadCookies.mockImplementation(async () => { h.store.serviceAllowed.value = true })
  await mountCenter('/consents/cookies'); await flushPromises()
  expect(h.store.current).toHaveBeenCalledWith(LEGAL_DOCUMENT_KIND.COOKIE_CONSENT)
  expect(wrapper.findComponent(LegalDocumentReader).exists()).toBe(true)
  expect(state().cookieDocumentBusy).toBe(false)
})
it('does not request a cookie document while the service is already allowed', async () => {
  h.store.serviceAllowed.value = true
  await mountCenter(); await flushPromises()
  expect(h.store.current).not.toHaveBeenCalled()
  vi.spyOn(globalThis.document, 'visibilityState', 'get').mockReturnValue('visible')
  globalThis.dispatchEvent(new globalThis.Event('focus')); await flushPromises()
  expect(h.store.current).not.toHaveBeenCalled()
  await router.push('/legal/privacy-policy'); await flushPromises()
  h.store.serviceAllowed.value = false
  await flushPromises()
  h.store.ops.value = null
  await nextTick()
  expect(wrapper.findAll('.cookie-notice__links a')).toHaveLength(0)
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

it('shows both consent sections to an authenticated customer and returns home through page navigation', async () => {
  h.session.customer.value = { id:7 }
  await mountCenter('/consents'); await flushPromises()
  expect(wrapper.get('h1').text()).toBe('Согласия')
  expect(wrapper.find('.consent-page__panel--cookies').exists()).toBe(true)
  expect(wrapper.find('.consent-page__panel--personal').exists()).toBe(true)
  expect(h.store.current).toHaveBeenCalledWith(LEGAL_DOCUMENT_KIND.COOKIE_CONSENT)
  expect(h.store.current).toHaveBeenCalledWith(LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT)
  expect(button('Дать согласие')).toBeTruthy()
  await click('На главную')
  expect(router.currentRoute.value.name).toBe('home')
})

it('uses h2 section headings on single consent pages and h3 beneath combined panel headings', async () => {
  await mountCenter('/consents/cookies'); await flushPromises()
  expect(wrapper.find('.consent-page__panel--cookies .consent-section h2').text()).toBe('Состояние в этом браузере')
  expect(wrapper.findAll('.consent-page__panel--cookies .consent-section h3')).toHaveLength(0)

  wrapper.unmount()
  h.session.customer.value = { id:7 }
  await mountCenter('/consents/personal-data'); await flushPromises()
  expect(wrapper.find('.consent-page__panel--personal .consent-section h2').text()).toBe('Состояние согласия')
  expect(wrapper.findAll('.consent-page__panel--personal .consent-section h3')).toHaveLength(0)

  wrapper.unmount()
  await mountCenter('/consents'); await flushPromises()
  expect(wrapper.findAll('.consent-page__panel-title')).toHaveLength(2)
  expect(wrapper.find('.consent-page__panel--cookies .consent-section h3').text()).toBe('Состояние в этом браузере')
  expect(wrapper.find('.consent-page__panel--personal .consent-section h3').text()).toBe('Состояние согласия')
})

it('opens a consent hash that was present before the customer session was restored', async () => {
  await mountCenter('/consents'); await flushPromises()
  expect(wrapper.get('h1').text()).toBe('Согласие на использование куки')
  expect(wrapper.find('.consent-page__panel--cookies').exists()).toBe(true)
  expect(wrapper.find('.consent-page__panel--personal').exists()).toBe(false)
  expect(button('Дать согласие')).toBeUndefined()
  h.session.customer.value = { id:7 }
  await flushPromises()
  expect(wrapper.get('h1').text()).toBe('Согласия')
  expect(wrapper.find('.consent-page__panel--personal').exists()).toBe(true)
  expect(button('Дать согласие')).toBeTruthy()
  expect(h.store.current).toHaveBeenCalledWith(LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT)
  await click('На главную')
  expect(router.currentRoute.value.name).toBe('home')
})

it('reuses idempotent consent keys but only refreshes status after a withdrawal failure', async () => {
  h.session.customer.value = { id:7 }
  await mountCenter('/consents/cookies'); await flushPromises()
  await wrapper.findAll('input[type=checkbox]')[0].setValue(true)
  h.store.decideCookies.mockRejectedValueOnce(denied())
  await click('Принять обязательные куки')
  const cookieKey = h.store.decideCookies.mock.calls[0][3]
  await click('Повторить')
  expect(h.store.decideCookies.mock.calls[1][3]).toBe(cookieKey)
  await click('Отказаться')
  expect(h.store.decideCookies.mock.calls[2][3]).not.toBe(cookieKey)
  wrapper.unmount()
  await mountCenter('/consents/personal-data'); await flushPromises()
  await wrapper.findAll('input[type=checkbox]')[0].setValue(true)
  h.store.grant.mockRejectedValueOnce(denied())
  await click('Дать согласие'); await click('Повторить')
  expect(h.store.grant.mock.calls[1][1]).toBe(h.store.grant.mock.calls[0][1])
  h.store.loadMine.mockClear()
  h.store.requestWithdrawal.mockRejectedValue(denied())
  await click('Прекратить использовать систему и отозвать согласие на обработку персональных данных')
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
  const action = button('Прекратить использовать систему и отозвать согласие на обработку персональных данных')
  expect(action.attributes('disabled')).toBeDefined()
  expect(wrapper.text()).toContain('Ожидает ручной обработки')
  h.store.mine.value.withdrawalRequest.processed = true; await nextTick()
  expect(action.attributes('disabled')).toBeUndefined()
})

it('reloads changed versions and resets affirmation without accepting the replacement automatically', async () => {
  const changed = new ProblemError(coreProblem(409, 'consent-version-changed'))
  h.session.customer.value = { id:7 }
  await mountCenter('/consents/cookies'); await flushPromises()
  await wrapper.findAll('input[type=checkbox]')[0].setValue(true)
  h.store.decideCookies.mockRejectedValueOnce(changed)
  await click('Принять обязательные куки')
  expect(wrapper.findAll('input[type=checkbox]').every(x => !x.element.checked)).toBe(true)
  expect(h.store.decideCookies).toHaveBeenCalledTimes(1)
  h.store.cookieProblem.value = denied()
  h.store.loadCookies.mockImplementation(async () => { h.store.cookieProblem.value = null })
  await nextTick()
  await click('Повторить')
  expect(h.store.decideCookies).toHaveBeenCalledTimes(1)
  wrapper.unmount()
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
  expect(wrapper.text()).toContain('Сервис недоступен')
  await click('Повторить')
  expect(wrapper.findComponent(LegalDocumentReader).exists()).toBe(true)
  expect(h.store.grant).toHaveBeenCalledTimes(2)
})
