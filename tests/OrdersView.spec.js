// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { createMemoryHistory } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ store:{}, session:{} }))
vi.mock('../src/stores/orders.js', () => ({ createOrderStore: () => h.store }))
vi.mock('../src/stores/session.js', () => ({ useSession: () => h.session }))

import { createInternalProblem } from '../src/errors/problem.js'
import { createAppRouter } from '../src/router.js'
import { resetOrderNoticesForTests, showOrderCreated } from '../src/stores/orderNotices.js'
import OrdersView from '../src/views/OrdersView.vue'

const statusItems = new Map([
  [0, { value:0, name:'На проверке', routeAlias:'under_review', upperStatusName:'На проверке', upperStatusRouteAlias:'under_review', isTerminal:false, progressPercent:14 }],
  [310, { value:310, name:'Выкупаем товар', routeAlias:'purchasing_item', upperStatusName:'Выполняется', upperStatusRouteAlias:'in_progress', isTerminal:false, progressPercent:56 }],
  [400, { value:400, name:'Получен', routeAlias:'received', upperStatusName:'Завершён', upperStatusRouteAlias:'completed', isTerminal:true, progressPercent:100 }],
  [500, { value:500, name:'Отменён', routeAlias:'cancelled', upperStatusName:'Отменён', upperStatusRouteAlias:'cancelled', isTerminal:true, progressPercent:100 }]
])

async function mountView() {
  const router = createAppRouter(createMemoryHistory())
  await router.push('/orders')
  return { router, wrapper:mount(OrdersView, { global:{ plugins:[router] } }) }
}

