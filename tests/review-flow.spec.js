// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ session:{}, consents:{}, renewal:{}, missing:[], realRenewal:false }))
vi.mock('../src/stores/session.js', () => ({ useSession:() => h.session }))
vi.mock('../src/stores/consents.js', () => ({ useConsents:() => h.consents }))
vi.mock('../src/useConsentRenewal.js', async importOriginal => {
  const original = await importOriginal()
  return { ...original, useConsentRenewal:() => h.realRenewal ? original.useConsentRenewal() : h.renewal }
})
import { createSarafanVuetify } from '../src/plugins/vuetify.js'
import CheckoutView from '../src/views/CheckoutView.vue'
import OrderDetailsView from '../src/views/OrderDetailsView.vue'
import { CORE_PROBLEM_TYPES, ProblemError, createInternalProblem } from '../src/errors/problem.js'
import { validateCustomerOrder, validateCustomerOrders, validateDeliveryEstimate } from '../src/stores/orders.js'
import { completeOrder, ops } from './fixtures/orders.js'

let wrapper, router, currentOrder, mountTarget
const legalDocument = kind => ({ id:'00000000-0000-4000-8000-' + String(kind).padStart(12, '0'), kind,
  title:kind === 2 ? 'Пользовательское соглашение' : 'Согласие на обработку персональных данных',
  html:'<p>Текст действующей редакции</p>', displayVersion:'1', contentHash:'a'.repeat(64), effectiveAt:'2026-09-01T00:00:00Z' })
function consentSnapshot() {
  return { customerId:h.session.customer.value?.id, serverNow:'2026-09-15T10:00:00Z', nextChangeAt:null,
    statuses:[1, 2].map(kind => ({ kind, status:h.missing.includes(kind) ? 'renewal-required' : 'current' })) }
}
function ready(overrides = {}) {
  return completeOrder({ status:100, estimatedDelivery:{ minimumDays:14, maximumDays:21 },
    reviewCompletedAt:'2026-09-15T10:00:00Z', reviewReason:null,
    pricing:{ state:100, totalRub:2500, calculatedAt:'2026-09-15T10:00:00Z', validUntil:'2026-09-16T10:00:00Z', asOf:'2026-09-15T10:00:00Z', domesticDeliveryRub:null, customsRub:null }, ...overrides })
}
async function render(path = '/orders/12345678-3', attached = false) {
  if (attached) { mountTarget = document.createElement('div'); document.body.appendChild(mountTarget) }
  router = createRouter({ history:createMemoryHistory(), routes:[
    { path:'/orders/:orderNumber', name:'order-details', component:OrderDetailsView },
    { path:'/orders/:orderNumber/checkout', name:'checkout', component:CheckoutView },
    { path:'/orders/:orderNumber/payment', name:'payment', component:{ template:'<h1>Оплата</h1>' } },
    { path:'/legal/:documentRef', name:'legal-document', component:{ template:'<h1>Соглашение</h1>' } }
  ] })
  await router.push(path)
  wrapper = mount({ template:'<RouterView />' }, { attachTo:mountTarget, global:{ plugins:[router, createSarafanVuetify()], stubs:{ UiDialog:{
    name:'UiDialog', props:['modelValue', 'title'], emits:['update:modelValue'],
    template:'<section v-if="modelValue" role="dialog"><h2>{{ title }}</h2><slot /><slot name="actions" /></section>'
  } } } })
  await flushPromises()
}
beforeEach(() => {
  currentOrder = ready()
  h.missing = []; h.realRenewal = false
  h.consents = {
    loadMine:vi.fn(async () => { h.consents.mine.value = consentSnapshot() }),
    missingKinds:vi.fn(async () => { await h.consents.loadMine(); return h.missing }),
    current:vi.fn(async kind => ({ document:legalDocument(kind), serverNow:'2026-09-15T10:00:00Z', nextChangeAt:null })),
    mine:ref(null), kindName:kind => legalDocument(kind).title, routeAlias:() => 'user-agreement',
    grant:vi.fn(async document => { h.missing = h.missing.filter(kind => kind !== document.kind); await h.consents.loadMine() })
  }
  const noticeTokens = new Set()
  h.consents.noticeSuppressed = ref(false)
  h.consents.acquireNoticeSuppression = vi.fn(() => {
    const token = Symbol(); noticeTokens.add(token); h.consents.noticeSuppressed.value = true
    return vi.fn(() => { noticeTokens.delete(token); h.consents.noticeSuppressed.value = noticeTokens.size > 0 })
  })
  h.renewal = { state:{ open:false, documents:[], reading:null, problem:null, problemKind:null }, cancel:vi.fn(), ensure:vi.fn(async () => { h.missing = []; await h.consents.loadMine(); return true }) }
  h.session.customer = ref({ id:7, phone:'+79990001234', profile:{ firstName:'Иван', lastName:'Иванов', postalCode:'123456', city:'Москва', address:'Адрес' } })
  h.session.refreshCustomer = vi.fn(async () => h.session.customer.value)
  h.session.orderRequest = vi.fn(async (path, _options, isCurrent, validate) => {
    const value = path.endsWith('/ops') ? ops : currentOrder
    if (isCurrent()) validate(value)
    return value
  })
})
afterEach(() => { wrapper?.unmount(); wrapper = null; mountTarget?.remove(); mountTarget = undefined; vi.useRealTimers() })

