// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import { createOrderStore, validateCustomerOrders, validateOrderOps } from '../src/stores/orders.js'

const statuses = [
  { value:0, name:'На проверке', routeAlias:'under_review', upperStatusValue:0, upperStatusName:'На проверке', upperStatusRouteAlias:'under_review', isTerminal:false, progressPercent:14 },
  { value:100, name:'Расчёт готов', routeAlias:'quote_ready', upperStatusValue:100, upperStatusName:'Расчёт готов', upperStatusRouteAlias:'quote_ready', isTerminal:false, progressPercent:32 },
  { value:200, name:'Расчёт истёк', routeAlias:'quote_expired', upperStatusValue:200, upperStatusName:'Расчёт истёк', upperStatusRouteAlias:'quote_expired', isTerminal:false, progressPercent:32 },
  { value:300, name:'Оплачен', routeAlias:'paid', upperStatusValue:300, upperStatusName:'Выполняется', upperStatusRouteAlias:'in_progress', isTerminal:false, progressPercent:48 },
  { value:400, name:'Получен', routeAlias:'received', upperStatusValue:400, upperStatusName:'Завершён', upperStatusRouteAlias:'completed', isTerminal:true, progressPercent:100 },
  { value:500, name:'Отменён', routeAlias:'cancelled', upperStatusValue:500, upperStatusName:'Отменён', upperStatusRouteAlias:'cancelled', isTerminal:true, progressPercent:100 }
]
const currencies = [
  { value:643, name:'Российский рубль', routeAlias:'rub' },
  { value:840, name:'Доллар США', routeAlias:'usd' }
]
const ops = { statuses, currencies }
const orders = [
  { id:2, orderNumber:'12345678-2', status:100, sourceUrl:'https://shop.example/two', productName:'Товар', storeName:'Магазин', imageUrl:'https://images.example/two.jpg', sellerPrice:{ amount:12.34, currency:840 }, quantity:2, createdAt:'2026-09-14T10:00:00Z' },
  { id:1, orderNumber:'12345678-1', status:0, sourceUrl:'https://shop.example/one', productName:null, storeName:null, imageUrl:null, sellerPrice:null, quantity:1, createdAt:'2026-09-13T10:00:00Z' }
]

function protocolFailure(action) {
  expect(action).toThrow(expect.objectContaining({ code:'ui_protocol_error' }))
}

