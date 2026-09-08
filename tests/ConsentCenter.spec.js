// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application
import { ref, nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { createSarafanVuetify } from '../src/plugins/vuetify.js'
import ConsentCenter from '../src/components/ConsentCenter.vue'
import ConsentDialog from '../src/components/ConsentDialog.vue'
import LegalDocumentReader from '../src/components/LegalDocumentReader.vue'
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
  { value:0, name:'Согласие на куки', routeAlias:'cookie-consent' },
  { value:1, name:'Согласие на обработку персональных данных', routeAlias:'personal-data-consent' },
  { value:2, name:'Пользовательское соглашение', routeAlias:'user-agreement' },
  { value:3, name:'Правила заказа товаров', routeAlias:'order-rules' },
  { value:4, name:'Политика обработки персональных данных', routeAlias:'privacy-policy' }
]
const cookieCategories = [{ value:0, name:'Обязательные', required:true }]
const denied = () => createInternalProblem('serviceUnavailable')
let wrapper
const state = () => wrapper.vm.$.setupState
const button = text => wrapper.findAll('button').find(x => x.text() === text)
async function click(text) { expect(button(text), text).toBeTruthy(); await button(text).trigger('click'); await flushPromises() }
function mountCenter() {
  wrapper = mount(ConsentCenter, { global:{ plugins:[createSarafanVuetify()], stubs:{ VDialog:{ props:['modelValue'], template:'<section v-if="modelValue"><slot /></section>' } } } })
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
  mountCenter(); await flushPromises()
  expect(wrapper.findAll('.cookie-notice__links a')).toHaveLength(5)
  expect(wrapper.text()).toContain('необходимо принять обязательные куки')
  expect(button('Отказаться')).toBeTruthy()
  expect(button('Настроить куки')).toBeTruthy()
  expect(wrapper.findAll('input[type=checkbox]')).toHaveLength(1)
  expect(wrapper.find('input[type=checkbox]').element.checked).toBe(false)
  expect(button('Принять обязательные куки').classes()).toContain('consent-button--primary')
  expect(button('Принять обязательные куки').attributes('disabled')).toBeDefined()
  await wrapper.find('input[type=checkbox]').setValue(true)
  h.store.decideCookies.mockRejectedValueOnce(denied())
  await click('Принять обязательные куки')
  expect(wrapper.find('[role=alert]').text()).toContain('Сервис недоступен')
  expect(wrapper.find('input[type=checkbox]').element.checked).toBe(true)
  const key = h.store.decideCookies.mock.calls[0][3]
  await click('Принять обязательные куки')
  expect(h.store.decideCookies).toHaveBeenLastCalledWith(document, 'grant', [0], key)
  await click('Настроить куки')
  expect(wrapper.text()).toContain('Отдельный текст согласия.')
  expect(button('Принять обязательные куки').attributes('disabled')).toBeDefined()
  await wrapper.findAll('input[type=checkbox]')[0].setValue(true)
  await click('Отказаться')
  expect(h.store.decideCookies).toHaveBeenLastCalledWith(document, 'refuse', [], expect.any(String))
  h.store.cookies.value = { status:'current', categories:[0], documentId:id }
  await click('Настроить куки'); await click('Отозвать согласие на куки')
  expect(h.store.read).toHaveBeenCalledWith(id)
  expect(h.store.decideCookies).toHaveBeenLastCalledWith(document, 'withdraw', [], expect.any(String))
  h.store.cookies.value = { status:'withdrawn', categories:[], documentId:id }
  await nextTick()
  expect(wrapper.text()).toContain('Согласие на куки отозвано')
  await click('Настроить куки'); await click('Обновить документ'); await click('Закрыть')
})
it('keeps service unavailable and permits retry when the куки document is unavailable', async () => {
  h.store.current.mockResolvedValue({ document:null }); h.store.cookieProblem.value = denied()
  mountCenter(); await flushPromises()
  expect(button('Повторить загрузку')).toBeTruthy()
  await click('Настроить куки')
  expect(wrapper.text()).toContain('Использование сервиса недоступно')
  expect(button('Отказаться').attributes('disabled')).toBeDefined()
  await state().chooseCookies('refuse')
  expect(h.store.decideCookies).not.toHaveBeenCalled()
  await click('Закрыть')
})
it('refuses directly from the initial notice and then shows a grant-only recovery state', async () => {
  mountCenter(); await flushPromises()
  await click('Отказаться')
  expect(h.store.decideCookies).toHaveBeenLastCalledWith(document, 'refuse', [], expect.any(String))
  h.store.cookies.value = { status:'refused', categories:[], documentId:id }
  await nextTick()
  expect(wrapper.text()).toContain('Обязательные куки отклонены')
  expect(button('Отказаться')).toBeUndefined()
  expect(button('Принять обязательные куки')).toBeTruthy()
  expect(wrapper.find('input[type=checkbox]').element.checked).toBe(false)
})
it('associates an observed browser, renews personal consent and shows the latest manual request', async () => {
  h.session.customer.value = { id:7 }
  h.store.serviceAllowed.value = true
  h.store.mine.value = {
    statuses:[{ kind:LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT, status:'renewal-required' }],
    history:[{ id:'1', kind:LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT, decision:'grant', at:'2026-09-01T10:00:00Z', documentId:id, displayVersion:'1' }, { id:'2', kind:LEGAL_DOCUMENT_KIND.COOKIE_CONSENT, decision:'refuse', at:'2026-09-01T10:00:00Z', associatedAt:'2026-09-02T10:00:00Z', documentId:id, displayVersion:'1' }],
    withdrawalRequest:{ customerId:7, requestedAt:'2026-09-01T10:00:00Z', processed:true }
  }
  globalThis.history.replaceState(null, '', '/#consents')
  mountCenter(); await flushPromises()
  expect(h.store.associate).toHaveBeenCalled()
  expect(wrapper.text()).toContain('Требуется новое согласие')
  expect(wrapper.text()).toContain('Принятая версия1')
  expect(wrapper.text()).toContain('Актуальная версия2')
  expect(wrapper.findAll('.consent-history a').map(link => link.attributes('href'))).toEqual([`#legal/${id}`, `#legal/${id}`])
  expect(wrapper.text()).toContain('Связано с аккаунтом')
  expect(wrapper.text()).toContain('Обработан')
  expect(wrapper.text()).toContain('не отключает учётную запись')
  await state().grant(); expect(h.store.grant).not.toHaveBeenCalled()
  await wrapper.findAll('input[type=checkbox]')[0].setValue(true)
  await click('Дать согласие'); expect(h.store.grant).toHaveBeenCalledWith(document, expect.any(String))
  await click('Прекратить использовать систему и отозвать согласие на обработку персональных данных')
  expect(h.store.requestWithdrawal).toHaveBeenCalledWith()
  await click('Обновить')
  await wrapper.findComponent(LegalDocumentReader).vm.$emit('download'); await flushPromises()
  expect(h.store.source).toHaveBeenCalledWith(id)
  await click('Закрыть')
  h.session.customer.value = null; await flushPromises()
  expect(wrapper.text()).not.toContain('Покупатель')
  expect(h.store.resetCustomer).toHaveBeenCalledTimes(2)
})
it('shows personal-data and withdrawal failures without losing consent choices or identity', async () => {
  h.session.customer.value = { id:7 }; h.store.serviceAllowed.value = true; h.store.personalProblem.value = denied()
  h.store.associate.mockRejectedValueOnce(denied())
  globalThis.history.replaceState(null, '', '/#consents')
  mountCenter(); await flushPromises(); expect(wrapper.text()).toContain('Сервис недоступен')
  h.store.loadMine.mockRejectedValueOnce(denied()); await click('Обновить')
  expect(wrapper.text()).toContain('Сервис недоступен')
  await click('Обновить')
  await wrapper.findAll('input[type=checkbox]')[0].setValue(true)
  h.store.grant.mockRejectedValueOnce(denied()); await click('Дать согласие')
  expect(wrapper.findAll('input[type=checkbox]')[0].element.checked).toBe(true)
  h.store.requestWithdrawal.mockRejectedValueOnce(denied())
  await click('Прекратить использовать систему и отозвать согласие на обработку персональных данных')
  expect(h.session.customer.value.id).toBe(7)
  h.store.current.mockResolvedValue({ document:null }); await click('Обновить')
  expect(wrapper.findComponent(LegalDocumentReader).exists()).toBe(false)
})
it('makes immutable and current legal links available without login, including print and download', async () => {
  globalThis.history.replaceState(null, '', '/#legal/privacy-policy')
  mountCenter(); await flushPromises()
  expect(h.store.current).toHaveBeenCalledWith(LEGAL_DOCUMENT_KIND.PRIVACY_POLICY)
  expect(wrapper.text()).toContain('Отдельный текст согласия.')
  await click('Скачать Markdown'); expect(h.store.source).toHaveBeenCalledWith(id)
  vi.stubGlobal('print', vi.fn()); await click('Печать'); expect(globalThis.print).toHaveBeenCalled()
  await click('Повторить'); await click('Закрыть'); expect(globalThis.location.hash).toBe('')
  globalThis.history.replaceState(null, '', '/#legal/' + id)
  globalThis.dispatchEvent(new globalThis.Event('hashchange')); await flushPromises()
  expect(h.store.read).toHaveBeenCalledWith(id)
  await click('Закрыть')
  h.store.current.mockResolvedValue({ document:null })
  globalThis.history.replaceState(null, '', '/#legal/privacy-policy'); globalThis.dispatchEvent(new globalThis.Event('hashchange')); await flushPromises()
  expect(wrapper.text()).toContain('Документ пока не действует')
  h.store.current.mockRejectedValueOnce(denied()); await click('Повторить')
  expect(wrapper.text()).toContain('Сервис недоступен')
})
it('ignores a document response after closing and refreshes browser consent on foreground', async () => {
  let resolve
  h.store.current.mockImplementationOnce(() => new Promise(r => { resolve = r }))
  globalThis.history.replaceState(null, '', '/#legal/privacy-policy')
  mountCenter(); await nextTick(); await click('Закрыть'); resolve({ document }); await flushPromises()
  expect(wrapper.findComponent(LegalDocumentReader).exists()).toBe(false)
  vi.spyOn(globalThis.document, 'visibilityState', 'get').mockReturnValue('hidden')
  globalThis.document.dispatchEvent(new globalThis.Event('visibilitychange')); expect(h.store.loadCookies).not.toHaveBeenCalled()
  vi.spyOn(globalThis.document, 'visibilityState', 'get').mockReturnValue('visible')
  globalThis.document.dispatchEvent(new globalThis.Event('visibilitychange')); await flushPromises(); expect(h.store.loadCookies).toHaveBeenCalledTimes(1)
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
  wrapper.unmount()

  const opener = globalThis.document.createElement('button')
  globalThis.document.body.append(opener)
  opener.focus()
  wrapper = mount(ConsentDialog, {
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
})

it('opens consent management from the profile link and clears its hash when closed', async () => {
  h.session.customer.value = { id:7 }
  globalThis.history.replaceState(null, '', '/#consents')
  mountCenter(); await flushPromises()
  expect(h.store.current).toHaveBeenCalledWith(LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT)
  expect(button('Дать согласие')).toBeTruthy()
  await click('Закрыть')
  expect(globalThis.location.hash).toBe('')
})

it('opens a consent hash that was present before the customer session was restored', async () => {
  globalThis.history.replaceState(null, '', '/#consents')
  mountCenter(); await flushPromises()
  expect(button('Дать согласие')).toBeUndefined()
  h.session.customer.value = { id:7 }
  await flushPromises()
  expect(button('Дать согласие')).toBeTruthy()
  expect(h.store.current).toHaveBeenCalledWith(LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT)
})

it('reuses consent decision keys while the withdrawal request has no client key', async () => {
  h.session.customer.value = { id:7 }
  mountCenter(); await flushPromises(); await click('Настроить куки')
  await wrapper.findAll('input[type=checkbox]')[0].setValue(true)
  h.store.decideCookies.mockRejectedValueOnce(denied())
  await click('Принять обязательные куки')
  const cookieKey = h.store.decideCookies.mock.calls[0][3]
  await click('Отказаться')
  expect(h.store.decideCookies.mock.calls[1][3]).not.toBe(cookieKey)
  await click('Мои согласия и обращения')
  await wrapper.findAll('input[type=checkbox]')[0].setValue(true)
  h.store.grant.mockRejectedValueOnce(denied())
  await click('Дать согласие'); await click('Дать согласие')
  expect(h.store.grant.mock.calls[1][1]).toBe(h.store.grant.mock.calls[0][1])
  h.store.requestWithdrawal.mockRejectedValue(denied())
  await click('Прекратить использовать систему и отозвать согласие на обработку персональных данных')
  await click('Прекратить использовать систему и отозвать согласие на обработку персональных данных')
  expect(h.store.requestWithdrawal).toHaveBeenCalledTimes(2)
  expect(h.store.requestWithdrawal.mock.calls).toEqual([[], []])
})

it('disables repeat submission while the latest request is pending and enables it after processing', async () => {
  h.session.customer.value = { id:7 }
  h.store.mine.value = { statuses:[], history:[], withdrawalRequest:{ customerId:7, requestedAt:'2026-09-01T10:00:00Z', processed:false } }
  mountCenter(); await flushPromises(); await click('Мои согласия и обращения')
  const action = button('Прекратить использовать систему и отозвать согласие на обработку персональных данных')
  expect(action.attributes('disabled')).toBeDefined()
  expect(wrapper.text()).toContain('Ожидает ручной обработки')
  h.store.mine.value.withdrawalRequest.processed = true; await nextTick()
  expect(action.attributes('disabled')).toBeUndefined()
})

it('reloads changed versions and resets affirmation without accepting the replacement automatically', async () => {
  const changed = new ProblemError(coreProblem(409, 'consent-version-changed'))
  h.session.customer.value = { id:7 }
  mountCenter(); await flushPromises(); await click('Настроить куки')
  await wrapper.findAll('input[type=checkbox]')[0].setValue(true)
  h.store.decideCookies.mockRejectedValueOnce(changed)
  await click('Принять обязательные куки')
  expect(wrapper.findAll('input[type=checkbox]').every(x => !x.element.checked)).toBe(true)
  expect(h.store.decideCookies).toHaveBeenCalledTimes(1)
  await click('Закрыть'); await click('Мои согласия и обращения')
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
})