describe('review result and checkout entry', () => {
  it('shows ETA and rechecks the quote before opening the final form', async () => {
    await render()
    expect(wrapper.text()).toContain('14–21 дней')
    expect(wrapper.text()).toContain('Будут рассчитаны позже')
    const cta = wrapper.findAll('button').find(button => button.text() === 'Оформить заказ')
    expect(cta.classes()).toContain('ui-button--primary')
    await cta.trigger('click'); await flushPromises()
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('checkout'))
    expect(wrapper.get('form').text()).toContain('Получатель')
    expect(wrapper.get('input[name="phone"]').element.value).toBe('+79990001234')
    expect(wrapper.get('input[name="firstName"]').element.value).toBe('Иван')
    expect(wrapper.get('input[name="email"]').attributes('required')).toBeUndefined()
    expect(wrapper.findAll('input[name="delivery"]')).toHaveLength(2)
    expect(wrapper.get('input[name="sellerPrice"]').attributes('readonly')).toBeDefined()
    expect(wrapper.find('.order-review-card .order-item-fields').exists()).toBe(true)
    expect(wrapper.find('.order-review-card dl').exists()).toBe(false)
    expect(wrapper.text().match(/В разработке/g)).toHaveLength(3)
    expect(h.session.orderRequest.mock.calls.filter(([path]) => path === '/api/v1/orders/12345678-3')).toHaveLength(3)
  })
  it('reuses the read-only item card with formatted seller amounts and retained review metadata', async () => {
    currentOrder = ready({ showReviewFields:false, characteristics:{ Материал:'Хлопок <script>' }, dimensions:{ lengthCm:10, widthCm:20, heightCm:30 } })
    await render('/orders/12345678-3/checkout')
    const card = wrapper.get('.order-review-card')
    expect(card.get('input[name="sellerPrice"]').element.value).toBe('12,34 $')
    expect(card.findAll('input').some(input => input.element.value === '24,68 $')).toBe(true)
    expect(card.findAll('input').some(input => input.element.value === '10 × 20 × 30')).toBe(true)
    expect(card.findAll('input').some(input => input.element.value === 'Хлопок <script>')).toBe(true)
    expect(card.find('script').exists()).toBe(false)
    expect(card.findAll('input, textarea').every(input => input.attributes('readonly') !== undefined)).toBe(true)
    expect(card.get('.order-item-fields__comment textarea').element.value).toBe('Комментарий')
    expect(card.text()).not.toContain('НА ПРОВЕРКЕ')
    expect(wrapper.html().indexOf('customer-cost-summary')).toBeLessThan(wrapper.html().indexOf('order-review-card'))
  })
  it.each([0, 200, 500, 600])('blocks direct checkout for status %s', async status => {
    currentOrder = ready({ status, reviewReason:status === 600 ? 'Причина' : null, reviewCompletedAt:'2026-09-15T10:00:00Z' })
    await render('/orders/12345678-3/checkout')
    expect(wrapper.find('form').exists()).toBe(false)
    expect(wrapper.text()).toContain('Оформление доступно только для действующего расчёта')
  })
  it('does not open checkout when the quote expires during the click recheck', async () => {
    await render()
    currentOrder = ready({ status:200, pricing:{ ...currentOrder.pricing, state:200, asOf:'2026-09-16T10:00:00Z' } })
    await wrapper.findAll('button').find(button => button.text() === 'Оформить заказ').trigger('click')
    await flushPromises()
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('order-details'))
    expect(wrapper.text()).toContain('Расчёт истёк')
    expect(wrapper.text()).not.toContain('Оформить заказ')
  })
  it('closes checkout at the server-relative deadline and retains drafts on recheck', async () => {
    vi.useFakeTimers({ toFake:['setTimeout', 'clearTimeout'] })
    currentOrder.pricing.validUntil = '2026-09-15T10:00:01Z'
    await render('/orders/12345678-3/checkout')
    await wrapper.get('input[name="firstName"]').setValue('Пётр')
    globalThis.document.dispatchEvent(new globalThis.Event('visibilitychange')); await flushPromises()
    expect(wrapper.get('input[name="firstName"]').element.value).toBe('Пётр')
    await vi.advanceTimersByTimeAsync(1000)
    expect(wrapper.find('form').exists()).toBe(false)
  })
  it('displays the negative reason safely and offers no checkout or cancellation', async () => {
    currentOrder = ready({ status:600, reviewReason:'<script>alert(1)</script>' })
    await render()
    expect(wrapper.text()).toContain('Не можем привезти')
    expect(wrapper.text()).toContain('<script>alert(1)</script>')
    expect(wrapper.find('script').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Отменить заказ')
    expect(wrapper.text()).not.toContain('Оформить заказ')
  })
  it('blocks invalid and inaccessible checkout routes', async () => {
    await render('/orders/ops/checkout')
    expect(h.session.orderRequest).not.toHaveBeenCalled()
    expect(wrapper.find('form').exists()).toBe(false)
    h.session.orderRequest.mockRejectedValue(createInternalProblem('protocolError'))
    await router.push('/orders/12345678-3/checkout'); await flushPromises()
    expect(wrapper.find('form').exists()).toBe(false)
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
  })
  it('discards a stale checkout response after identity changes', async () => {
    let resolveOld
    h.session.orderRequest.mockImplementation((path, _options, isCurrent, validate) => {
      if (path.endsWith('/ops')) { validate(ops); return Promise.resolve(ops) }
      if (!resolveOld) return new Promise(resolve => { resolveOld = () => { if (isCurrent()) validate(currentOrder); resolve(currentOrder) } })
      return Promise.reject(createInternalProblem('protocolError'))
    })
    await render('/orders/12345678-3/checkout')
    h.session.customer.value = { id:8 }; await flushPromises()
    resolveOld(); await flushPromises()
    expect(wrapper.find('form').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Иванов')
  })
})

it.each([{ minimumDays:0, maximumDays:1 }, { minimumDays:20, maximumDays:14 }, { minimumDays:1.5, maximumDays:2 }, { minimumDays:1, maximumDays:366 }, {}])('rejects malformed ETA %#', value => {
  expect(() => validateDeliveryEstimate(value)).toThrow()
  expect(() => validateCustomerOrder(ready({ estimatedDelivery:value }), ops, '12345678-3')).toThrow()
  expect(() => validateCustomerOrders([ready({ estimatedDelivery:value })], ops)).toThrow()
})