describe('OrdersView', () => {
  beforeEach(() => {
    resetOrderNoticesForTests()
    h.session = { customer:ref({ id:7 }) }
    h.store.orders = ref([])
    h.store.loading = ref(false)
    h.store.load = vi.fn().mockResolvedValue(true)
    h.store.reset = vi.fn(() => { h.store.orders.value = [] })
    h.store.dispose = vi.fn()
    h.store.statusFor = vi.fn(value => statusItems.get(value))
    h.store.currencyFor = vi.fn(value => value === 840
      ? { value:840, name:'Доллар США', routeAlias:'usd' }
      : { value, name:'Евро', routeAlias:'eur' })
    h.store.progressFor = vi.fn(value => statusItems.get(value)?.progressPercent)
  })

  it('shows the loading and empty states and navigates to product entry', async () => {
    let resolveLoad
    h.store.loading.value = true
    h.store.load.mockReturnValue(new Promise(resolve => { resolveLoad = resolve }))
    const { router, wrapper } = await mountView()

    expect(wrapper.get('[role="status"]').text()).toContain('Загружаем заказы')
    h.store.loading.value = false
    resolveLoad(true)
    await flushPromises()
    expect(wrapper.text()).toContain('Заказов пока нет')
    expect(wrapper.text()).toContain('0 заказов')

    await wrapper.get('.orders-state--empty button').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('home')
    wrapper.unmount()
    expect(h.store.dispose).toHaveBeenCalledOnce()
  })

  it('renders active and historical cards with honest fallbacks and resilient images', async () => {
    h.store.orders.value = [
      { orderNumber:'12345678-4', status:310, productName:'Куртка', storeName:'Магазин', imageUrl:'https://images.example/item.jpg', sellerPrice:{ amount:85, currency:840 }, quantity:2, createdAt:'2026-09-14T10:00:00Z' },
      { orderNumber:'12345678-3', status:0, productName:'', storeName:null, imageUrl:null, sellerPrice:null, quantity:11, createdAt:'2026-09-13T10:00:00Z' },
      { orderNumber:'12345678-2', status:400, productName:'Сумка', storeName:'Бутик', imageUrl:'https://images.example/history.jpg', sellerPrice:{ amount:10, currency:978 }, quantity:1, createdAt:'2026-09-12T10:00:00Z' }
    ]
    const { router, wrapper } = await mountView()
    await flushPromises()

    expect(wrapper.findAll('.orders-panel')).toHaveLength(2)
    expect(wrapper.text()).toContain('2 заказа')
    expect(wrapper.text()).toContain('1 заказ')
    expect(wrapper.text()).toContain('Выполняется')
    expect(wrapper.text()).toContain('Выкупаем товар')
    expect(wrapper.text()).toContain('Товар уточняется')
    expect(wrapper.text()).toContain('Магазин уточняется · 11 товаров')
    expect(wrapper.text()).toContain('Срок доставки уточняется')
    expect(wrapper.text()).toContain('$ 85,00')
    expect(wrapper.text()).toContain('€ 10,00')
    expect(wrapper.findAll('.order-card__price small')).toHaveLength(2)
    expect(wrapper.findAll('.order-card__price--empty')).toHaveLength(1)
    expect(wrapper.text()).toContain('14 сентября 2026')
    const progress = wrapper.findAll('[role="progressbar"]')
    expect(progress).toHaveLength(2)
    expect(progress[0].attributes()).toMatchObject({
      'aria-valuemin':'0',
      'aria-valuemax':'100',
      'aria-valuenow':'56',
      'aria-label':'Выполнение заказа 12345678-4'
    })

    const images = wrapper.findAll('.order-card__visual img')
    expect(images).toHaveLength(2)
    expect(images[0].attributes('referrerpolicy')).toBe('no-referrer')
    await images[0].trigger('error')
    await wrapper.get('.orders-panel--history .order-card__visual img').trigger('error')
    expect(wrapper.find('.order-card__visual img').exists()).toBe(false)

    await wrapper.findAll('.order-card')[2].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value).toMatchObject({ name:'order-details', params:{ orderNumber:'12345678-2' } })
  })

  it('shows a created-order notice once and reloads the owner-scoped list', async () => {
    showOrderCreated(7, '12345678-9')
    const first = await mountView()
    await flushPromises()
    expect(first.wrapper.text()).toContain('Номер заказа 12345678-9.')
    expect(h.store.load).toHaveBeenCalledOnce()
    first.wrapper.unmount()

    const second = await mountView()
    await flushPromises()
    expect(second.wrapper.text()).not.toContain('Номер заказа 12345678-9.')
  })

  it('gives a list-load failure precedence over the creation notice', async () => {
    showOrderCreated(7, '12345678-9')
    h.store.load.mockRejectedValue(createInternalProblem('networkUnavailable'))
    const { wrapper } = await mountView()
    await flushPromises()
    expect(wrapper.findAll('[role="alert"]')).toHaveLength(1)
    expect(wrapper.get('[role="alert"]').text()).toContain('Не удалось загрузить заказы')
    expect(wrapper.text()).not.toContain('Номер заказа 12345678-9.')
  })

  it('presents load failures once and retries successfully', async () => {
    h.store.load
      .mockRejectedValueOnce(createInternalProblem('networkUnavailable'))
      .mockImplementationOnce(async () => {
        h.store.orders.value = [{ orderNumber:'12345678-1', status:500, productName:null, storeName:null, imageUrl:null, sellerPrice:null, quantity:4, createdAt:'2026-09-11T10:00:00Z' }]
        return true
      })
    const { wrapper } = await mountView()
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('Не удалось загрузить заказы')
    expect(wrapper.text()).toContain('Список заказов временно недоступен')
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Активных заказов нет')
    expect(wrapper.text()).toContain('4 товара')
    expect(wrapper.text()).toContain('Отменён')
  })

  it('uses safe presentation defaults for added statuses and Russian count boundaries', async () => {
    statusItems.set(999, { value:999, name:'Новый этап', routeAlias:'renamed_stage', upperStatusName:'Новый этап', upperStatusRouteAlias:'renamed_group', isTerminal:false, progressPercent:63 })
    h.store.orders.value = Array.from({ length:11 }, (_, index) => ({
      orderNumber:`12345678-${20 - index}`,
      status:999,
      productName:'Товар',
      storeName:'Магазин',
      imageUrl:null,
      sellerPrice:{ amount:100, currency:643 },
      quantity:1,
      createdAt:`2026-09-${String(20 - index).padStart(2, '0')}T10:00:00Z`
    }))
    h.store.currencyFor.mockReturnValue({ value:643, name:'Российский рубль', routeAlias:'rub' })
    h.store.progressFor.mockReturnValue(63)
    const { wrapper } = await mountView()
    await flushPromises()

    expect(wrapper.text()).toContain('11 заказов')
    expect(wrapper.get('.order-card__status').classes()).toEqual(['order-card__status'])
    expect(wrapper.get('.order-card__progress-track span').attributes('style')).toContain('width: 63%')
    expect(wrapper.text()).toContain('₽ 100,00')
    statusItems.delete(999)
  })

  it('clears prior cards and reloads when the customer identity changes', async () => {
    h.store.orders.value = [
      { orderNumber:'12345678-1', status:0, productName:'Старый заказ', storeName:null, imageUrl:null, sellerPrice:null, quantity:1, createdAt:'2026-09-14T10:00:00Z' }
    ]
    const { wrapper } = await mountView()
    await flushPromises()
    expect(wrapper.text()).toContain('Старый заказ')

    h.session.customer.value = { id:8 }
    expect(h.store.reset).toHaveBeenCalledOnce()
    expect(h.store.orders.value).toEqual([])
    await flushPromises()
    expect(wrapper.text()).not.toContain('Старый заказ')
    expect(h.store.load).toHaveBeenCalledTimes(2)
  })

  it('never presents an order notice to a different customer or after identity replacement', async () => {
    showOrderCreated(8, '87654321-8')
    const otherCustomer = await mountView()
    await flushPromises()
    expect(otherCustomer.wrapper.text()).not.toContain('87654321-8')
    otherCustomer.wrapper.unmount()

    showOrderCreated(7, '12345678-7')
    const { wrapper } = await mountView()
    await flushPromises()
    expect(wrapper.text()).toContain('Номер заказа 12345678-7.')

    h.session.customer.value = { id:8 }
    await flushPromises()
    expect(wrapper.text()).not.toContain('12345678-7')
  })

  it('does not present a late failure after unmount', async () => {
    let rejectLoad
    h.store.load.mockReturnValue(new Promise((_resolve, reject) => { rejectLoad = reject }))
    const { wrapper } = await mountView()
    wrapper.unmount()
    rejectLoad(createInternalProblem('networkUnavailable'))
    await flushPromises()

    expect(h.store.dispose).toHaveBeenCalledOnce()
  })
})
