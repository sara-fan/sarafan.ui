// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application
import { describe, expect, it } from 'vitest'
import { validateCheckout, validateCheckoutDeliveries } from '../src/orders/checkout.js'
import { validateCustomerOrder, validateOrderOps } from '../src/stores/orders.js'
import { isOrderCheckoutPath } from '../src/orderNumber.js'
import { completeOrder, ops } from './fixtures/orders.js'
const profile = { phone:'+79990001234', firstName:'Иван', lastName:'Иванов', patronymic:null, email:null,
  passportSeries:null, passportNumber:null, passportIssueDate:null, passportIssuedBy:null, inn:null, postalCode:null, city:null, address:null }
function checkout() { return { profile:{ ...profile }, delivery:{ routeAlias:'courier', name:'Курьерская доставка', destination:'123456, Москва, Адрес' } } }
describe('checkout response contract', () => {
  it('clones a valid saved snapshot and delivery metadata', () => {
    const value = checkout(), result = validateCheckout(value, ops.checkoutDeliveries)
    expect(result).toEqual(value); expect(result.profile).not.toBe(value.profile)
    expect(validateOrderOps(ops).checkoutDeliveries).toEqual(ops.checkoutDeliveries)
    expect(validateCustomerOrder(completeOrder({ checkout:value }), ops, '12345678-3').checkout).toEqual(value)
    const full = { ...profile, passportIssueDate:'2010-01-01' }
    expect(validateCheckout({ ...value, profile:full }, ops.checkoutDeliveries).profile).toEqual(full)
  })
  it.each([null, {}, { delivery:ops.checkoutDeliveries[0] }, { profile }, { profile, delivery:{ routeAlias:'unknown' } }])('rejects malformed envelope %#', value => {
    expect(() => validateCheckout(value, ops.checkoutDeliveries)).toThrow(expect.objectContaining({ code:'ui_protocol_error' }))
  })
  it.each([
    ['phone', null], ['phone', 7], ['phone', '123'], ['phone', ['+79990001234']], ['phone', []], ['phone', { number:'+79990001234' }], ['firstName', ' '], ['firstName', 1], ['lastName', null], ['lastName', ' '],
    ['email', 5], ['passportIssuedBy', 'a'.repeat(501)], ['passportIssueDate', 'invalid']
  ])('rejects invalid saved profile %s %#', (field, value) => {
    const dto = checkout(); dto.profile[field] = value
    expect(() => validateCustomerOrder(completeOrder({ checkout:dto }), ops, '12345678-3')).toThrow(expect.objectContaining({ code:'ui_protocol_error' }))
  })
  it.each([
    null, [], [ops.checkoutDeliveries[0]], [ops.checkoutDeliveries[0], ops.checkoutDeliveries[0]],
    [null, ops.checkoutDeliveries[1]], [{ ...ops.checkoutDeliveries[0], name:'' }, ops.checkoutDeliveries[1]],
    [{ ...ops.checkoutDeliveries[0], destination:123 }, ops.checkoutDeliveries[1]],
    [{ ...ops.checkoutDeliveries[0], routeAlias:'other' }, ops.checkoutDeliveries[1]]
  ])('rejects malformed delivery Ops %#', value => {
    expect(() => validateCheckoutDeliveries(value)).toThrow(expect.objectContaining({ code:'ui_protocol_error' }))
    expect(() => validateOrderOps({ ...ops, checkoutDeliveries:value })).toThrow()
  })
  it.each(['name', 'destination'])('rejects empty saved selection metadata %s', field => {
    const dto = checkout(); dto.delivery[field] = ''
    expect(() => validateCheckout(dto, ops.checkoutDeliveries)).toThrow()
  })
  it('admits only encoded order checkout paths', () => {
    expect(isOrderCheckoutPath('/api/v1/orders/12345678-3/checkout')).toBe(true)
    for (const path of [null, '/api/v1/orders/ops/checkout', '/api/v1/orders/%zz/checkout', '/api/v1/orders/3/checkout/other', '/api/v1/orders/%2e%2e/checkout']) expect(isOrderCheckoutPath(path)).toBe(false)
  })
})