function paymentButton() { return wrapper.findAll('button').find(button => button.text() === 'Оплатить заказ') }
function savedCheckout(payload) {
  const fields = ['lastName', 'firstName', 'patronymic', 'email', 'passportSeries', 'passportNumber', 'passportIssueDate', 'passportIssuedBy', 'inn', 'postalCode', 'city', 'address']
  return { profile:{ ...Object.fromEntries(fields.map(field => [field, null])), ...h.session.customer.value.profile, ...payload.profile, ...payload.deliveryAddress,
    phone:'+79990001234' },
    delivery:{ routeAlias:payload.delivery, name:ops.checkoutDeliveries.find(row => row.routeAlias === payload.delivery).name, destination:payload.delivery === 'courier' ? '123456, Москва, Адрес' : ops.checkoutDeliveries[1].destination } }
}
describe('checkout completion', () => {
  it('returns to the order from its secondary header button without saving checkout', async () => {
    await render('/orders/12345678-3/checkout')
    const back = wrapper.findAll('button').find(button => button.text() === 'Вернуться к заказу')
    expect(back.element.closest('header')).not.toBeNull()
    expect(back.classes()).toContain('ui-button--secondary')
    expect(wrapper.find('a[href="/orders/12345678-3"]').exists()).toBe(false)
    await back.trigger('click'); await flushPromises()
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('order-details'))
    expect(h.session.orderRequest.mock.calls.some(([, options]) => options.method === 'POST')).toBe(false)
  })
  it('gates the CTA, saves optional email with the read-only account phone, then continues to payment', async () => {
    await render('/orders/12345678-3/checkout', true)
    expect(paymentButton().attributes('disabled')).toBeDefined()
    expect(wrapper.findAll('button').filter(button => button.text() === 'Оплатить заказ')).toHaveLength(1)
    expect(paymentButton().element.closest('header')).not.toBeNull()
    expect(paymentButton().element.form).toBe(wrapper.get('form').element)
    expect(wrapper.get('form').find('button[type="submit"]').exists()).toBe(false)
    expect(wrapper.get('a[href="/legal/user-agreement"]').text()).toBe('«Пользовательское соглашение»')
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Заказ оформляется на условиях')
    expect(wrapper.text()).not.toContain('Подтвердить документы')
    await wrapper.get('input[value="pickup"]').setValue(true)
    await wrapper.get('input[name="email"]').setValue('test@example.com')
    const passport = { inn:'770123456789', passportSeries:'45 00', passportNumber:'123456', passportIssueDate:'2020-01-02', passportIssuedBy:'ОВД\nМосква' }
    for (const [field, value] of Object.entries(passport)) await wrapper.get(`[name="${field}"]`).setValue(value)
    expect(wrapper.get('input[name="inn"]').attributes()).toMatchObject({ inputmode:'numeric', maxlength:'12' })
    expect(wrapper.get('textarea[name="passportIssuedBy"]').attributes()).toMatchObject({ rows:'2', maxlength:'500' })
    expect(wrapper.get('textarea[name="passportIssuedBy"]').element.closest('.ui-form-grid__wide')).not.toBeNull()

    expect(wrapper.get('input[name="phone"]').attributes('readonly')).toBeDefined()
    expect(wrapper.find('[name="birthDate"]').exists()).toBe(false)
    expect(wrapper.find('[name="passportDepartmentCode"]').exists()).toBe(false)
    expect(paymentButton().attributes('disabled')).toBeUndefined()
    h.session.orderRequest.mockImplementation(async (path, options, isCurrent, validate) => {
      const payload = JSON.parse(options.body)
      expect(path).toBe('/api/v1/orders/12345678-3/checkout')
      expect(payload.profile.email).toBe('test@example.com')
      expect(payload.profile).toMatchObject(passport)
      expect(payload).not.toHaveProperty('recipientPhone')
      expect(payload).not.toHaveProperty('birthDate')
      expect(payload).not.toHaveProperty('passportDepartmentCode')
      expect(payload.profile).not.toHaveProperty('phone')
      expect(payload.expectedUpdatedAt).toBe(currentOrder.updatedAt)
      const value = { ...currentOrder, checkout:savedCheckout(payload) }
      if (isCurrent()) validate(value)
      return value
    })
    paymentButton().element.click(); await flushPromises()
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('payment'))
    expect(h.session.customer.value.phone).toBe('+79990001234')
    expect(h.session.refreshCustomer).toHaveBeenCalledOnce()
  })
  it('opens the shared renewal flow on entry and lets cancellation preserve the checkout draft', async () => {
    h.missing = [2]
    h.renewal.ensure.mockImplementation(async () => { await h.consents.loadMine(); return false })
    await render('/orders/12345678-3/checkout')
    expect(h.renewal.ensure).toHaveBeenCalledWith([1, 2], expect.any(Function))
    await wrapper.get('input[value="courier"]').setValue(true)
    await wrapper.get('input[name="firstName"]').setValue('Пётр')
    const calls = h.session.orderRequest.mock.calls.length
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(h.session.orderRequest).toHaveBeenCalledTimes(calls)
    expect(wrapper.get('input[name="firstName"]').element.value).toBe('Пётр')
    expect(paymentButton().attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Подтвердить документы')
  })
  it('retries failed entry loads with profile defaults and account phone', async () => {
    h.session.orderRequest.mockRejectedValueOnce(createInternalProblem('protocolError'))
    await render('/orders/12345678-3/checkout')
    await wrapper.findAll('button').find(button => button.text() === 'Повторить').trigger('click'); await flushPromises()
    expect(wrapper.get('input[name="firstName"]').element.value).toBe('Иван')
    expect(wrapper.get('input[name="phone"]').element.value).toBe('+79990001234')
  })
  it.each(['email', 'passportIssuedBy'])('keeps %s field validation within the form without losing values', async field => {
    await render('/orders/12345678-3/checkout')
    await wrapper.get('input[value="pickup"]').setValue(true)
    await wrapper.get(`[name="${field}"]`).setValue('incorrect')
    h.session.orderRequest.mockRejectedValue(createInternalProblem('invalidInput', { errors:{ ['profile.' + field]:['Проверьте значение.'] } }))
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(router.currentRoute.value.name).toBe('checkout')
    expect(wrapper.get(`[name="${field}"]`).element.value).toBe('incorrect')
    expect(wrapper.get(`[name="${field}"]`).attributes('aria-invalid')).toBe('true')
    expect(wrapper.text()).toContain('Проверьте значение.')
  })
  it('uses saved recipient and delivery snapshots when reopening checkout', async () => {
    currentOrder.checkout = savedCheckout({ profile:{ firstName:'Пётр', lastName:'Петров' }, delivery:'courier' })
    await render('/orders/12345678-3/checkout')
    expect(wrapper.get('input[name="firstName"]').element.value).toBe('Пётр')
    expect(wrapper.text()).toContain('123456, Москва, Адрес')
    expect(wrapper.findAll('input[name="delivery"]')).toHaveLength(2)
  })
  it('renews changed versions through the same popup before saving without losing data', async () => {
    await render('/orders/12345678-3/checkout')
    await wrapper.get('input[value="pickup"]').setValue(true)
    await wrapper.get('input[name="firstName"]').setValue('Пётр')
    let accept
    h.renewal.ensure.mockImplementationOnce(() => new Promise(resolve => { accept = resolve }))
    const calls = h.session.orderRequest.mock.calls.length
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(h.session.orderRequest).toHaveBeenCalledTimes(calls)
    expect(paymentButton().attributes('disabled')).toBeDefined()
    h.session.orderRequest.mockImplementationOnce(async (_path, options, isCurrent, validate) => {
      const payload = JSON.parse(options.body)
      expect(payload.profile.firstName).toBe('Пётр')
      const value = { ...currentOrder, checkout:savedCheckout(payload) }
      if (isCurrent()) validate(value)
      return value
    })
    accept(true); await flushPromises()
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('payment'))
  })
  it('renews a server-side version race and retries the same checkout action only once', async () => {
    await render('/orders/12345678-3/checkout')
    await wrapper.get('input[value="pickup"]').setValue(true)
    const versionChanged = new ProblemError({ type:CORE_PROBLEM_TYPES.consentVersionChanged, status:409, code:'consent_version_changed', title:'Версия изменилась', detail:'Подтвердите документ.' })
    h.session.orderRequest.mockRejectedValueOnce(versionChanged).mockImplementationOnce(async (_path, options, isCurrent, validate) => {
      const value = { ...currentOrder, checkout:savedCheckout(JSON.parse(options.body)) }
      if (isCurrent()) validate(value)
      return value
    })
    await wrapper.get('form').trigger('submit'); await flushPromises()
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('payment'))
    const writes = h.session.orderRequest.mock.calls.filter(([, options]) => options.method === 'POST')
    expect(writes).toHaveLength(2)
    expect(writes[0][1].body).toBe(writes[1][1].body)
    expect(h.renewal.ensure).toHaveBeenCalledTimes(3)
  })
  it('does not loop when another legal version race follows the retry', async () => {
    await render('/orders/12345678-3/checkout')
    await wrapper.get('input[value="pickup"]').setValue(true)
    h.session.orderRequest.mockRejectedValue(new ProblemError({ type:CORE_PROBLEM_TYPES.userAgreementRequired, status:403, code:'user_agreement_required', title:'Подтвердите документ', detail:'Требуется соглашение.' }))
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(h.session.orderRequest.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(2)
    expect(wrapper.text()).toContain('Требуется соглашение.')
    expect(router.currentRoute.value.name).toBe('checkout')
  })
  it.each([200, 500])('retains a successful checkout response with status %s without treating it as a protocol failure', async status => {
    await render('/orders/12345678-3/checkout')
    await wrapper.get('input[value="pickup"]').setValue(true)
    h.session.orderRequest.mockImplementationOnce(async (_path, options, isCurrent, validate) => {
      const value = { ...currentOrder, status, updatedAt:'2026-09-16T10:00:00Z', checkout:savedCheckout(JSON.parse(options.body)), canCancel:status === 200,
        cancelledAt:status === 500 ? '2026-09-16T10:00:00Z' : null,
        pricing:{ ...currentOrder.pricing, state:200, asOf:'2026-09-16T10:00:00Z' } }
      if (isCurrent()) validate(value)
      return value
    })
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(h.session.customer.value.id).toBe(7)
    expect(h.session.refreshCustomer).not.toHaveBeenCalled()
    expect(router.currentRoute.value.name).toBe('checkout')
    expect(wrapper.text()).toContain('Оформление доступно только для действующего расчёта')
    expect(wrapper.text()).not.toContain('Сервис временно недоступен')
  })
  it('discards save replies after switching accounts', async () => {
    await render('/orders/12345678-3/checkout')
    await wrapper.get('input[value="pickup"]').setValue(true)
    let finish
    h.session.orderRequest.mockImplementationOnce((_path, options, isCurrent, validate) => new Promise(resolve => {
      const data = { ...currentOrder, checkout:savedCheckout(JSON.parse(options.body)) }
      finish = () => { if (isCurrent()) validate(data); resolve(data) }
    }))
    await wrapper.get('form').trigger('submit'); await flushPromises()
    for (const field of ['inn', 'passportSeries', 'passportNumber', 'passportIssueDate', 'passportIssuedBy']) {
      expect(wrapper.get(`[name="${field}"]`).attributes('disabled')).toBeDefined()
    }
    h.session.customer.value = { id:8, phone:'+79990001111', profile:{} }; await flushPromises()
    finish(); await flushPromises()
    expect(router.currentRoute.value.name).toBe('checkout')
    expect(h.session.refreshCustomer).not.toHaveBeenCalled()
  })
})

