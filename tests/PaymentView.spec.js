// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { mount, flushPromises } from '@vue/test-utils'
import { reactive, ref } from 'vue'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ session:{}, route:null, push:vi.fn(), navigate:vi.fn() }))
vi.mock('../src/stores/session.js', () => ({ useSession:() => h.session }))
vi.mock('vue-router', () => ({ useRoute:() => h.route, useRouter:() => ({ push:h.push }) }))
vi.mock('../src/orders/payment.js', async original => ({ ...await original(), openPaymentLink:h.navigate }))
import PaymentView from '../src/views/PaymentView.vue'
import PaymentQr from '../src/components/PaymentQr.vue'
import { createSarafanVuetify } from '../src/plugins/vuetify.js'
import { payment } from './fixtures/payment.js'
import { ops } from './fixtures/orders.js'
let wrapper, response
const state = () => wrapper.vm.$.setupState
async function render() { wrapper = mount(PaymentView, { global:{ plugins:[createSarafanVuetify()] } }); await flushPromises() }
const wait = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
async function ready() { await flushPromises(); await wrapper.get('img').trigger('load') }
beforeEach(() => {
  h.route = reactive({ params:{ orderNumber:'12345678-3' } })
  h.session.customer = ref({ id:1 }); response = payment()
  h.session.orderRequest = vi.fn(async (path, options, isCurrent, validate) => {
    const value = path.endsWith('/ops') ? ops : globalThis.structuredClone(response)
    if (isCurrent()) validate(value)
    return value
  })
  h.session.paymentQr = vi.fn().mockResolvedValue(new globalThis.Blob(['qr'], { type:'image/png' }))
  vi.spyOn(globalThis.URL, 'createObjectURL').mockImplementation(() => 'blob:qr-' + Math.random())
  vi.spyOn(globalThis.URL, 'revokeObjectURL').mockImplementation(() => {})
  h.navigate.mockReset(); h.push.mockReset().mockResolvedValue(undefined)
})
afterEach(() => { wrapper?.unmount(); wrapper = null; vi.useRealTimers(); vi.restoreAllMocks() })
it('shows main payment, separate customs, bank details and opens the exact link after revalidation', async () => {
  await render(); await ready()
  expect(wrapper.text()).toContain('1\u00a0100,00'); expect(wrapper.text()).toContain('Подтверждённая стоимость')
  expect(wrapper.text()).toContain('Таможенные платежи оплачиваются отдельно')
  expect(wrapper.text()).not.toContain('Действует до')
  expect(wrapper.get('details').attributes('open')).toBeUndefined()
  const bankButton = wrapper.get('.bank-payment')
  await bankButton.trigger('click'); await flushPromises()
  expect(h.session.orderRequest.mock.calls.filter(([path]) => path.endsWith('/payment'))).toHaveLength(2)
  expect(h.navigate).toHaveBeenCalledWith(response.paymentInformation.information.paymentLink)
  expect(h.session.orderRequest.mock.calls.every(([,options]) => !options.method)).toBe(true)
  await state().back(); expect(h.push).toHaveBeenCalledWith({ name:'order-details', params:{ orderNumber:'12345678-3' } })
})
it.each(['amount', 'order', 'bundle'])('requires a new click after changed %s', async change => {
  await render(); await ready()
  if (change === 'amount') { response.mainPaymentRub = 1200; response.order.pricing.domesticDeliveryRub = 200 }
  if (change === 'order') response.order.updatedAt = '2026-09-15T10:01:00Z'
  if (change === 'bundle') { response.paymentInformation.bundleId = 2; response.paymentInformation.qrUrl = '/api/v1/payment-information/current/qr?v=' + 'b'.repeat(64) }
  await state().pay(); await flushPromises()
  expect(h.navigate).not.toHaveBeenCalled(); expect(wrapper.text()).toContain('данные изменились')
  await ready(); await state().pay()
  expect(h.navigate).toHaveBeenCalledTimes(1)
})
it('hides all bank actions at expiry while open and on tab return', async () => {
  vi.useFakeTimers(); response.order.pricing.validUntil = '2026-09-15T10:00:01Z'
  await render(); await ready()
  const pending = wait(); h.session.orderRequest.mockReturnValueOnce(pending.promise)
  await vi.advanceTimersByTimeAsync(1000)
  expect(wrapper.find('img').exists()).toBe(false); expect(wrapper.find('.bank-payment').exists()).toBe(false)
  await state().pay(); expect(h.navigate).not.toHaveBeenCalled()
  response.canPay = false; response.order.status = 200; response.order.pricing.state = 200; response.paymentInformation = null
  pending.resolve(response); await flushPromises()
  globalThis.document.dispatchEvent(new globalThis.Event('visibilitychange')); await flushPromises()
  expect(wrapper.text()).toContain('Оплата недоступна')
})
it.each([null, 0])('preserves unknown and zero delivery %s', async delivery => {
  response.order.pricing.domesticDeliveryRub = delivery; response.mainPaymentRub = 1000
  await render()
  expect(wrapper.text()).toContain(delivery === null ? 'Будут рассчитаны позже' : '0,00')
})
it('omits entrepreneur KPP, shows recoverable QR failures and ignores old decode/read events', async () => {
  response.paymentInformation.information.recipientType = 1; response.paymentInformation.information.kpp = null
  await render(); await ready(); expect(wrapper.text()).not.toContain('КПП')
  const old = wrapper.get('img').element
  await wrapper.get('img').trigger('error'); await flushPromises()
  expect(wrapper.text()).toContain('QR-код недоступен'); expect(wrapper.get('.bank-payment').attributes('disabled')).toBeDefined()
  old.dispatchEvent(new globalThis.Event('load')); old.dispatchEvent(new globalThis.Event('error'))
  expect(state().qrReady).toBe(false)
  await wrapper.findAll('button').find(button => button.text() === 'Повторить загрузку QR-кода').trigger('click'); await ready()
  expect(state().qrReady).toBe(true)
  const pending = wait(); h.session.paymentQr.mockReturnValueOnce(pending.promise)
  response.paymentInformation.bundleId = 2; await state().refresh(); await flushPromises()
  h.session.customer.value = null; await flushPromises(); pending.resolve(new globalThis.Blob(['old'], { type:'image/png' })); await flushPromises()
  expect(wrapper.find('img').exists()).toBe(false)
})
it('uses the Pilot placeholder and directs missing checkout to checkout', async () => {
  response.canPay = false; response.paymentInformation = null
  await render(); expect(wrapper.text()).toContain('Оплата пока недоступна. Попробуйте позже')
  response.order.checkout = null; await state().refresh(); await flushPromises()
  expect(wrapper.text()).toContain('Заполните данные'); await state().checkout()
  expect(h.push).toHaveBeenCalledWith({ name:'checkout', params:{ orderNumber:'12345678-3' } })
})
it.each([300, 500, 600, 999])('shows status %s without payment controls', async status => {
  response.canPay = false; response.paymentInformation = null; response.order.status = status; response.order.canCancel = false
  if (status === 600) { response.order.reviewReason = 'Причина'; response.order.reviewCompletedAt = response.order.updatedAt }
  await render(); expect(wrapper.find('.bank-payment').exists()).toBe(false); expect(wrapper.findComponent(PaymentQr).exists()).toBe(false)
  expect(wrapper.text()).toContain(status === 300 ? 'Заказ оплачен' : 'Оплата недоступна')
})
it.each([false, true])('discards obsolete payment completion rejected=%s', async rejected => {
  const pending = wait(); h.session.orderRequest.mockReturnValueOnce(pending.promise)
  await render(); h.session.customer.value = null; await flushPromises()
  if (rejected) pending.reject(new Error('private')); else pending.resolve(ops)
  await flushPromises(); expect(state().payment).toBeNull(); expect(state().problem).toBeNull()
})
it('owns safe load/navigation failures and permits refresh retry', async () => {
  h.session.orderRequest.mockRejectedValueOnce(new Error('private'))
  await render(); expect(wrapper.text()).not.toContain('private'); expect(state().problem).not.toBeNull()
  await state().refresh(); await ready(); h.navigate.mockImplementationOnce(() => { throw new Error('private') })
  await state().pay(); await flushPromises(); expect(state().problem).not.toBeNull()
})
it('rejects invalid routes and drops a route replacement in flight', async () => {
  h.route.params.orderNumber = ''
  await render(); expect(state().problem).not.toBeNull()
  h.route.params.orderNumber = '12345678-3'; await flushPromises(); await ready()
  const pending = wait(); h.session.orderRequest.mockReturnValueOnce(pending.promise)
  const action = state().pay(); h.route.params.orderNumber = '12345678-4'; response.order.orderNumber = '12345678-4'
  pending.resolve(payment()); await action; await flushPromises(); expect(h.navigate).not.toHaveBeenCalled()
})
