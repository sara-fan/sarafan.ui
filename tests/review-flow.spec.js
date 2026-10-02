// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ session:{}, consents:{}, renewal:{}, missing:[] }))
vi.mock('../src/stores/session.js', () => ({ useSession:() => h.session }))
vi.mock('../src/stores/consents.js', () => ({ useConsents:() => h.consents }))
vi.mock('../src/useConsentRenewal.js', async importOriginal => ({ ...await importOriginal(), useConsentRenewal:() => h.renewal }))
import { createSarafanVuetify } from '../src/plugins/vuetify.js'
import CheckoutView from '../src/views/CheckoutView.vue'
import OrderDetailsView from '../src/views/OrderDetailsView.vue'
import { CORE_PROBLEM_TYPES, ProblemError, createInternalProblem } from '../src/errors/problem.js'
import { validateCustomerOrder, validateCustomerOrders, validateDeliveryEstimate } from '../src/stores/orders.js'
import { completeOrder, ops } from './fixtures/orders.js'

let wrapper, router, currentOrder, mountTarget
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
  wrapper = mount({ template:'<RouterView />' }, { attachTo:mountTarget, global:{ plugins:[router, createSarafanVuetify()] } })
  await flushPromises()
}
beforeEach(() => {
  currentOrder = ready()
  h.missing = []
  h.consents = { missingKinds:vi.fn(async () => h.missing), current:vi.fn(async () => ({ document:{ id:'agreement-current' }, serverNow:'2026-09-15T10:00:00Z', nextChangeAt:null })), mine:ref(null), kindName:() => 'Соглашение' }
  h.renewal = { state:{ open:false, documents:[], reading:null, problem:null, problemKind:null }, cancel:vi.fn(), ensure:vi.fn(async () => { h.missing = []; return true }) }
  h.session.customer = ref({ id:7, phone:'+79990001234', profile:{ firstName:'Иван', lastName:'Иванов' } })
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
  return { profile:{ ...Object.fromEntries(fields.map(field => [field, null])), ...payload.profile,
    phone:'+79990001234' },
    delivery:ops.checkoutDeliveries.find(row => row.routeAlias === payload.delivery) }
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
    expect(wrapper.find('a[href="/legal/agreement-current"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Принять условия')
    expect(wrapper.text()).not.toContain('Заказ оформляется на условиях')
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
    h.renewal.ensure.mockResolvedValue(false)
    await render('/orders/12345678-3/checkout')
    expect(h.renewal.ensure).toHaveBeenCalledWith([1, 2], expect.any(Function))
    await wrapper.get('input[value="courier"]').setValue(true)
    await wrapper.get('input[name="firstName"]').setValue('Пётр')
    const calls = h.session.orderRequest.mock.calls.length
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(h.session.orderRequest).toHaveBeenCalledTimes(calls)
    expect(wrapper.get('input[name="firstName"]').element.value).toBe('Пётр')
    expect(paymentButton().attributes('disabled')).toBeUndefined()
    expect(wrapper.text()).not.toContain('Принять условия')
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
    expect(wrapper.get('input[value="courier"]').element.checked).toBe(true)
    expect(wrapper.get('input[value="pickup"]').attributes('disabled')).toBeDefined()
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

it('recovers a stale checkout version, retains recipient draft, and reconciles saved delivery', async () => {
  await render('/orders/12345678-3/checkout')
  await wrapper.get('input[value="courier"]').setValue(true)
  await wrapper.get('input[name="firstName"]').setValue('Мой получатель')
  h.session.orderRequest.mockRejectedValueOnce(new ProblemError({ type:CORE_PROBLEM_TYPES.orderUpdateConflict, title:'Заказ изменился', detail:'Обновите заказ.', status:409, code:'order_update_conflict' }))
  await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(paymentButton().attributes('disabled')).toBeDefined()
  currentOrder = { ...currentOrder, updatedAt:'2026-09-15T10:00:01Z', checkout:savedCheckout({ profile:{ firstName:'Чужая правка', lastName:'Иванов' }, delivery:'pickup' }) }
  await wrapper.findAll('button').find(button => button.text() === 'Обновить данные заказа').trigger('click'); await flushPromises()
  expect(wrapper.get('input[name="firstName"]').element.value).toBe('Мой получатель')
  expect(wrapper.get('input[value="pickup"]').element.checked).toBe(true)
  expect(wrapper.get('input[value="courier"]').attributes('disabled')).toBeDefined()
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