it.each([CORE_PROBLEM_TYPES.orderUpdateConflict, CORE_PROBLEM_TYPES.orderCheckoutUnavailable])('recovers checkout conflicts, retains recipient draft, and reconciles saved delivery: %s', async type => {
  await render('/orders/12345678-3/checkout')
  await wrapper.get('input[value="courier"]').setValue(true)
  await wrapper.get('input[name="firstName"]').setValue('Мой получатель')
  h.session.orderRequest.mockRejectedValueOnce(new ProblemError({ type, title:'Заказ изменился', detail:'Обновите заказ.', status:409, code:type.split('/').at(-1).replaceAll('-', '_'), errors:{ delivery:['Проверьте адрес.'], order:['Обновите заказ.'] } }))
  await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(paymentButton().attributes('disabled')).toBeDefined()
  currentOrder = { ...currentOrder, updatedAt:'2026-09-15T10:00:01Z', checkout:savedCheckout({ profile:{ firstName:'Чужая правка', lastName:'Иванов' }, delivery:'pickup' }) }
  const beforeRevisit = h.session.orderRequest.mock.calls.length
  document.dispatchEvent(new globalThis.Event('visibilitychange')); await flushPromises()
  await wrapper.findComponent(CheckoutView).vm.$.setupState.load()
  expect(h.session.orderRequest).toHaveBeenCalledTimes(beforeRevisit)
  expect(paymentButton().attributes('disabled')).toBeDefined()
  expect(wrapper.get('input[value="courier"]').element.checked).toBe(true)
  await wrapper.findAll('button').find(button => button.text() === 'Обновить адрес доставки').trigger('click'); await flushPromises()
  expect(paymentButton().attributes('disabled')).toBeDefined()
  expect(wrapper.findAll('button').some(button => button.text() === 'Обновить данные заказа')).toBe(true)
  await wrapper.findAll('button').find(button => button.text() === 'Обновить данные заказа').trigger('click'); await flushPromises()
  expect(wrapper.get('input[name="firstName"]').element.value).toBe('Мой получатель')
  expect(wrapper.text()).toContain('Тестовый ПВЗ')
  expect(wrapper.findAll('input[name="delivery"]')).toHaveLength(2)
  expect(paymentButton().attributes('disabled')).toBeUndefined()
  h.session.orderRequest.mockImplementationOnce(async (_path, options, isCurrent, validate) => {
    const payload = JSON.parse(options.body)
    expect(payload.expectedUpdatedAt).toBe(currentOrder.updatedAt)
    expect(payload.profile.firstName).toBe('Мой получатель')
    expect(payload.delivery).toBe('pickup')
    const value = { ...currentOrder, checkout:savedCheckout(payload) }
    if (isCurrent()) validate(value)
    return value
  })
  await wrapper.get('form').trigger('submit'); await flushPromises()
  await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('payment'))
})

it.each(['postalCode', 'city', 'address'])('requires %s for courier, but permits test pickup', async field => {
  h.session.customer.value.profile[field] = null
  await render('/orders/12345678-3/checkout')
  expect(wrapper.findAll('input[name="delivery"]')).toHaveLength(2)
  expect(wrapper.text()).not.toContain('Тестовый адрес:')
  await wrapper.get('input[value="courier"]').setValue(true)
  expect(paymentButton().attributes('disabled')).toBeDefined()
  expect(wrapper.text()).toContain('Заполните адрес доставки')
  await wrapper.get('input[value="pickup"]').setValue(true)
  expect(paymentButton().attributes('disabled')).toBeUndefined()
})
it('submits the displayed courier address and refreshes a stale address without losing recipient edits', async () => {
  await render('/orders/12345678-3/checkout')
  await wrapper.get('input[value="courier"]').setValue(true)
  await wrapper.get('input[name="firstName"]').setValue('Черновик')
  h.session.orderRequest.mockImplementationOnce(async (_path, options) => {
    expect(JSON.parse(options.body).expectedDeliveryAddress).toEqual({ postalCode:'123456', city:'Москва', address:'Адрес' })
    throw createInternalProblem('invalidInput', { errors:{ delivery:['Адрес изменился.'] } })
  })
  await wrapper.get('form').trigger('submit'); await flushPromises()
  h.session.refreshCustomer.mockResolvedValue({ profile:{ postalCode:'654321', city:'Казань', address:'Новый адрес' } })
  await wrapper.findAll('button').find(b => b.text() === 'Обновить адрес доставки').trigger('click'); await flushPromises()
  expect(wrapper.text()).toContain('654321, Казань, Новый адрес')
  expect(wrapper.get('input[name="firstName"]').element.value).toBe('Черновик')
})

