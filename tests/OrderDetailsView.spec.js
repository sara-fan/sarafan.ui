// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ session:{} }))
vi.mock('../src/stores/session.js', () => ({ useSession:() => h.session }))

import { createInternalProblem, SERVICE_UNAVAILABLE_MESSAGE } from '../src/errors/problem.js'
import OrderDetailsView from '../src/views/OrderDetailsView.vue'
import { completeOrder, ops, product } from './fixtures/orders.js'

async function mountAt(path = '/orders/3') {
  const empty = { template:'<main />' }
  const router = createRouter({
    history:createMemoryHistory(),
    routes:[
      { path:'/orders', name:'orders', component:empty },
      { path:'/orders/:orderId', name:'order-details', component:OrderDetailsView }
    ]
  })
  await router.push(path)
  const wrapper = mount(OrderDetailsView, { global:{ plugins:[router] } })
  await flushPromises()
  return { router, wrapper }
}

describe('OrderDetailsView', () => {
  beforeEach(() => {
    h.session.customer = ref({ id:7 })
    h.session.orderRequest = vi.fn(async (path, _options, isCurrent, validate) => {
      const value = path.endsWith('/ops') ? ops : completeOrder({ id:Number(path.split('/').at(-1)) })
      if (isCurrent()) validate(value)
      return value
    })
  })

  it('loads the current product into the expanded read-only review card', async () => {
    const { wrapper } = await mountAt()
    expect(h.session.orderRequest).toHaveBeenNthCalledWith(1, '/api/v1/orders/ops', {}, expect.any(Function), expect.any(Function))
    expect(h.session.orderRequest).toHaveBeenNthCalledWith(2, '/api/v1/orders/3', {}, expect.any(Function), expect.any(Function))
    expect(wrapper.text()).toContain('Заказ 12345678-3')
    expect(wrapper.text()).toContain('Проверим данные в течение двух часов')
    expect(wrapper.findAll('.order-review-fields input').map(field => field.element.value)).toContain('12,34 USD')
    expect(wrapper.findAll('.order-review-fields .ui-field')).toHaveLength(9)
    expect(wrapper.findAll('.order-review-fields input[readonly]')).toHaveLength(8)
    expect(wrapper.get('.order-review-fields textarea').attributes('readonly')).toBeDefined()
    expect(wrapper.get('.order-review-card__heading a').attributes('href')).toBe('https://shop.example.com/item')
  })

  it('renders a compact historical summary when review fields are hidden', async () => {
    h.session.orderRequest.mockImplementation(async (path, _options, isCurrent, validate) => {
      const value = path.endsWith('/ops') ? ops : completeOrder({
        id:3,
        status:400,
        showReviewFields:false
      })
      if (isCurrent()) validate(value)
      return value
    })
    const { wrapper } = await mountAt()
    expect(wrapper.find('.order-summary-card').exists()).toBe(true)
    expect(wrapper.find('.order-review-fields').exists()).toBe(false)
    expect(wrapper.text()).toContain('shop.example.com')
    expect(wrapper.text()).toContain('Получен')
    expect(wrapper.text()).toContain('синий')
    expect(wrapper.text()).toContain('Комментарий')
  })

  it('renders missing historical product attributes as not specified', async () => {
    h.session.orderRequest.mockImplementation(async (path, _options, isCurrent, validate) => {
      const emptyProduct = product({ color:null, size:null, comment:null })
      const value = path.endsWith('/ops') ? ops : completeOrder({
        id:3,
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
        id:3,
        product:product({
          productName:null, storeName:null, sellerPrice:null, color:null, size:null, comment:null
        })
      })
      if (isCurrent()) validate(value)
      return value
    })
    const { wrapper } = await mountAt()
    const values = wrapper.findAll('.order-review-fields input').map(field => field.element.value)
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
      const value = completeOrder({ id:Number(path.split('/').at(-1)), orderNumber:'12345678-4' })
      validate(value)
      return Promise.resolve(value)
    })
    const mounting = mountAt('/orders/3')
    await vi.waitFor(() => expect(finishFirst).toBeTypeOf('function'))
    const { router, wrapper } = await mounting
    await router.push('/orders/4')
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
      if (path.endsWith('/3')) {
        return new Promise(resolve => { finishDetail = resolve }).then(value => {
          if (isCurrent()) validate(value)
          return value
        })
      }
      const value = completeOrder({ id:4, orderNumber:'12345678-4' })
      validate(value)
      return Promise.resolve(value)
    })
    const mounting = mountAt('/orders/3')
    await vi.waitFor(() => expect(finishDetail).toBeTypeOf('function'))
    const { router, wrapper } = await mounting
    await router.push('/orders/4')
    await flushPromises()
    finishDetail(completeOrder({ id:3 }))
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
      const value = completeOrder({ id:3 })
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
    await wrapper.get('.order-details-heading > button').trigger('click')
    await flushPromises()
    expect(h.session.orderRequest).toHaveBeenCalledTimes(5)
  })

  it('rejects an invalid route without making a private request and navigates back', async () => {
    const { router, wrapper } = await mountAt('/orders/not-a-number')
    expect(h.session.orderRequest).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').exists()).toBe(true)
    await wrapper.get('.product-back').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('orders')
  })

  it('clears loading when a pending valid route changes to an invalid route', async () => {
    let finishOps
    h.session.orderRequest.mockImplementation(() => new Promise(resolve => { finishOps = resolve }))
    const mounting = mountAt()
    await vi.waitFor(() => expect(finishOps).toBeTypeOf('function'))
    const { router, wrapper } = await mounting

    await router.push('/orders/not-a-number')
    await flushPromises()
    expect(wrapper.get('.product-back').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('[role="alert"]').exists()).toBe(true)

    finishOps(ops)
    await flushPromises()
  })

  it('rejects an unsafe integer route id and disposes an in-flight request on unmount', async () => {
    const invalid = await mountAt('/orders/999999999999999999999')
    expect(h.session.orderRequest).not.toHaveBeenCalled()
    invalid.wrapper.unmount()

    let finish
    h.session.orderRequest.mockImplementationOnce((_path, _options, isCurrent) => new Promise(resolve => {
      finish = () => resolve(isCurrent() ? ops : null)
    }))
    const pending = mountAt('/orders/3')
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