describe('order store', () => {
  it('loads, validates, clones, and resolves Core-owned metadata', async () => {
    const session = {
      customer:ref({ id:7 }),
      orderRequest:vi.fn((path, _options, _isCurrent, validateResponse) => {
        const value = path.endsWith('/ops') ? ops : orders
        validateResponse?.(value)
        return Promise.resolve(value)
      })
    }
    const store = createOrderStore(session)

    await expect(store.load()).resolves.toBe(true)

    expect(session.orderRequest).toHaveBeenNthCalledWith(
      1,
      '/api/v1/orders/ops',
      {},
      expect.any(Function),
      expect.any(Function)
    )
    expect(session.orderRequest).toHaveBeenNthCalledWith(
      2,
      '/api/v1/orders',
      {},
      expect.any(Function),
      expect.any(Function)
    )
    expect(store.loading.value).toBe(false)
    expect(store.orders.value).toEqual(orders)
    expect(store.orders.value).not.toBe(orders)
    expect(store.orders.value[0].sellerPrice).not.toBe(orders[0].sellerPrice)
    expect(store.statusFor(100)?.routeAlias).toBe('quote_ready')
    expect(store.currencyFor(840)?.routeAlias).toBe('usd')
    expect(store.progressFor(0)).toBe(14)
    expect(store.progressFor(300)).toBe(48)
    expect(store.progressFor(400)).toBe(100)
    expect(store.progressFor(999)).toBeUndefined()
    expect(store.statusFor(999)).toBeUndefined()
    expect(store.currencyFor(999)).toBeUndefined()
  })

  it('discards a completion after identity changes and invalidates pending work on dispose', async () => {
    let resolveOrders
    const pendingOrders = new Promise(resolve => { resolveOrders = resolve })
    const session = {
      customer:ref({ id:7 }),
      orderRequest:vi.fn((path, _options, isCurrent, validateResponse) => path.endsWith('/ops')
        ? Promise.resolve(validateResponse(ops)).then(() => ops)
        : pendingOrders.then(value => {
            if (!isCurrent()) return null
            validateResponse(value)
            return value
          }))
    }
    const store = createOrderStore(session)
    const request = store.load()
    expect(store.loading.value).toBe(true)
    session.customer.value = { id:8 }
    resolveOrders(orders)

    await expect(request).resolves.toBe(false)
    expect(store.orders.value).toEqual([])
    store.dispose()
    expect(store.loading.value).toBe(false)
    expect(store.ops.value).toBeNull()
  })

  it('keeps the newest request authoritative', async () => {
    let resolveFirst
    let orderRequests = 0
    const session = {
      customer:ref({ id:7 }),
      orderRequest:vi.fn((path, _options, isCurrent, validateResponse) => {
        if (path.endsWith('/ops')) return Promise.resolve(validateResponse(ops)).then(() => ops)
        orderRequests++
        const result = orderRequests === 1
          ? new Promise(resolve => { resolveFirst = resolve })
          : Promise.resolve([])
        return result.then(value => {
          if (!isCurrent()) return null
          validateResponse(value)
          return value
        })
      })
    }
    const store = createOrderStore(session)
    const first = store.load()
    await vi.waitFor(() => expect(orderRequests).toBe(1))
    const second = store.load()
    await expect(second).resolves.toBe(true)
    resolveFirst(orders)
    await expect(first).resolves.toBe(false)
    expect(store.orders.value).toEqual([])
  })

  it('suppresses a failed Ops request after its customer identity becomes stale', async () => {
    let rejectOps
    const session = {
      customer:ref({ id:7 }),
      orderRequest:vi.fn((path, _options, isCurrent) => path.endsWith('/ops')
        ? new Promise((_resolve, reject) => { rejectOps = reject }).catch(value => {
            if (!isCurrent()) return null
            throw value
          })
        : Promise.resolve(orders))
    }
    const store = createOrderStore(session)
    const request = store.load()
    session.customer.value = { id:8 }
    rejectOps(new Error('private transport detail'))

    await expect(request).resolves.toBe(false)
    expect(store.orders.value).toEqual([])
  })

  it('propagates an authorized failure that invalidates the current identity', async () => {
    const failure = new Error('current refresh failed')
    const session = {
      customer:ref({ id:7 }),
      orderRequest:vi.fn((path, _options, _isCurrent, validateResponse) => {
        if (path.endsWith('/ops')) return Promise.resolve(validateResponse(ops)).then(() => ops)
        session.customer.value = null
        return Promise.reject(failure)
      })
    }
    const store = createOrderStore(session)

    await expect(store.load()).rejects.toBe(failure)
    expect(store.loading.value).toBe(false)
  })

  it.each([
    null,
    {},
    { statuses:[], currencies },
    { statuses, currencies:[] },
    { statuses:[...statuses, { ...statuses[0], value:1 }], currencies },
    { statuses:[...statuses, { ...statuses[0], value:600, routeAlias:'under_review' }], currencies },
    { statuses:statuses.map(item => item.routeAlias === 'under_review' ? { ...item, upperStatusValue:999 } : item), currencies },
    { statuses:statuses.map((item, index) => index ? item : { ...item, name:' ' }), currencies },
    { statuses:statuses.map((item, index) => index ? item : { ...item, routeAlias:7 }), currencies },
    { statuses:statuses.map((item, index) => index ? item : { ...item, upperStatusName:' ' }), currencies },
    { statuses:statuses.map((item, index) => index ? item : { ...item, upperStatusRouteAlias:7 }), currencies },
    { statuses:statuses.map((item, index) => index ? item : { ...item, isTerminal:'false' }), currencies },
    { statuses:statuses.map((item, index) => index ? item : { ...item, progressPercent:1.5 }), currencies },
    { statuses:statuses.map((item, index) => index ? item : { ...item, progressPercent:101 }), currencies },
    { statuses:statuses.map(item => item.value === 400 ? { ...item, progressPercent:99 } : item), currencies },
    { statuses:statuses.map(item => item.value === 300 ? { ...item, upperStatusValue:400 } : item), currencies },
    { statuses, currencies:[...currencies, { ...currencies[0], value:999 }] },
    { statuses, currencies:[...currencies, { ...currencies[0], value:999, routeAlias:'rub' }] },
    { statuses, currencies:currencies.map((item, index) => index ? item : { ...item, name:' ' }) },
    { statuses, currencies:currencies.map((item, index) => index ? item : { ...item, routeAlias:840 }) }
  ])('rejects malformed Ops %#', value => {
    protocolFailure(() => validateOrderOps(value))
  })

  it.each([
    null,
    {},
    [{ ...orders[0], id:0 }],
    [{ ...orders[0], id:1.5 }],
    [{ ...orders[0], orderNumber:' ' }],
    [{ ...orders[0], status:999 }],
    [{ ...orders[0], sourceUrl:'ftp://shop.example/item' }],
    [{ ...orders[0], imageUrl:'invalid' }],
    [{ ...orders[0], quantity:0 }],
    [{ ...orders[0], createdAt:'2026-02-30T00:00:00Z' }],
    [{ ...orders[0], sellerPrice:{ amount:0, currency:840 } }],
    [{ ...orders[0], sellerPrice:{ amount:1, currency:999 } }],
    [orders[1], orders[0]],
    [orders[0], { ...orders[1], id:2 }],
    [orders[0], { ...orders[1], orderNumber:orders[0].orderNumber }]
  ])('rejects malformed or unsorted orders %#', value => {
    protocolFailure(() => validateCustomerOrders(value, validateOrderOps(ops)))
  })

  it('accepts opaque unique Core-owned order numbers', () => {
    const value = orders.map((order, index) => ({ ...order, orderNumber:`Заказ / ${index + 1}` }))
    expect(validateCustomerOrders(value, validateOrderOps(ops)).map(order => order.orderNumber))
      .toEqual(['Заказ / 1', 'Заказ / 2'])
  })
})
