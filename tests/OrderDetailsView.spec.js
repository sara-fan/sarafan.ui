// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ session:{} }))
vi.mock('../src/stores/session.js', () => ({ useSession:() => h.session }))

import { CORE_PROBLEM_TYPES, ProblemError, createInternalProblem, SERVICE_UNAVAILABLE_MESSAGE } from '../src/errors/problem.js'
import OrderDetailsView from '../src/views/OrderDetailsView.vue'
import { createSarafanVuetify } from '../src/plugins/vuetify.js'
import { completeOrder, forecastPricing, ops, product } from './fixtures/orders.js'

const mountedViews = []
afterEach(() => { for (const wrapper of mountedViews.splice(0)) wrapper.unmount() })

async function mountAt(path = '/orders/12345678-3') {
  const empty = { template:'<main />' }
  const router = createRouter({
    history:createMemoryHistory(),
    routes:[
      { path:'/orders', name:'orders', component:empty },
      { path:'/orders/:orderNumber', name:'order-details', component:OrderDetailsView }
    ]
  })
  await router.push(path)
  const wrapper = mount(OrderDetailsView, { global:{ plugins:[router, createSarafanVuetify()] } })
  mountedViews.push(wrapper)
  await flushPromises()
  return { router, wrapper }
}

describe('OrderDetailsView', () => {
  beforeEach(() => {
    h.session.customer = ref({ id:7 })
    h.session.orderRequest = vi.fn(async (path, _options, isCurrent, validate) => {
      const value = path.endsWith('/ops') ? ops : completeOrder({ orderNumber:decodeURIComponent(path.split('/').at(-1)) })
      if (isCurrent()) validate(value)
      return value
    })
  })

  it('confirms customer cancellation with an optional reason and shows its date', async () => {
    h.session.orderRequest.mockImplementation(async (path, options, isCurrent, validate) => {
      const value = path.endsWith('/ops') ? ops : path.endsWith('/cancel')
        ? completeOrder({ status:500, showReviewFields:false, updatedAt:'2026-09-15T10:05:00Z', cancelledAt:'2026-09-15T10:05:00Z' })
        : completeOrder()
      if (path.endsWith('/cancel')) expect(JSON.parse(options.body)).toEqual({ expectedUpdatedAt:'2026-09-15T10:00:00Z', reason:'Передумал' })
      if (isCurrent()) validate(value)
      return value
    })
    const { wrapper } = await mountAt()
    await wrapper.get('.order-details-heading .ui-button--danger').trigger('click')
    await flushPromises()
    expect(globalThis.document.body.textContent).toContain('Восстановить его нельзя')
    const textarea = globalThis.document.body.querySelector('.ui-dialog textarea')
    expect(textarea).not.toBeNull()
    textarea.value = ' Передумал '
    textarea.dispatchEvent(new globalThis.Event('input', { bubbles:true }))
    globalThis.document.body.querySelector('.ui-dialog__actions .ui-button--danger').click()
    await flushPromises()
    expect(wrapper.text()).toContain('Заказ отменён')
    expect(wrapper.get('.order-details-heading p').text())
      .toMatch(/^Создан \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2} · Отменён \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}$/u)
    expect(wrapper.get('.customer-cost__excluded').findAll('dd').map(item => item.text()))
      .toEqual(['Не рассчитывался', 'Не рассчитывался'])
    expect(wrapper.find('.order-details-heading .ui-button--danger').exists()).toBe(false)
    expect(h.session.orderRequest.mock.calls.filter(([path]) => path.endsWith('/cancel'))).toHaveLength(1)
  })

  it('keeps the cancelled status visible for an older order without a cancellation date', async () => {
    h.session.orderRequest.mockImplementation(async (path, _options, isCurrent, validate) => {
      const value = path.endsWith('/ops') ? ops
        : completeOrder({ status:500, showReviewFields:false, cancelledAt:null })
      if (isCurrent()) validate(value)
      return value
    })
    const { wrapper } = await mountAt()
    expect(wrapper.get('.order-details-heading p').text())
      .toMatch(/^Создан \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2} · Отменён$/u)
    expect(wrapper.find('.order-details-heading .ui-button--danger').exists()).toBe(false)
  })

  it('keeps the entered reason after a server validation error', async () => {
    h.session.orderRequest.mockImplementation(async (path, _options, isCurrent, validate) => {
      if (path.endsWith('/cancel')) throw new ProblemError({
        type:CORE_PROBLEM_TYPES.validationFailed, title:'Ошибка проверки данных', status:400,
        detail:'Проверьте данные', instance:'/api/v1/orders/test/cancel', code:'validation_failed',
        errors:{ reason:['Сократите причину.'] }
      })
      const value = path.endsWith('/ops') ? ops : completeOrder()
      if (isCurrent()) validate(value)
      return value
    })
    const { wrapper } = await mountAt()
    await wrapper.get('.order-details-heading .ui-button--danger').trigger('click')
    await flushPromises()
    const textarea = globalThis.document.body.querySelector('.ui-dialog textarea')
    textarea.value = 'Причина'
    textarea.dispatchEvent(new globalThis.Event('input', { bubbles:true }))
    globalThis.document.body.querySelector('.ui-dialog__actions .ui-button--danger').click()
    await flushPromises()
    expect(textarea.value).toBe('Причина')
    expect(globalThis.document.body.textContent).toContain('Сократите причину.')
    expect(wrapper.text()).not.toContain('Заказ отменён')
  })

  it('reloads a changed order after a cancellation version conflict', async () => {
    let current = completeOrder()
    h.session.orderRequest.mockImplementation(async (path, _options, isCurrent, validate) => {
      if (path.endsWith('/cancel')) {
        current = completeOrder({ status:100, showReviewFields:false, updatedAt:'2026-09-15T10:01:00Z' })
        throw new ProblemError({
          type:CORE_PROBLEM_TYPES.orderUpdateConflict, title:'Заказ изменился', status:409,
          detail:'Обновите карточку', instance:'/api/v1/orders/test/cancel', code:'order_update_conflict'
        })
      }
      const value = path.endsWith('/ops') ? ops : current
      if (isCurrent()) validate(value)
      return value
    })
    const { wrapper } = await mountAt()
    await wrapper.get('.order-details-heading .ui-button--danger').trigger('click')
    await flushPromises()
    globalThis.document.body.querySelector('.ui-dialog__actions .ui-button--danger').click()
    await flushPromises()
    expect(wrapper.text()).toContain('Расчёт готов')
    expect(wrapper.text()).toContain('Обновите карточку')
    expect(wrapper.vm.$.setupState.cancelOpen).toBe(false)
    expect(h.session.orderRequest.mock.calls.filter(([path]) => path.endsWith('/ops'))).toHaveLength(2)
  })

  it('discards a cancellation reply after the customer changes', async () => {
    let finishCancellation
    h.session.orderRequest.mockImplementation(async (path, _options, isCurrent, validate) => {
      if (path.endsWith('/cancel')) {
        await new Promise(resolve => { finishCancellation = resolve })
        const cancelled = completeOrder({ status:500, showReviewFields:false,
          updatedAt:'2026-09-15T10:05:00Z', cancelledAt:'2026-09-15T10:05:00Z' })
        if (isCurrent()) validate(cancelled)
        return cancelled
      }
      const value = path.endsWith('/ops') ? ops : completeOrder()
      if (isCurrent()) validate(value)
      return value
    })
    const { wrapper } = await mountAt()
    await wrapper.get('.order-details-heading .ui-button--danger').trigger('click')
    await flushPromises()
    globalThis.document.body.querySelector('.ui-dialog__actions .ui-button--danger').click()
    await flushPromises()
    h.session.customer.value = { id:8 }
    await flushPromises()
    finishCancellation()
    await flushPromises()
    expect(wrapper.text()).not.toContain('Заказ отменён')
    expect(wrapper.vm.$.setupState.cancelBusy).toBe(false)
    expect(wrapper.vm.$.setupState.cancelOpen).toBe(false)
  })

  it('keeps cancellation open while submitting and closes on the leave action', async () => {
    const { wrapper } = await mountAt()
    await wrapper.get('.order-details-heading .ui-button--danger').trigger('click')
    await flushPromises()
    const state = wrapper.vm.$.setupState
    state.cancelBusy = true
    state.closeCancellation()
    expect(state.cancelOpen).toBe(true)
    state.cancelBusy = false
    globalThis.document.body.querySelector('.ui-dialog__actions .ui-button--secondary').click()
    await flushPromises()
    expect(state.cancelOpen).toBe(false)
    expect(h.session.orderRequest.mock.calls.filter(([path]) => path.endsWith('/cancel'))).toHaveLength(0)
  })

  it('rejects an overlong reason before sending it', async () => {
    const { wrapper } = await mountAt()
    await wrapper.get('.order-details-heading .ui-button--danger').trigger('click')
    await flushPromises()
    wrapper.vm.$.setupState.cancelReason = 'x'.repeat(2001)
    globalThis.document.body.querySelector('.ui-dialog__actions .ui-button--danger').click()
    await flushPromises()
    expect(globalThis.document.body.textContent).toContain('не должна превышать 2000 символов')
    expect(h.session.orderRequest.mock.calls.filter(([path]) => path.endsWith('/cancel'))).toHaveLength(0)
  })

  it('keeps the dialog open when cancellation returns an active order', async () => {
    h.session.orderRequest.mockImplementation(async (path, _options, isCurrent, validate) => {
      const value = path.endsWith('/ops') ? ops : completeOrder()
      if (isCurrent()) validate(value)
      return value
    })
    const { wrapper } = await mountAt()
    await wrapper.get('.order-details-heading .ui-button--danger').trigger('click')
    await flushPromises()
    globalThis.document.body.querySelector('.ui-dialog__actions .ui-button--danger').click()
    await flushPromises()
    expect(wrapper.vm.$.setupState.cancelOpen).toBe(true)
    expect(globalThis.document.body.textContent).toContain('Сервис временно недоступен')
  })

  it('loads the current product into the expanded read-only review card', async () => {
    const { wrapper } = await mountAt()
    expect(h.session.orderRequest).toHaveBeenNthCalledWith(1, '/api/v1/orders/ops', {}, expect.any(Function), expect.any(Function))
    expect(h.session.orderRequest).toHaveBeenNthCalledWith(2, '/api/v1/orders/12345678-3', {}, expect.any(Function), expect.any(Function))
    expect(wrapper.text()).toContain('Заказ 12345678-3')
    expect(wrapper.text()).not.toContain('← Мои заказы')
    expect(wrapper.text()).toContain('Проверим данные в течение двух часов')
    expect(wrapper.text()).not.toContain('Предварительная стоимость указана ниже')
    expect(wrapper.get('.customer-cost__headline > span').text()).toBe('Предварительная стоимость')
    expect(wrapper.get('.customer-cost').element.nextElementSibling).toBe(wrapper.get('.order-review-card').element)
    expect(wrapper.findAll('.order-review-card .order-item-fields input').map(field => field.element.value)).toContain('12,34 $')
    expect(wrapper.findAll('.order-review-card .order-item-fields .ui-field')).toHaveLength(8)
    expect(wrapper.get('.order-item-fields').element.lastElementChild.classList.contains('order-item-fields__comment')).toBe(true)
    expect(wrapper.findAll('.order-review-card .order-item-fields input[readonly]')).toHaveLength(7)
    expect(wrapper.get('.order-review-card').text()).not.toContain('Стоимость')
    expect(wrapper.get('.order-review-card .order-item-fields textarea').attributes('readonly')).toBeDefined()
    expect(wrapper.get('.order-review-card .order-item-fields__source a').attributes('href')).toBe('https://shop.example.com/item')
  })

  it('shows the saved confirmed amount, deadline, and post-confirmation customs separately', async () => {
    h.session.orderRequest.mockImplementation(async (path, _options, isCurrent, validate) => {
      const value = path.endsWith('/ops') ? ops : completeOrder({ pricing:{
        ...forecastPricing, state:100, totalRub:12000, calculatedAt:forecastPricing.asOf,
        validUntil:'2026-09-15T11:00:00Z', customsRub:0
      } })
      if (isCurrent()) validate(value)
      return value
    })
    const { wrapper } = await mountAt()
    expect(wrapper.text()).toContain('12 000,00 ₽')
    expect(wrapper.text()).toContain('Действует до')
    expect(wrapper.text()).toContain('Таможенные платежи0,00 ₽')
    expect(wrapper.text()).not.toContain('В разработке')
  })

  it('shows a staff-saved domestic delivery amount after refreshing the order', async () => {
    let delivery = null
    h.session.orderRequest.mockImplementation(async (path, _options, isCurrent, validate) => {
      const value = path.endsWith('/ops') ? ops : completeOrder({ pricing:{
        ...forecastPricing, state:100, totalRub:5228.31, calculatedAt:forecastPricing.asOf,
        validUntil:'2026-09-28T19:41:00Z', domesticDeliveryRub:delivery
      } })
      if (isCurrent()) validate(value)
      return value
    })
    const { wrapper } = await mountAt()
    expect(wrapper.get('.customer-cost__excluded').text()).toContain('Будет рассчитана позже')

    delivery = 1000
    await wrapper.get('.order-details-heading__actions > button').trigger('click')
    await flushPromises()
    expect(wrapper.get('.customer-cost__excluded').text()).toContain('Доставка по России1 000,00 ₽')
  })

  it('deduplicates an in-flight tab return and refreshes saved pricing after it settles', async () => {
    let finishOps
    h.session.orderRequest.mockImplementation((path, _options, isCurrent, validate) => {
      if (path.endsWith('/ops')) {
        if (!finishOps) return new Promise(resolve => { finishOps = () => { if (isCurrent()) validate(ops); resolve(ops) } })
        if (isCurrent()) validate(ops)
        return Promise.resolve(ops)
      }
      const value = completeOrder()
      if (isCurrent()) validate(value)
      return Promise.resolve(value)
    })
    const { wrapper } = await mountAt()
    expect(h.session.orderRequest).toHaveBeenCalledOnce()
    globalThis.document.dispatchEvent(new globalThis.Event('visibilitychange'))
    expect(h.session.orderRequest).toHaveBeenCalledOnce()
    finishOps()
    await flushPromises()
    expect(h.session.orderRequest).toHaveBeenCalledTimes(2)
    globalThis.document.dispatchEvent(new globalThis.Event('visibilitychange'))
    await flushPromises()
    expect(h.session.orderRequest).toHaveBeenCalledTimes(4)
    wrapper.unmount()
  })

  it.each(['01234567-3', 'Заказ / 3'])('keeps %s opaque and encodes the API path', async number => {
    const { wrapper } = await mountAt(`/orders/${encodeURIComponent(number)}`)
    expect(h.session.orderRequest).toHaveBeenNthCalledWith(2,
      `/api/v1/orders/${encodeURIComponent(number)}`, {}, expect.any(Function), expect.any(Function))
    expect(wrapper.text()).toContain(`Заказ ${number}`)
  })

  it('rejects a detail response for a different public number', async () => {
    h.session.orderRequest.mockImplementation(async (path, _options, isCurrent, validate) => {
      const value = path.endsWith('/ops') ? ops : completeOrder({ orderNumber:'12345678-4' })
      if (isCurrent()) validate(value)
      return value
    })
    const { wrapper } = await mountAt()
    expect(wrapper.get('[role="alert"]').exists()).toBe(true)
    expect(wrapper.find('.order-review-card').exists()).toBe(false)
  })

  it('renders a compact historical summary when review fields are hidden', async () => {
    h.session.orderRequest.mockImplementation(async (path, _options, isCurrent, validate) => {
      const value = path.endsWith('/ops') ? ops : completeOrder({
        status:400,
        showReviewFields:false
      })
      if (isCurrent()) validate(value)
      return value
    })
    const { wrapper } = await mountAt()
    expect(wrapper.find('.order-summary-card').exists()).toBe(true)
    expect(wrapper.get('.customer-cost').element.nextElementSibling).toBe(wrapper.get('.order-summary-card').element)
    expect(wrapper.find('.order-item-fields').exists()).toBe(false)
    expect(wrapper.text()).toContain('shop.example.com')
    expect(wrapper.get('.order-summary-card').text()).toContain('12,34 $')
    expect(wrapper.text()).toContain('Получен')
    expect(wrapper.text()).toContain('синий')
    expect(wrapper.text()).toContain('Комментарий')
  })

  it('renders missing historical product attributes as not specified', async () => {
    h.session.orderRequest.mockImplementation(async (path, _options, isCurrent, validate) => {
      const emptyProduct = product({ color:null, size:null, comment:null })
      const value = path.endsWith('/ops') ? ops : completeOrder({
        status:400,
        showReviewFields:false,
        product:emptyProduct,
        productName:emptyProduct.productName,
        storeName:emptyProduct.storeName,
        sellerPrice:emptyProduct.sellerPrice,
        quantity:emptyProduct.quantity,
        comment:null
      })
      if (isCurrent()) validate(value)
      return value
    })
    const { wrapper } = await mountAt()
    expect(wrapper.find('.order-summary-card').text()).toContain('ЦветНе указано')
    expect(wrapper.find('.order-summary-card').text()).toContain('РазмерНе указано')
    expect(wrapper.find('.order-summary-card').text()).toContain('КомментарийНе указано')
  })

  it('uses explicit empty values for missing product attributes', async () => {
    h.session.orderRequest.mockImplementation(async (path, _options, isCurrent, validate) => {
      const value = path.endsWith('/ops') ? ops : completeOrder({
        product:product({
          productName:null, storeName:null, sellerPrice:null, color:null, size:null, comment:null
        })
      })
      if (isCurrent()) validate(value)
      return value
    })
    const { wrapper } = await mountAt()
    const values = wrapper.findAll('.order-review-card .order-item-fields input').map(field => field.element.value)
    expect(values.filter(value => value === 'Не указано')).toHaveLength(5)
  })

  it('reloads for a changed order route and discards a stale completion', async () => {
    let finishFirst
    h.session.orderRequest.mockImplementation((path, _options, isCurrent, validate) => {
      if (path.endsWith('/ops')) {
        if (h.session.orderRequest.mock.calls.length === 1) {
          return new Promise(resolve => { finishFirst = resolve })
            .then(value => {
              if (isCurrent()) validate(value)
              return value
            })
        }
        validate(ops)
        return Promise.resolve(ops)
      }
      const value = completeOrder({ orderNumber:'12345678-4' })
      validate(value)
      return Promise.resolve(value)
    })
    const mounting = mountAt('/orders/12345678-3')
    await vi.waitFor(() => expect(finishFirst).toBeTypeOf('function'))
    const { router, wrapper } = await mounting
    await router.push('/orders/12345678-4')
    await flushPromises()
    finishFirst(ops)
    await flushPromises()
    expect(wrapper.text()).toContain('Заказ 12345678-4')
    expect(wrapper.text()).not.toContain('Заказ 12345678-3')
  })

  it('discards a stale detail response after the route changes', async () => {
    let finishDetail
    h.session.orderRequest.mockImplementation((path, _options, isCurrent, validate) => {
      if (path.endsWith('/ops')) {
        validate(ops)
        return Promise.resolve(ops)
      }
      if (path.endsWith('/12345678-3')) {
        return new Promise(resolve => { finishDetail = resolve }).then(value => {
          if (isCurrent()) validate(value)
          return value
        })
      }
      const value = completeOrder({ orderNumber:'12345678-4' })
      validate(value)
      return Promise.resolve(value)
    })
    const mounting = mountAt('/orders/12345678-3')
    await vi.waitFor(() => expect(finishDetail).toBeTypeOf('function'))
    const { router, wrapper } = await mounting
    await router.push('/orders/12345678-4')
    await flushPromises()
    finishDetail(completeOrder({}))
    await flushPromises()
    expect(wrapper.text()).toContain('Заказ 12345678-4')
  })

  it('does not present a detail failure from the previous customer', async () => {
    let rejectDetail
    h.session.orderRequest.mockImplementation((path, _options, isCurrent, validate) => {
      if (path.endsWith('/ops')) {
        validate(ops)
        return Promise.resolve(ops)
      }
      if (!rejectDetail) {
        return new Promise((_resolve, reject) => { rejectDetail = reject })
      }
      const value = completeOrder({})
      if (isCurrent()) validate(value)
      return Promise.resolve(value)
    })
    const mounting = mountAt()
    await vi.waitFor(() => expect(rejectDetail).toBeTypeOf('function'))
    const { wrapper } = await mounting
    h.session.customer.value = { id:8 }
    rejectDetail(createInternalProblem('networkUnavailable'))
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Заказ 12345678-3')
  })

  it('keeps failures recoverable and refreshes the current detail', async () => {
    h.session.orderRequest.mockRejectedValueOnce(createInternalProblem('serviceUnavailable'))
    const { wrapper } = await mountAt()
    expect(wrapper.get('[role="alert"]').text()).toContain(SERVICE_UNAVAILABLE_MESSAGE)
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Заказ 12345678-3')
    await wrapper.get('.order-details-heading__actions > button').trigger('click')
    await flushPromises()
    expect(h.session.orderRequest).toHaveBeenCalledTimes(5)
  })

  it.each(['%20', 'ops', 'OPS', 'preview', 'Preview', '%6f%70%73'])('rejects invalid route %s before Ops loading and preserves identity', async segment => {
    const { wrapper } = await mountAt(`/orders/${segment}`)
    expect(h.session.orderRequest).not.toHaveBeenCalled()
    expect(h.session.customer.value).toEqual({ id:7 })
    expect(wrapper.get('[role="alert"]').exists()).toBe(true)
  })

  it('clears loading when a pending valid route changes to an invalid route', async () => {
    let finishOps
    h.session.orderRequest.mockImplementation(() => new Promise(resolve => { finishOps = resolve }))
    const mounting = mountAt()
    await vi.waitFor(() => expect(finishOps).toBeTypeOf('function'))
    const { router, wrapper } = await mounting

    await router.push('/orders/%20')
    await flushPromises()
    expect(wrapper.find('[aria-label="Загрузка заказа"]').exists()).toBe(false)
    expect(wrapper.get('[role="alert"]').exists()).toBe(true)

    finishOps(ops)
    await flushPromises()
  })

  it('rejects an overlong route number and disposes an in-flight request on unmount', async () => {
    const invalid = await mountAt('/orders/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')
    expect(h.session.orderRequest).not.toHaveBeenCalled()
    invalid.wrapper.unmount()

    let finish
    h.session.orderRequest.mockImplementationOnce((_path, _options, isCurrent) => new Promise(resolve => {
      finish = () => resolve(isCurrent() ? ops : null)
    }))
    const pending = mountAt('/orders/12345678-3')
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    const { wrapper } = await pending
    wrapper.unmount()
    finish()
    await flushPromises()
    expect(h.session.orderRequest).toHaveBeenCalledOnce()
  })

  it('reloads when the authenticated customer changes', async () => {
    const { wrapper } = await mountAt()
    h.session.customer.value = { id:8 }
    await flushPromises()
    expect(h.session.orderRequest).toHaveBeenCalledTimes(4)
    expect(wrapper.text()).toContain('Заказ 12345678-3')
  })

  it('does not request order data after the customer signs out', async () => {
    await mountAt()
    expect(h.session.orderRequest).toHaveBeenCalledTimes(2)

    h.session.customer.value = null
    await flushPromises()

    expect(h.session.orderRequest).toHaveBeenCalledTimes(2)
  })
})