it('embeds shared address fields and submits them with checkout without saving the profile separately', async () => {
  h.session.customer.value.profile = { firstName:'Иван', lastName:'Иванов' }
  await render('/orders/12345678-3/checkout')
  await wrapper.get('input[value="courier"]').setValue(true)
  await wrapper.get('input[name="firstName"]').setValue('Черновик')
  expect(wrapper.findComponent({ name:'DeliveryAddressDialog' }).exists()).toBe(false)
  expect(wrapper.get('input[name="postalCode"]').attributes()).toMatchObject({ required:'', maxlength:'20' })
  expect(wrapper.get('input[name="city"]').attributes('maxlength')).toBe('150')
  expect(wrapper.get('textarea[name="address"]').attributes()).toMatchObject({ rows:'2', maxlength:'500' })
  expect(wrapper.get('textarea[name="address"]').element.closest('.ui-form-grid__wide')).not.toBeNull()
  const before = h.session.orderRequest.mock.calls.length
  await wrapper.get('[name="postalCode"]').setValue(' 654321 ')
  await wrapper.get('[name="city"]').setValue(' Казань ')
  await wrapper.get('[name="address"]').setValue(' Новый адрес ')
  expect(h.session.orderRequest).toHaveBeenCalledTimes(before)
  expect(wrapper.get('input[name="firstName"]').element.value).toBe('Черновик')
  let submitted
  h.session.orderRequest.mockImplementationOnce(async (_path, options, isCurrent, validate) => {
    submitted = JSON.parse(options.body)
    const value = { ...currentOrder, checkout:savedCheckout(submitted) }
    if (isCurrent()) validate(value)
    return value
  })
  await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(submitted.deliveryAddress).toEqual({ postalCode:'654321', city:'Казань', address:'Новый адрес' })
  expect(submitted.expectedDeliveryAddress).toEqual({ postalCode:'', city:'', address:'' })
  expect(submitted.profile.firstName).toBe('Черновик')
  await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('payment'))
})
it('shows address refresh failure and retains the courier draft', async () => {
  await render('/orders/12345678-3/checkout')
  await wrapper.get('input[value="courier"]').setValue(true)
  h.session.orderRequest.mockRejectedValueOnce(createInternalProblem('invalidInput', { errors:{ delivery:['Обновите адрес.'] } }))
  await wrapper.get('form').trigger('submit'); await flushPromises()
  h.session.refreshCustomer.mockRejectedValue(createInternalProblem('invalidInput'))
  await wrapper.findAll('button').find(b => b.text() === 'Обновить адрес доставки').trigger('click'); await flushPromises()
  expect(wrapper.find('[role="alert"]').exists()).toBe(true)
  expect(wrapper.text()).toContain('123456, Москва, Адрес')
})

it('keeps address entry and courier selection available for a saved pickup checkout', async () => {
  currentOrder.checkout = savedCheckout({ profile:{ firstName:'Пётр', lastName:'Петров' }, delivery:'pickup' })
  await render('/orders/12345678-3/checkout')
  expect(wrapper.get('input[value="pickup"]').element.checked).toBe(true)
  expect(wrapper.get('input[value="courier"]').attributes('disabled')).toBeUndefined()
  await wrapper.get('input[value="courier"]').setValue(true)
  expect(wrapper.get('[name="address"]').element.value).toBe('Адрес')
  let submittedPayload
  h.session.orderRequest.mockImplementationOnce(async (_path, options, isCurrent, validate) => {
    const payload = JSON.parse(options.body)
    submittedPayload = payload
    const value = { ...currentOrder, checkout:savedCheckout(payload) }
    if (isCurrent()) validate(value)
    return value
  })
  await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(submittedPayload?.delivery).toBe('courier')
  expect(submittedPayload?.expectedDeliveryAddress).toEqual({ postalCode:'123456', city:'Москва', address:'Адрес' })
  await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('payment'))
})
it('keeps a saved courier destination until the customer explicitly edits its address', async () => {
  currentOrder.checkout = savedCheckout({ profile:{ firstName:'Пётр', lastName:'Петров' }, delivery:'courier' })
  h.session.customer.value.profile.address = 'Другой адрес профиля'
  await render('/orders/12345678-3/checkout')
  expect(wrapper.text()).toContain('123456, Москва, Адрес')
  expect(wrapper.text()).not.toContain('Другой адрес профиля')
  expect(wrapper.get('[name="address"]').element.value).toBe('Адрес')
  await wrapper.get('[name="postalCode"]').setValue('654321')
  await wrapper.get('[name="city"]').setValue('Казань')
  await wrapper.get('[name="address"]').setValue('Новый адрес')
  expect(wrapper.text()).toContain('654321, Казань, Новый адрес')
  h.session.orderRequest.mockImplementationOnce(async (_path, options, isCurrent, validate) => {
    const payload = JSON.parse(options.body)
    expect(payload.expectedDeliveryAddress).toEqual({ postalCode:'123456', city:'Москва', address:'Другой адрес профиля' })
    expect(payload.deliveryAddress).toEqual({ postalCode:'654321', city:'Казань', address:'Новый адрес' })
    const value = { ...currentOrder, checkout:savedCheckout(payload) }
    if (isCurrent()) validate(value)
    return value
  })
  await wrapper.get('form').trigger('submit'); await flushPromises()
  await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('payment'))
})
it('retains an unsaved delivery change across a tab-return refresh', async () => {
  currentOrder.checkout = savedCheckout({ profile:{ firstName:'Иван', lastName:'Иванов' }, delivery:'pickup' })
  await render('/orders/12345678-3/checkout')
  await wrapper.get('input[value="courier"]').setValue(true)
  document.dispatchEvent(new globalThis.Event('visibilitychange')); await flushPromises()
  expect(wrapper.get('input[value="courier"]').element.checked).toBe(true)
})

