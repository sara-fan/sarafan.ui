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
import OrdersView from '../src/views/OrdersView.vue'

const statusItems = new Map([
  [0, { value:0, name:'На проверке', routeAlias:'under_review', upperStatusName:'На проверке', upperStatusRouteAlias:'under_review' }],
  [310, { value:310, name:'Выкупаем товар', routeAlias:'purchasing_item', upperStatusName:'Выполняется', upperStatusRouteAlias:'in_progress' }],
  [400, { value:400, name:'Получен', routeAlias:'received', upperStatusName:'Завершён', upperStatusRouteAlias:'completed' }],
  [500, { value:500, name:'Отменён', routeAlias:'cancelled', upperStatusName:'Отменён', upperStatusRouteAlias:'cancelled' }]
])

async function mountView() {
  const router = createAppRouter(createMemoryHistory())
  await router.push('/orders')
  return { router, wrapper:mount(OrdersView, { global:{ plugins:[router] } }) }
}

describe('OrdersView', () => {
  beforeEach(() => {
    h.session = { customer:ref({ id:7 }) }
    h.store.orders = ref([])
    h.store.loading = ref(false)
    h.store.load = vi.fn().mockResolvedValue(true)
    h.store.dispose = vi.fn()
    h.store.statusFor = vi.fn(value => statusItems.get(value))
    h.store.currencyFor = vi.fn(value => value === 840
      ? { value:840, name:'Доллар США', routeAlias:'usd' }
      : { value, name:'Евро', routeAlias:'eur' })
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
      { id:4, orderNumber:'12345678-4', status:310, productName:'Куртка', storeName:'Магазин', imageUrl:'https://images.example/item.jpg', sellerPrice:{ amount:85, currency:840 }, quantity:2, createdAt:'2026-09-14T10:00:00Z' },
      { id:3, orderNumber:'12345678-3', status:0, productName:'', storeName:null, imageUrl:null, sellerPrice:null, quantity:11, createdAt:'2026-09-13T10:00:00Z' },
      { id:2, orderNumber:'12345678-2', status:400, productName:'Сумка', storeName:'Бутик', imageUrl:'https://images.example/history.jpg', sellerPrice:{ amount:10, currency:978 }, quantity:1, createdAt:'2026-09-12T10:00:00Z' }
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
    expect(wrapper.text()).toContain('10,00 Евро')
    expect(wrapper.text()).toContain('14 сентября 2026')
    expect(wrapper.findAll('.order-card__progress-track')).toHaveLength(2)
    expect(wrapper.findAll('.order-card__progress-track')[0].attributes('aria-hidden')).toBe('true')

    const images = wrapper.findAll('.order-card__visual img')
    expect(images).toHaveLength(2)
    expect(images[0].attributes('referrerpolicy')).toBe('no-referrer')
    await images[0].trigger('error')
    await wrapper.get('.orders-panel--history .order-card__visual img').trigger('error')
    expect(wrapper.find('.order-card__visual img').exists()).toBe(false)

    await wrapper.findAll('.order-card')[2].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value).toMatchObject({ name:'order-details', params:{ orderId:'2' } })
  })

  it('presents load failures once and retries successfully', async () => {
    h.store.load
      .mockRejectedValueOnce(createInternalProblem('networkUnavailable'))
      .mockImplementationOnce(async () => {
        h.store.orders.value = [{ id:1, orderNumber:'12345678-1', status:500, productName:null, storeName:null, imageUrl:null, sellerPrice:null, quantity:4, createdAt:'2026-09-11T10:00:00Z' }]
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
    statusItems.set(999, { value:999, name:'Новый этап', routeAlias:'new_stage', upperStatusName:'Новый этап', upperStatusRouteAlias:'new_group' })
    h.store.orders.value = Array.from({ length:11 }, (_, index) => ({
      id:20 - index,
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
    const { wrapper } = await mountView()
    await flushPromises()

    expect(wrapper.text()).toContain('11 заказов')
    expect(wrapper.get('.order-card__status').classes()).toContain('order-card__status--review')
    expect(wrapper.get('.order-card__progress-track span').attributes('style')).toContain('width: 0%')
    expect(wrapper.text()).toContain('₽ 100,00')
    statusItems.delete(999)
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
