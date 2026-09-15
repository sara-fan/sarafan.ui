// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import {
  createOrderStore,
  validateCreatedOrder,
  validateCustomerOrder,
  validateCustomerOrders,
  validateOrderOps,
  validateProductPreview
} from '../src/stores/orders.js'
import { completeOrder, currencies, ops, product, productLimits, productSourceUrl, statuses } from './fixtures/orders.js'
const orders = [
  { id:2, orderNumber:'12345678-2', status:100, sourceUrl:'https://shop.example.com/two', productName:'Товар', storeName:'Магазин', imageUrl:'https://images.example/two.jpg', sellerPrice:{ amount:12.34, currency:840 }, quantity:2, createdAt:'2026-09-14T10:00:00Z' },
  { id:1, orderNumber:'12345678-1', status:0, sourceUrl:'https://shop.example.com/one', productName:null, storeName:null, imageUrl:null, sellerPrice:null, quantity:1, createdAt:'2026-09-13T10:00:00Z' }
]

function protocolFailure(action) {
  expect(action).toThrow(expect.objectContaining({ code:'ui_protocol_error' }))
}

describe('order store', () => {
  it('validates the manual-review preview contract', () => {
    const validatedOps = validateOrderOps(ops)
    expect(validateProductPreview({ sourceUrl:'https://shop.example.com/item', outcome:'manual_review', product:null }, validatedOps))
      .toEqual({ sourceUrl:'https://shop.example.com/item', outcome:'manual_review', product:null })
    expect(validateProductPreview({ sourceUrl:'https://shop.example.com/item', outcome:'recognized', product:product() }, validatedOps).product)
      .toEqual(product())
    for (const value of [
      null,
      {},
      { sourceUrl:'https://shop.example.com/item', outcome:'recognized' },
      { sourceUrl:7, outcome:'manual_review', product:null },
      { sourceUrl:'shop.example.com/item', outcome:'manual_review', product:null },
      { sourceUrl:'https://127.0.0.1/item', outcome:'manual_review', product:null },
      { sourceUrl:'https://alice:secret@shop.example.com/item', outcome:'manual_review', product:null },
      { sourceUrl:'https://shop.example.com/item', outcome:'unknown', product:null },
      { sourceUrl:'https://shop.example.com/item', outcome:'recognized', product:{} }
    ]) protocolFailure(() => validateProductPreview(value, validatedOps))
  })

  it('validates a complete created order against the submitted payload', () => {
    const value = completeOrder({
      dimensions:{ lengthCm:1, widthCm:2, heightCm:3 },
      characteristics:{ color:'blue' },
      appliedExchangeRate:{
        id:5,
        provider:'Банк России',
        baseCurrency:840,
        quoteCurrency:643,
        nominal:1,
        officialRate:82.5,
        sourceEffectiveDate:'2026-09-15'
      }
    })
    const validated = validateCreatedOrder(value, validateOrderOps(ops), {
      sourceUrl:value.sourceUrl
    })
    expect(validated).toEqual(value)
    expect(validated.dimensions).not.toBe(value.dimensions)
    expect(validated.characteristics).not.toBe(value.characteristics)
    expect(validated.appliedExchangeRate).not.toBe(value.appliedExchangeRate)
  })

  it.each([
    value => ({ ...value, comment:'x'.repeat(2001) }),
    value => ({ ...value, dimensions:{} }),
    value => ({ ...value, dimensions:{ lengthCm:0, widthCm:2, heightCm:3 } }),
    value => ({ ...value, characteristics:[] }),
    value => ({ ...value, characteristics:{ '': 'blue' } }),
    value => ({ ...value, characteristics:{ color:3 } }),
    value => ({ ...value, appliedExchangeRate:{} }),
    value => ({ ...value, appliedExchangeRate:{ id:0, provider:'bank', baseCurrency:840, quoteCurrency:643, nominal:1, officialRate:1, sourceEffectiveDate:'2026-09-15' } }),
    value => ({ ...value, appliedExchangeRate:{ id:5, provider:' ', baseCurrency:840, quoteCurrency:643, nominal:1, officialRate:1, sourceEffectiveDate:'2026-09-15' } }),
    value => ({ ...value, appliedExchangeRate:{ id:5, provider:'bank', baseCurrency:999, quoteCurrency:643, nominal:1, officialRate:1, sourceEffectiveDate:'2026-09-15' } }),
    value => ({ ...value, appliedExchangeRate:{ id:5, provider:'bank', baseCurrency:840, quoteCurrency:840, nominal:1, officialRate:1, sourceEffectiveDate:'2026-09-15' } }),
    value => ({ ...value, appliedExchangeRate:{ id:5, provider:'bank', baseCurrency:840, quoteCurrency:643, nominal:0, officialRate:1, sourceEffectiveDate:'2026-09-15' } }),
    value => ({ ...value, appliedExchangeRate:{ id:5, provider:'bank', baseCurrency:840, quoteCurrency:643, nominal:1, officialRate:0, sourceEffectiveDate:'2026-09-15' } }),
    value => ({ ...value, appliedExchangeRate:{ id:5, provider:'bank', baseCurrency:840, quoteCurrency:643, nominal:1, officialRate:1, sourceEffectiveDate:'2026-02-30' } }),
    value => ({ ...value, sourceUrl:'https://other.example.com/item' }),
    value => ({ ...value, productName:'other' }),
    value => ({ ...value, quantity:3 })
  ])('rejects a malformed or mismatched created order %#', mutate => {
    const value = completeOrder()
    protocolFailure(() => validateCreatedOrder(mutate(value), validateOrderOps(ops), {
      sourceUrl:value.sourceUrl
    }))
  })

  it('accepts staff-corrected current product on idempotent replay and validates a detail identity', () => {
    const corrected = completeOrder({ product:product({ productName:'Исправленное название', quantity:4, comment:'Исправлено' }) })
    expect(validateCreatedOrder(corrected, validateOrderOps(ops), { sourceUrl:corrected.sourceUrl }).product)
      .toEqual(corrected.product)
    expect(validateCustomerOrder(corrected, validateOrderOps(ops), corrected.id).id).toBe(corrected.id)
    protocolFailure(() => validateCustomerOrder(corrected, validateOrderOps(ops), corrected.id + 1))
  })

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
    expect(store.ops.value.productSourceUrl).not.toBe(productSourceUrl)
    expect(store.ops.value.productSourceUrl.topLevelDomains).not.toBe(productSourceUrl.topLevelDomains)
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
    { statuses:[], currencies, productSourceUrl, productLimits },
    { statuses, currencies:[], productSourceUrl, productLimits },
    { statuses, currencies, productSourceUrl },
    { statuses, currencies, productSourceUrl:null, productLimits },
    { statuses, currencies, productSourceUrl:{ ...productSourceUrl, maximumLength:0 }, productLimits },
    { statuses, currencies, productSourceUrl:{ ...productSourceUrl, topLevelDomainListVersion:'latest' }, productLimits },
    { statuses, currencies, productSourceUrl:{ ...productSourceUrl, topLevelDomains:[] }, productLimits },
    { statuses, currencies, productSourceUrl:{ ...productSourceUrl, topLevelDomains:['COM', 'COM'] }, productLimits },
    { statuses, currencies, productSourceUrl:{ ...productSourceUrl, topLevelDomains:['XN--P1AI', 'COM'] }, productLimits },
    { statuses, currencies, productSourceUrl:{ ...productSourceUrl, topLevelDomains:['com'] }, productLimits },
    { statuses:[...statuses, { ...statuses[0], value:1 }], currencies, productSourceUrl, productLimits },
    { statuses:[...statuses, { ...statuses[0], value:600, routeAlias:'under_review' }], currencies, productSourceUrl, productLimits },
    { statuses:statuses.map(item => item.routeAlias === 'under_review' ? { ...item, upperStatusValue:999 } : item), currencies, productSourceUrl, productLimits },
    { statuses:statuses.map((item, index) => index ? item : { ...item, name:' ' }), currencies, productSourceUrl, productLimits },
    { statuses:statuses.map((item, index) => index ? item : { ...item, routeAlias:7 }), currencies, productSourceUrl, productLimits },
    { statuses:statuses.map((item, index) => index ? item : { ...item, upperStatusName:' ' }), currencies, productSourceUrl, productLimits },
    { statuses:statuses.map((item, index) => index ? item : { ...item, upperStatusRouteAlias:7 }), currencies, productSourceUrl, productLimits },
    { statuses:statuses.map((item, index) => index ? item : { ...item, isTerminal:'false' }), currencies, productSourceUrl, productLimits },
    { statuses:statuses.map((item, index) => index ? item : { ...item, progressPercent:1.5 }), currencies, productSourceUrl, productLimits },
    { statuses:statuses.map((item, index) => index ? item : { ...item, progressPercent:101 }), currencies, productSourceUrl, productLimits },
    { statuses:statuses.map(item => item.value === 400 ? { ...item, progressPercent:99 } : item), currencies, productSourceUrl, productLimits },
    { statuses:statuses.map(item => item.value === 300 ? { ...item, upperStatusValue:400 } : item), currencies, productSourceUrl, productLimits },
    { statuses, currencies:[...currencies, { ...currencies[0], value:999 }], productSourceUrl, productLimits },
    { statuses, currencies:[...currencies, { ...currencies[0], value:999, routeAlias:'rub' }], productSourceUrl, productLimits },
    { statuses, currencies:currencies.map((item, index) => index ? item : { ...item, name:' ' }), productSourceUrl, productLimits },
    { statuses, currencies:currencies.map((item, index) => index ? item : { ...item, routeAlias:840 }), productSourceUrl, productLimits }
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
    [{ ...orders[0], sourceUrl:'ftp://shop.example.com/item' }],
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