it.each(['postalCode', 'city', 'address'])('shows inline %s validation, focuses it, and retains the address draft', async field => {
  await render('/orders/12345678-3/checkout', true)
  await wrapper.get('input[value="courier"]').setValue(true)
  await wrapper.get('[name="address"]').setValue('Мой адрес')
  h.session.orderRequest.mockRejectedValueOnce(createInternalProblem('invalidInput', { errors:{ ['deliveryAddress.' + field]:['Проверьте адрес.'] } }))
  await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(wrapper.get('[name="' + field + '"]').attributes('aria-invalid')).toBe('true')
  expect(document.activeElement).toBe(wrapper.get('[name="' + field + '"]').element)
  expect(wrapper.text().match(/Проверьте адрес./g)).toHaveLength(1)
  expect(wrapper.get('[name="address"]').element.value).toBe('Мой адрес')
  expect(router.currentRoute.value.name).toBe('checkout')
})
it('retains inline address edits through consent cancellation and tab-return refresh', async () => {
  await render('/orders/12345678-3/checkout')
  await wrapper.get('input[value="courier"]').setValue(true)
  await wrapper.get('[name="address"]').setValue('Черновик адреса')
  h.renewal.ensure.mockResolvedValueOnce(false)
  await wrapper.get('form').trigger('submit'); await flushPromises()
  document.dispatchEvent(new globalThis.Event('visibilitychange')); await flushPromises()
  expect(wrapper.get('[name="address"]').element.value).toBe('Черновик адреса')
  expect(h.session.orderRequest.mock.calls.some(([, options]) => options.method === 'POST')).toBe(false)
})
it('preserves address edits during order conflict recovery', async () => {
  await render('/orders/12345678-3/checkout')
  await wrapper.get('input[value="courier"]').setValue(true)
  await wrapper.get('[name="address"]').setValue('Черновик адреса')
  h.session.orderRequest.mockRejectedValueOnce(new ProblemError({ type:CORE_PROBLEM_TYPES.orderUpdateConflict, title:'Заказ изменился', detail:'Обновите заказ.', status:409, code:'order_update_conflict' }))
  await wrapper.get('form').trigger('submit'); await flushPromises()
  await wrapper.findAll('button').find(b => b.text() === 'Обновить данные заказа').trigger('click'); await flushPromises()
  expect(wrapper.get('[name="address"]').element.value).toBe('Черновик адреса')
})
it('does not submit an inline courier draft when pickup is selected', async () => {
  await render('/orders/12345678-3/checkout')
  await wrapper.get('input[value="courier"]').setValue(true)
  await wrapper.get('[name="address"]').setValue('Черновик адреса')
  await wrapper.get('input[value="pickup"]').setValue(true)
  expect(wrapper.find('[name="address"]').exists()).toBe(false)
  let submitted
  h.session.orderRequest.mockImplementationOnce(async (_path, options, isCurrent, validate) => {
    submitted = JSON.parse(options.body)
    if (isCurrent()) validate({ ...currentOrder, checkout:savedCheckout(submitted) })
  })
  await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(submitted.delivery).toBe('pickup')
  expect(submitted).not.toHaveProperty('deliveryAddress')
  expect(submitted).not.toHaveProperty('expectedDeliveryAddress')
})

it('synchronizes unedited inline fields with a courier snapshot changed in another tab', async () => {
  currentOrder.checkout = savedCheckout({ profile:{ firstName:'Иван', lastName:'Иванов' }, delivery:'courier' })
  await render('/orders/12345678-3/checkout')
  expect(wrapper.get('[name="address"]').element.value).toBe('Адрес')
  currentOrder = { ...currentOrder, updatedAt:'2026-09-15T10:00:01Z', checkout:{
    profile:{ ...currentOrder.checkout.profile, address:'Адрес из другой вкладки' },
    delivery:{ ...currentOrder.checkout.delivery, destination:'123456, Москва, Адрес из другой вкладки' }
  } }
  document.dispatchEvent(new globalThis.Event('visibilitychange')); await flushPromises()
  expect(wrapper.get('[name="address"]').element.value).toBe('Адрес из другой вкладки')
  expect(wrapper.text()).toContain('123456, Москва, Адрес из другой вкладки')
  let submitted
  h.session.orderRequest.mockImplementationOnce(async (_path, options, isCurrent, validate) => {
    submitted = JSON.parse(options.body)
    if (isCurrent()) validate(currentOrder)
  })
  await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(submitted.expectedUpdatedAt).toBe(currentOrder.updatedAt)
  expect(submitted).not.toHaveProperty('deliveryAddress')
  expect(submitted).not.toHaveProperty('expectedDeliveryAddress')
})
it('keeps edited inline fields when another tab changes the saved courier address', async () => {
  currentOrder.checkout = savedCheckout({ profile:{ firstName:'Иван', lastName:'Иванов' }, delivery:'courier' })
  await render('/orders/12345678-3/checkout')
  await wrapper.get('[name="address"]').setValue('Мой черновик')
  currentOrder = { ...currentOrder, updatedAt:'2026-09-15T10:00:01Z', checkout:{
    profile:{ ...currentOrder.checkout.profile, address:'Адрес из другой вкладки' },
    delivery:{ ...currentOrder.checkout.delivery, destination:'123456, Москва, Адрес из другой вкладки' }
  } }
  document.dispatchEvent(new globalThis.Event('visibilitychange')); await flushPromises()
  expect(wrapper.get('[name="address"]').element.value).toBe('Мой черновик')
  let submitted
  h.session.orderRequest.mockImplementationOnce(async (_path, options) => {
    submitted = JSON.parse(options.body)
    throw createInternalProblem('invalidInput', { errors:{ delivery:['Обновите адрес.'] } })
  })
  await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(submitted.deliveryAddress.address).toBe('Мой черновик')
  expect(submitted.expectedDeliveryAddress.address).toBe('Адрес')
  expect(wrapper.get('[name="address"]').element.value).toBe('Мой черновик')
})
it('disables inline address editing during a pending checkout save', async () => {
  await render('/orders/12345678-3/checkout')
  await wrapper.get('input[value="courier"]').setValue(true)
  let finish
  h.renewal.ensure.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await wrapper.get('form').trigger('submit'); await flushPromises()
  for (const field of ['postalCode', 'city', 'address']) expect(wrapper.get('[name="' + field + '"]').attributes('disabled')).toBeDefined()
  finish(false); await flushPromises()
  expect(wrapper.get('[name="address"]').attributes('disabled')).toBeUndefined()
})


