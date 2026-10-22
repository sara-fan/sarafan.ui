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
import PendingView from '../src/views/PendingView.vue'
import { createInternalProblem, presentProblem } from '../src/errors/problem.js'
import { createSarafanVuetify } from '../src/plugins/vuetify.js'
import { payment } from './fixtures/payment.js'
import { ops } from './fixtures/orders.js'
let wrapper, response
const state = () => wrapper.vm.$.setupState
async function render() { wrapper = mount(PaymentView, { global:{ plugins:[createSarafanVuetify()] } }); await flushPromises() }
const wait = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
async function ready() {
  await flushPromises()
  const qr = wrapper.find('.payment-qr img')
  if (qr.exists()) await qr.trigger('load')
}
beforeEach(() => {
  vi.spyOn(globalThis.navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Linux; Android 14; Pixel)')
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
afterEach(() => { wrapper?.unmount(); wrapper = null; vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('shows main payment, separate customs, bank details and opens the exact link after revalidation', async () => {
  await render(); await ready()
  expect(wrapper.text()).toContain('1\u00a0100,00'); expect(wrapper.text()).toContain('Подтверждённая стоимость')
  expect(wrapper.text()).toContain('Таможенные платежи оплачиваются отдельно')
  expect(wrapper.text()).not.toContain('Действует до')
  const bankDetails = wrapper.get('section[aria-label="Банковские реквизиты"]')
  expect(bankDetails.get('h2').text()).toBe('Банковские реквизиты')
  const bankInputs = bankDetails.findAll('input')
  expect(bankInputs).toHaveLength(7)
  expect(bankInputs.every(input => input.element.readOnly)).toBe(true)
  expect(bankInputs.map(input => input.element.value)).toEqual(expect.arrayContaining([
    '0012345678', '00000000000000000001', '00000000000000000002'
  ]))
  expect(wrapper.find('details, summary').exists()).toBe(false)
  expect(wrapper.get('section[aria-label="Оплата через СБП"]').text()).toContain('Получатель: Получатель')
  expect(h.session.paymentQr).not.toHaveBeenCalled()
  expect(wrapper.findComponent(PaymentQr).exists()).toBe(false)
  expect(wrapper.get('.bank-payment__logo').attributes('src')).toBe('/sbp-logo.svg')
  expect(wrapper.text()).not.toContain('При возврате из банка')
  const bankButton = wrapper.get('.bank-payment')
  await bankButton.trigger('click'); await flushPromises()
  expect(h.session.orderRequest.mock.calls.filter(([path]) => path.endsWith('/payment'))).toHaveLength(2)
  expect(h.navigate).toHaveBeenCalledWith(response.paymentInformation.information.paymentLink)
  expect(h.session.orderRequest.mock.calls.every(([,options]) => !options.method)).toBe(true)
  await state().back(); expect(h.push).toHaveBeenCalledWith({ name:'order-details', params:{ orderNumber:'12345678-3' } })
})
it.each([
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 360, false],
  ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', 360, false],
  ['Mozilla/5.0 (Linux; Android 14; Tablet)', 1280, true],
  ['Mozilla/5.0 (Phone; OpenHarmony 5.0) ArkWeb/4.1.6.1 Mobile', 1280, true],
  ['Mozilla/5.0 (Tablet; HarmonyOS 5.1) ArkWeb/4.1.6.1', 1280, true],
  ['Mozilla/5.0 (PC; OpenHarmony 5.0) ArkWeb/4.1.6.1', 360, false]
])('selects payment by device independently of width and touch: %s', async (agent, width, mobile) => {
  vi.stubGlobal('navigator', { userAgent:agent, maxTouchPoints:10 })
  vi.stubGlobal('innerWidth', width)
  await render(); await ready()
  expect(wrapper.find('.bank-payment').exists()).toBe(mobile)
  expect(wrapper.findComponent(PaymentQr).exists()).toBe(!mobile)
  expect(wrapper.text().includes('Отсканируйте QR-код')).toBe(!mobile)
  expect(wrapper.text()).toContain('Вручную введите указанную сумму')
  expect(wrapper.text().split('После поступления и подтверждения оплаты оператором заказ перейдёт в статус „Выполняется“. Это может занять время, подождите.')).toHaveLength(2)
  expect(wrapper.get('section[aria-label="Оплата через СБП"]').get('h2').text()).toBe('Оплата через СБП')
  vi.stubGlobal('innerWidth', mobile ? 360 : 1280)
  globalThis.dispatchEvent(new globalThis.Event('resize')); await flushPromises()
  expect(wrapper.find('.bank-payment').exists()).toBe(mobile)
  expect(wrapper.findComponent(PaymentQr).exists()).toBe(!mobile)
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
it.each(['Android', 'Windows NT'])('hides all bank actions at expiry while open and on tab return on %s', async agent => {
  vi.spyOn(globalThis.navigator, 'userAgent', 'get').mockReturnValue(agent)
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
it.each([
  ['manual', 'unchanged'], ['tab', 'replacement'], ['tab', 'unavailable'], ['manual', 'failure']
])('disposes desktop QR during %s refresh with %s response', async (trigger, outcome) => {
  vi.spyOn(globalThis.navigator, 'userAgent', 'get').mockReturnValue('Windows NT')
  await render(); await ready()
  const old = wrapper.get('.payment-qr img').element, oldSource = old.getAttribute('src'), pending = wait()
  h.session.orderRequest.mockImplementationOnce(async (_path, _options, isCurrent, validate) => {
    const value = await pending.promise
    if (isCurrent()) validate(value)
    return value
  })
  if (trigger === 'tab') globalThis.document.dispatchEvent(new globalThis.Event('visibilitychange'))
  const action = state().refresh()
  await flushPromises()
  expect(wrapper.findComponent(PaymentQr).exists()).toBe(false)
  expect(wrapper.text()).toContain('Обновляем платёжные данные…')
  expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith(oldSource)
  old.dispatchEvent(new globalThis.Event('load')); old.dispatchEvent(new globalThis.Event('error'))
  expect(wrapper.find('.payment-qr img').exists()).toBe(false)
  const next = payment()
  if (outcome === 'replacement') {
    next.mainPaymentRub = 1200; next.order.pricing.domesticDeliveryRub = 200
    next.paymentInformation.bundleId = 2
    next.paymentInformation.qrUrl = '/api/v1/payment-information/current/qr?v=' + 'b'.repeat(64)
    next.paymentInformation.information.recipientName = 'Новый получатель'
  }
  if (outcome === 'unavailable') { next.canPay = false; next.paymentInformation = null }
  if (outcome === 'failure') pending.reject(new Error('private refresh failure'))
  else pending.resolve(next)
  await action; await ready()
  expect(h.navigate).not.toHaveBeenCalled()
  if (['unchanged', 'replacement'].includes(outcome)) {
    expect(wrapper.getComponent(PaymentQr).props('url')).toBe(next.paymentInformation.qrUrl)
    expect(wrapper.get('.payment-qr img').attributes('src')).not.toBe(oldSource)
    expect(h.session.paymentQr).toHaveBeenLastCalledWith(next.paymentInformation.qrUrl)
    expect(wrapper.text()).toContain(next.paymentInformation.information.recipientName)
    expect(state().payment.mainPaymentRub).toBe(next.mainPaymentRub)
  } else {
    expect(wrapper.findComponent(PaymentQr).exists()).toBe(false)
    expect(wrapper.text()).toContain(outcome === 'unavailable' ? 'Оплата пока недоступна' : presentProblem(state().problem))
  }
})
it('keeps a long quote payable across timer chunks and expires at its actual deadline', async () => {
  vi.spyOn(globalThis.navigator, 'userAgent', 'get').mockReturnValue('Windows NT')
  vi.useFakeTimers()
  const chunk = 2147483647, duration = 2 * chunk + 1000
  response.order.pricing.validUntil = new Date(Date.parse(response.order.pricing.asOf) + duration).toISOString()
  await render(); await ready()
  const initialReads = h.session.orderRequest.mock.calls.length
  for (let index = 0; index < 2; index++) {
    await vi.advanceTimersByTimeAsync(chunk)
    expect(state().expired).toBe(false)
    expect(wrapper.find('.payment-qr img').exists()).toBe(true)
    expect(h.session.orderRequest).toHaveBeenCalledTimes(initialReads)
  }
  await vi.advanceTimersByTimeAsync(999)
  expect(state().expired).toBe(false)
  const pending = wait()
  h.session.orderRequest.mockReturnValueOnce(pending.promise)
  await vi.advanceTimersByTimeAsync(1)
  expect(state().expired).toBe(true)
  expect(wrapper.findComponent(PaymentQr).exists()).toBe(false)
  expect(h.session.orderRequest).toHaveBeenCalledTimes(initialReads + 1)
})
it('cancels the current long-deadline timer chunk on unmount', async () => {
  vi.useFakeTimers()
  const chunk = 2147483647
  response.order.pricing.validUntil = new Date(Date.parse(response.order.pricing.asOf) + chunk + 1000).toISOString()
  await render()
  const initialReads = h.session.orderRequest.mock.calls.length
  await vi.advanceTimersByTimeAsync(chunk)
  expect(state().expired).toBe(false)
  wrapper.unmount(); wrapper = null
  await vi.advanceTimersByTimeAsync(1000)
  expect(h.session.orderRequest).toHaveBeenCalledTimes(initialReads)
})
it('rechecks the deadline before expiry when the local clock moves backwards', async () => {
  vi.useFakeTimers()
  response.order.pricing.validUntil = '2026-09-15T10:00:01Z'
  await render()
  const initialReads = h.session.orderRequest.mock.calls.length
  vi.setSystemTime(Date.now() - 500)
  await vi.advanceTimersByTimeAsync(1000)
  expect(state().expired).toBe(false)
  expect(h.session.orderRequest).toHaveBeenCalledTimes(initialReads)
  await vi.advanceTimersByTimeAsync(499)
  expect(state().expired).toBe(false)
  h.session.orderRequest.mockReturnValueOnce(wait().promise)
  await vi.advanceTimersByTimeAsync(1)
  expect(state().expired).toBe(true)
  expect(h.session.orderRequest).toHaveBeenCalledTimes(initialReads + 1)
})
it.each([null, 0])('preserves unknown and zero delivery %s', async delivery => {
  response.order.pricing.domesticDeliveryRub = delivery; response.mainPaymentRub = 1000
  await render()
  expect(wrapper.text()).toContain(delivery === null ? 'Будут рассчитаны позже' : '0,00')
})
it('omits entrepreneur KPP, shows recoverable desktop QR failures and ignores old decode/read events', async () => {
  vi.spyOn(globalThis.navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
  response.paymentInformation.information.recipientType = 1; response.paymentInformation.information.kpp = null; response.paymentInformation.information.inn = '001234567890'
  await render(); await ready(); expect(wrapper.text()).not.toContain('КПП')
  const old = wrapper.get('img').element
  await wrapper.get('img').trigger('error'); await flushPromises()
  expect(wrapper.text()).toContain('QR-код недоступен'); expect(wrapper.find('.bank-payment').exists()).toBe(false)
  old.dispatchEvent(new globalThis.Event('load')); old.dispatchEvent(new globalThis.Event('error'))
  expect(wrapper.getComponent(PaymentQr).emitted('ready').at(-1)).toEqual([false])
  await wrapper.findAll('button').find(button => button.text() === 'Повторить загрузку QR-кода').trigger('click'); await ready()
  expect(wrapper.getComponent(PaymentQr).emitted('ready').at(-1)).toEqual([true])
  const pending = wait(); h.session.paymentQr.mockReturnValueOnce(pending.promise)
  response.paymentInformation.bundleId = 2; await state().refresh(); await flushPromises()
  h.session.customer.value = null; await flushPromises(); pending.resolve(new globalThis.Blob(['old'], { type:'image/png' })); await flushPromises()
  expect(wrapper.find('img').exists()).toBe(false)
})
it('uses the Pilot placeholder and directs missing checkout to checkout', async () => {
  response.canPay = false; response.paymentInformation = null
  await render(); expect(wrapper.text()).toContain('Оплата пока недоступна. Попробуйте позже')
  response.order.checkout = null; response.mainPaymentRub = null; await state().refresh(); await flushPromises()
  expect(wrapper.text()).toContain('Заполните данные'); await state().checkout()
  expect(h.push).toHaveBeenCalledWith({ name:'checkout', params:{ orderNumber:'12345678-3' } })
})
it.each([100, 200])('does not refresh paid pricing state %s at the old deadline', async pricingState => {
  vi.useFakeTimers()
  response.canPay = false; response.paymentInformation = null; response.order.status = 300; response.order.canCancel = false
  response.order.pricing.mainPaymentPaid = true; response.order.pricing.state = pricingState
  await render()
  const calls = h.session.orderRequest.mock.calls.length
  expect(wrapper.text()).toContain('Заказ оплачен')
  await vi.advanceTimersByTimeAsync(25 * 60 * 60 * 1000)
  expect(h.session.orderRequest).toHaveBeenCalledTimes(calls)
  expect(state().expired).toBe(false)
  expect(wrapper.find('.bank-payment').exists()).toBe(false)
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

it.each([
  ['configured', 'К заказу', 'order-details'],
  ['unconfigured', 'К заказу', 'order-details'],
  ['no-checkout', 'Оформить заказ', 'checkout'],
  ['unconfigured', 'На главную', 'home']
])('owns rejected %s navigation through %s and permits recovery', async (scenario, label, target) => {
  if (scenario === 'unconfigured') { response.canPay = false; response.paymentInformation = null }
  if (scenario === 'no-checkout') {
    response.canPay = false; response.paymentInformation = null; response.order.checkout = null; response.mainPaymentRub = null
  }
  h.push.mockRejectedValueOnce(new Error('private router details'))
  await render(); await ready()
  await wrapper.findAll('button').find(button => button.text() === label).trigger('click'); await flushPromises()
  expect(h.push).toHaveBeenCalledWith(target === 'home' ? { name:target }
    : { name:target, params:{ orderNumber:'12345678-3' } })
  expect(wrapper.findAll('[role="alert"]')).toHaveLength(1)
  expect(wrapper.get('[role="alert"]').text()).toBe(presentProblem(state().problem))
  expect(wrapper.text()).not.toContain('private')
  expect(wrapper.findComponent(PendingView).exists()).toBe(false)
  await state().refresh(); await ready()
  expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  expect(wrapper.findComponent(PendingView).exists()).toBe(scenario === 'unconfigured')
})
it.each(['customer', 'order', 'identity-return', 'order-return', 'unmount', 'new-navigation'])('discards navigation failures after %s', async boundary => {
  await render(); await ready()
  const pending = wait(), view = state()
  h.push.mockReturnValueOnce(pending.promise)
  const action = view.back()
  if (boundary === 'customer' || boundary === 'identity-return') {
    h.session.customer.value = { id:2 }
    if (boundary === 'identity-return') h.session.customer.value = { id:1 }
  }
  if (boundary === 'order' || boundary === 'order-return') {
    response.order.orderNumber = '12345678-4'; h.route.params.orderNumber = '12345678-4'
    if (boundary === 'order-return') { response.order.orderNumber = '12345678-3'; h.route.params.orderNumber = '12345678-3' }
  }
  if (boundary === 'unmount') wrapper.unmount()
  if (boundary === 'new-navigation') await view.checkout()
  await flushPromises()
  pending.reject(new Error('obsolete router details'))
  await action; await flushPromises()
  expect(view.problem).toBeNull()
  if (boundary !== 'unmount') expect(wrapper.find('[role="alert"]').exists()).toBe(false)
})
it('keeps the latest navigation error when an older navigation rejects', async () => {
  await render()
  const pending = wait(), latest = createInternalProblem('invalidInput')
  h.push.mockReturnValueOnce(pending.promise).mockRejectedValueOnce(latest)
  const action = state().back()
  await state().checkout(); await flushPromises()
  pending.reject(new Error('obsolete router details')); await action; await flushPromises()
  expect(state().problem).toBe(latest)
  expect(wrapper.findAll('[role="alert"]')).toHaveLength(1)
})
it('retains navigation failure ownership through a background payment refresh', async () => {
  await render()
  const pending = wait()
  h.push.mockReturnValueOnce(pending.promise)
  const action = state().back()
  await state().refresh()
  pending.reject(new Error('private router details')); await action; await flushPromises()
  expect(state().problem).not.toBeNull()
  expect(wrapper.findAll('[role="alert"]')).toHaveLength(1)
})
it.each(['amount mismatch', 'control-bearing link', 'unavailable bundle'])('blocks bank navigation after refreshed %s', async scenario => {
  await render()
  if (scenario === 'amount mismatch') response.mainPaymentRub = 1100.01
  if (scenario === 'control-bearing link') response.paymentInformation.information.paymentLink = 'https://bank.example/Pay?Token=Ab\u0085C'
  if (scenario === 'unavailable bundle') response.canPay = false
  await state().pay(); await flushPromises()
  expect(h.navigate).not.toHaveBeenCalled()
  expect(wrapper.findAll('[role="alert"]')).toHaveLength(1)
  expect(wrapper.find('.bank-payment').exists()).toBe(false)
})

it('rejects invalid routes and drops a route replacement in flight', async () => {
  h.route.params.orderNumber = ''
  await render(); expect(state().problem).not.toBeNull()
  h.route.params.orderNumber = '12345678-3'; await flushPromises(); await ready()
  const pending = wait(); h.session.orderRequest.mockReturnValueOnce(pending.promise)
  const action = state().pay(); h.route.params.orderNumber = '12345678-4'; response.order.orderNumber = '12345678-4'
  pending.resolve(payment()); await action; await flushPromises(); expect(h.navigate).not.toHaveBeenCalled()
})