describe('checkout recovery and foreground consent ownership', () => {
  it('keeps the conflict gate after failed recovery until explicit retry reconciles delivery', async () => {
    await render('/orders/12345678-3/checkout');
    await wrapper.get('input[value="courier"]').setValue(true);
    await wrapper.get('input[name="firstName"]').setValue('Мой получатель');
    h.session.orderRequest.mockRejectedValueOnce(new ProblemError({ type:CORE_PROBLEM_TYPES.orderUpdateConflict,
      title:'Заказ изменился', detail:'Обновите заказ.', status:409, code:'order_update_conflict' }));
    await wrapper.get('form').trigger('submit'); await flushPromises();
    currentOrder = { ...currentOrder, updatedAt:'2026-09-15T10:00:01Z', checkout:savedCheckout({ profile:{}, delivery:'pickup' }) };
    h.session.orderRequest.mockRejectedValueOnce(createInternalProblem('protocolError'));
    await wrapper.findAll('button').find(button => button.text() === 'Обновить данные заказа').trigger('click'); await flushPromises();
    expect(wrapper.findComponent(CheckoutView).vm.$.setupState.conflict).toBe(true);
    const beforeRevisit = h.session.orderRequest.mock.calls.length;
    document.dispatchEvent(new globalThis.Event('visibilitychange')); await flushPromises();
    expect(h.session.orderRequest).toHaveBeenCalledTimes(beforeRevisit);
    await wrapper.findAll('button').find(button => button.text() === 'Повторить').trigger('click'); await flushPromises();
    expect(wrapper.get('input[value="pickup"]').element.checked).toBe(true);
    expect(wrapper.get('input[name="firstName"]').element.value).toBe('Мой получатель');
    expect(wrapper.findComponent(CheckoutView).vm.$.setupState.conflict).toBe(false);
    expect(paymentButton().attributes('disabled')).toBeUndefined();
  });
  it('retains foreground consent-notice ownership after entry renewal fails, then releases it after retry', async () => {
    h.realRenewal = true;
    h.consents.missingKinds.mockRejectedValueOnce(createInternalProblem('protocolError'));
    await render('/orders/12345678-3/checkout');
    expect(wrapper.findAll('[role="alert"]')).toHaveLength(1);
    expect(h.consents.acquireNoticeSuppression).toHaveBeenCalledTimes(2);
    const [foregroundRelease, renewalRelease] = h.consents.acquireNoticeSuppression.mock.results.map(result => result.value);
    expect(renewalRelease).toHaveBeenCalledOnce();
    expect(foregroundRelease).not.toHaveBeenCalled();
    expect(h.consents.noticeSuppressed.value).toBe(true);
    await wrapper.findAll('button').find(button => button.text() === 'Повторить').trigger('click'); await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(h.consents.noticeSuppressed.value).toBe(false);
    expect(foregroundRelease).toHaveBeenCalledOnce();
  });
  it('retains consent-failure ownership and checkout data after save renewal fails, then resumes once', async () => {
    h.realRenewal = true;
    await render('/orders/12345678-3/checkout');
    expect(h.consents.noticeSuppressed.value).toBe(false);
    await wrapper.get('input[value="pickup"]').setValue(true);
    await wrapper.get('input[name="firstName"]').setValue('Мой получатель');
    h.consents.missingKinds.mockRejectedValueOnce(createInternalProblem('protocolError'));
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(wrapper.findAll('[role="alert"]')).toHaveLength(1);
    expect(h.consents.noticeSuppressed.value).toBe(true);
    expect(wrapper.get('input[name="firstName"]').element.value).toBe('Мой получатель');
    expect(h.session.orderRequest.mock.calls.some(([, options]) => options.method === 'POST')).toBe(false);
    h.session.orderRequest.mockImplementationOnce(async (_path, options, isCurrent, validate) => {
      expect(h.consents.noticeSuppressed.value).toBe(true);
      const payload = JSON.parse(options.body);
      expect(payload.profile.firstName).toBe('Мой получатель');
      const value = { ...currentOrder, checkout:savedCheckout(payload) };
      if (isCurrent()) validate(value);
      return value;
    });
    await wrapper.get('form').trigger('submit'); await flushPromises();
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('payment'));
    expect(h.consents.noticeSuppressed.value).toBe(false);
    expect(h.session.orderRequest.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1);
  });
  it.each(['unmount', 'identity'])('releases a retained consent-failure token on %s', async boundary => {
    h.realRenewal = true;
    h.consents.missingKinds.mockRejectedValueOnce(createInternalProblem('protocolError'));
    await render('/orders/12345678-3/checkout');
    expect(h.consents.noticeSuppressed.value).toBe(true);
    if (boundary === 'unmount') { wrapper.unmount(); wrapper = null; }
    else { h.session.customer.value = null; await flushPromises(); }
    expect(h.consents.noticeSuppressed.value).toBe(false);
  });
});


it('reloads confirmed order details at expiry when no cancellation is pending', async () => {
  vi.useFakeTimers({ toFake:['setTimeout', 'clearTimeout'] });
  currentOrder.pricing.validUntil = '2026-09-15T10:00:01Z';
  await render();
  expect(wrapper.text()).toContain('Оформить заказ');
  const beforeExpiry = h.session.orderRequest.mock.calls.length;
  currentOrder = ready({ status:200, pricing:{ ...currentOrder.pricing, state:200, asOf:'2026-09-15T10:00:01Z' } });
  await vi.advanceTimersByTimeAsync(1000); await flushPromises();
  expect(h.session.orderRequest).toHaveBeenCalledTimes(beforeExpiry + 2);
  expect(wrapper.text()).toContain('Расчёт истёк');
  expect(wrapper.text()).not.toContain('Оформить заказ');
});


describe('checkout agreement presentation and renewal', () => {
  function renewButton() { return wrapper.findAll('button').find(button => button.text() === 'Подтвердить документы') }
  async function openAgreement() { await wrapper.get('a[href="/legal/user-agreement"]').trigger('click'); await flushPromises() }
  it('reads the current agreement in place and returns without losing the checkout draft', async () => {
    await render('/orders/12345678-3/checkout')
    await wrapper.get('input[value="courier"]').setValue(true)
    await wrapper.get('input[name="firstName"]').setValue('Мой получатель')
    await wrapper.get('[name="address"]').setValue('Мой адрес')
    await openAgreement()
    expect(router.currentRoute.value.name).toBe('checkout')
    expect(wrapper.get('[role="dialog"]').text()).toContain('Текст действующей редакции')
    expect(h.consents.current).toHaveBeenCalledWith(2)
    expect(h.consents.grant).not.toHaveBeenCalled()
    await wrapper.findAll('button').find(button => button.text() === 'Вернуться к оформлению').trigger('click')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(wrapper.get('input[name="firstName"]').element.value).toBe('Мой получатель')
    expect(wrapper.get('[name="address"]').element.value).toBe('Мой адрес')
    expect(paymentButton().attributes('disabled')).toBeUndefined()
  })
  it('keeps payment disabled after cancellation and explicitly reopens only the missing confirmation', async () => {
    h.realRenewal = true; h.missing = [2]
    await render('/orders/12345678-3/checkout')
    expect(paymentButton().attributes('disabled')).toBeDefined()
    await wrapper.findAll('button').find(button => button.text() === 'Отмена').trigger('click'); await flushPromises()
    await wrapper.get('input[value="courier"]').setValue(true)
    await wrapper.get('[name="address"]').setValue('Черновик адреса')
    await wrapper.get('input[name="firstName"]').setValue('Черновик получателя')
    expect(paymentButton().attributes('disabled')).toBeDefined()
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(h.session.orderRequest.mock.calls.some(([, options]) => options.method === 'POST')).toBe(false)
    await renewButton().trigger('click'); await flushPromises()
    expect(wrapper.get('[role="dialog"]').findAll('input[type="checkbox"]')).toHaveLength(1)
    expect(wrapper.get('[role="dialog"]').get('input').element.checked).toBe(false)
    await wrapper.get('[role="dialog"]').get('input').setValue(true)
    await wrapper.findAll('button').find(button => button.text() === 'Подтвердить и продолжить').trigger('click'); await flushPromises()
    expect(h.consents.grant).toHaveBeenCalledOnce()
    expect(h.consents.grant.mock.calls[0][0].kind).toBe(2)
    expect(paymentButton().attributes('disabled')).toBeUndefined()
    expect(renewButton()).toBeUndefined()
    expect(wrapper.get('[name="address"]').element.value).toBe('Черновик адреса')
    expect(wrapper.get('input[name="firstName"]').element.value).toBe('Черновик получателя')
    expect(router.currentRoute.value.name).toBe('checkout')
  })
  it.each([1, 2])('disables payment when consent kind %s ceases to be current', async kind => {
    await render('/orders/12345678-3/checkout')
    await wrapper.get('input[value="pickup"]').setValue(true)
    expect(paymentButton().attributes('disabled')).toBeUndefined()
    h.missing = [kind]; await h.consents.loadMine(); await flushPromises()
    expect(paymentButton().attributes('disabled')).toBeDefined()
    h.renewal.ensure.mockRejectedValueOnce(createInternalProblem('networkUnavailable'))
    await renewButton().trigger('click'); await flushPromises()
    expect(wrapper.findAll('[role="alert"]')).toHaveLength(1)
    expect(paymentButton().attributes('disabled')).toBeDefined()
    expect(h.consents.noticeSuppressed.value).toBe(true)
    await renewButton().trigger('click'); await flushPromises()
    expect(paymentButton().attributes('disabled')).toBeUndefined()
    expect(h.consents.noticeSuppressed.value).toBe(false)
  })
  it.each(['missing', 'invalid', 'network'])('keeps unavailable agreement reading recoverable: %s', async failure => {
    await render('/orders/12345678-3/checkout')
    await wrapper.get('input[name="firstName"]').setValue('Черновик')
    if (failure === 'network') h.consents.loadMine.mockRejectedValueOnce(createInternalProblem('networkUnavailable'))
    else h.consents.current.mockResolvedValueOnce({ document:failure === 'missing' ? null : { ...legalDocument(2), html:'<script>unsafe</script>' } })
    await openAgreement()
    expect(wrapper.get('[role="dialog"]').findAll('[role="alert"]')).toHaveLength(1)
    expect(wrapper.find('script').exists()).toBe(false)
    expect(h.consents.noticeSuppressed.value).toBe(true)
    await wrapper.get('[role="dialog"]').findAll('button').find(button => button.text() === 'Повторить').trigger('click'); await flushPromises()
    expect(wrapper.get('[role="dialog"]').text()).toContain('Текст действующей редакции')
    expect(h.consents.noticeSuppressed.value).toBe(false)
    expect(wrapper.get('input[name="firstName"]').element.value).toBe('Черновик')
  })
  it.each(['close', 'identity', 'unmount', 'expiry'])('discards a pending agreement response on %s', async boundary => {
    vi.useFakeTimers({ toFake:['setTimeout', 'clearTimeout'] })
    currentOrder.pricing.validUntil = '2026-09-15T10:00:01Z'
    await render('/orders/12345678-3/checkout')
    let finish
    h.consents.current.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await openAgreement()
    expect(wrapper.get('[role="dialog"]').text()).toContain('Загружаем документ')
    if (boundary === 'close') {
      const dialog = wrapper.findAllComponents({ name:'UiDialog' }).find(dialog => dialog.props('modelValue'))
      dialog.vm.$emit('update:modelValue', false)
    } else if (boundary === 'identity') h.session.customer.value = { id:8, phone:'+79990001111', profile:{} }
    else if (boundary === 'unmount') { wrapper.unmount(); wrapper = null }
    else await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()
    finish({ document:legalDocument(2) }); await flushPromises()
    if (wrapper) expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(h.consents.noticeSuppressed.value).toBe(false)
  })
})


it('refreshes the open checkout reader when a scheduled agreement becomes effective', async () => {
  vi.useFakeTimers({ toFake:['setTimeout', 'clearTimeout'] })
  await render('/orders/12345678-3/checkout')
  await wrapper.get('input[value="pickup"]').setValue(true)
  await wrapper.get('input[name="firstName"]').setValue('Черновик получателя')
  h.consents.current.mockResolvedValueOnce({ document:legalDocument(2), serverNow:'2026-09-15T10:00:00Z', nextChangeAt:'2026-09-15T10:00:01Z' })
  await wrapper.get('a[href="/legal/user-agreement"]').trigger('click'); await flushPromises()
  expect(wrapper.get('[role="dialog"]').text()).toContain('Текст действующей редакции')
  h.missing = [2]
  h.consents.current.mockResolvedValueOnce({ document:{ ...legalDocument(2), id:'00000000-0000-4000-8000-000000000003', displayVersion:'2', html:'<p>Новая действующая редакция</p>' }, serverNow:'2026-09-15T10:00:01Z', nextChangeAt:null })
  await vi.advanceTimersByTimeAsync(1000); await flushPromises()
  expect(wrapper.get('[role="dialog"]').text()).toContain('Новая действующая редакция')
  expect(wrapper.get('[role="dialog"]').text()).not.toContain('Текст действующей редакции')
  expect(paymentButton().attributes('disabled')).toBeDefined()
  expect(wrapper.get('input[name="firstName"]').element.value).toBe('Черновик получателя')
  expect(h.consents.grant).not.toHaveBeenCalled()
})
it('cancels the scheduled checkout reader refresh when the document dialog closes', async () => {
  vi.useFakeTimers({ toFake:['setTimeout', 'clearTimeout'] })
  await render('/orders/12345678-3/checkout')
  h.consents.current.mockResolvedValueOnce({ document:legalDocument(2), serverNow:'2026-09-15T10:00:00Z', nextChangeAt:'2026-09-15T10:00:01Z' })
  await wrapper.get('a[href="/legal/user-agreement"]').trigger('click'); await flushPromises()
  await wrapper.findAll('button').find(button => button.text() === 'Вернуться к оформлению').trigger('click')
  await vi.advanceTimersByTimeAsync(1000); await flushPromises()
  expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  expect(h.consents.current).toHaveBeenCalledOnce()
})
