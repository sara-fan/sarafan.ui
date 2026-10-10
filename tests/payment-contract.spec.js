// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { expect, it, vi } from 'vitest'
import { validatePayment, validPaymentLink, isPaymentQrPath, paymentFingerprint, openPaymentLink } from '../src/orders/payment.js'
import { isOrderPaymentPath } from '../src/orderNumber.js'
import { payment } from './fixtures/payment.js'
import { ops, forecastPricing } from './fixtures/orders.js'
import { ProblemError } from '../src/errors/problem.js'

it('retains exact bank links and string identifiers and distinguishes unknown/zero delivery', () => {
  for (const delivery of [null, 0, 100]) {
    const value = payment(); value.order.pricing.domesticDeliveryRub = delivery; value.mainPaymentRub = 1000 + (delivery ?? 0)
    expect(validatePayment(value, ops, value.order.orderNumber)).toEqual(value)
    expect(value.paymentInformation.information.inn).toBe('0012345678')
  }
  const individual = payment(); individual.paymentInformation.information.recipientType = 1; individual.paymentInformation.information.kpp = null; individual.paymentInformation.information.inn = '001234567890'
  expect(validatePayment(individual, ops, individual.order.orderNumber)).toEqual(individual)
  const empty = payment({ canPay:false, paymentInformation:null })
  expect(validatePayment(empty, ops, empty.order.orderNumber)).toEqual(empty)
  expect(paymentFingerprint(empty)).not.toBe(paymentFingerprint(payment()))
})
it.each([null, '', 'https://', 'http://bank.example', 'https://user:pass@bank.example', 'https://bank.example/ x', 'https://bank.example/\\x', 'https://bank.example/' + 'a'.repeat(2048), ' https://bank.example'])('rejects invalid payment links %#', value => {
  expect(validPaymentLink(value)).toBe(false)
})
it.each([0x00, 0x09, 0x1f, 0x7f, 0x80, 0x85, 0x9f])('rejects bank links containing control character %i', code => {
  for (const link of [`https://bank.example/Pay/${String.fromCharCode(code)}Token`, `https://bank.example/Pay?Token=Ab${String.fromCharCode(code)}C`]) {
    expect(validPaymentLink(link)).toBe(false)
    const value = payment()
    value.paymentInformation.information.paymentLink = link
    expect(() => validatePayment(value, ops, value.order.orderNumber)).toThrowError(ProblemError)
  }
})
it.each([
  value => { value.canPay = 1 }, value => { value.canPay = false }, value => { value.mainPaymentRub = undefined }, value => { value.mainPaymentRub = -1 },
  value => { value.mainPaymentRub = 1.001 }, value => { value.paymentInformation = undefined }, value => { value.paymentInformation.bundleId = 0 },
  value => { value.paymentInformation.qrUrl = '/other' }, value => { value.paymentInformation.information = null },
  value => { value.paymentInformation.information.recipientType = 7 }, value => { value.paymentInformation.information.inn = 123 },
  value => { value.paymentInformation.information.bankName = ' ' }, value => { value.paymentInformation.information.bankName = 'x'.repeat(501) },
  value => { value.paymentInformation.information.paymentLink = 'javascript:private' },
  value => { value.paymentInformation.information.recipientType = 1 }, value => { value.order.status = 999 },
  value => { value.order.pricing.state = 200 }, value => { value.order.checkout = null },
  value => { value.order.pricing.validUntil = value.order.pricing.asOf }, value => { value.mainPaymentRub = null },
  value => { value.paymentInformation = null }
])('rejects malformed or unsafe payment response %#', mutate => {
  const value = payment(); mutate(value)
  expect(() => validatePayment(value, ops, value.order.orderNumber)).toThrow()
})

it('compares fractional amounts in kopecks and excludes customs', () => {
  const value = payment()
  value.order.pricing.totalRub = 0.1; value.order.pricing.domesticDeliveryRub = 0.2
  value.order.pricing.customsRub = 999; value.mainPaymentRub = 0.3
  expect(validatePayment(value, ops, value.order.orderNumber)).toEqual(value)
})
it.each(['no-checkout', 'forecast', 'missing-total', 'expired', 'paid'])('requires absent bank information while preserving Core amounts for %s', scenario => {
  const value = payment({ canPay:false, paymentInformation:null })
  if (scenario === 'no-checkout') { value.order.checkout = null; value.mainPaymentRub = null }
  if (scenario === 'forecast') { value.order.pricing.state = 0; value.order.pricing.validUntil = null; value.mainPaymentRub = null }
  if (scenario === 'missing-total') { value.order.pricing = { ...forecastPricing }; value.mainPaymentRub = null }
  if (scenario === 'expired') {
    value.order.status = 200; value.order.pricing.state = 200; value.order.pricing.validUntil = value.order.pricing.asOf
  }
  if (scenario === 'paid') { value.order.status = 300; value.order.canCancel = false }
  expect(validatePayment(value, ops, value.order.orderNumber)).toEqual(value)
  value.paymentInformation = payment().paymentInformation
  expect(() => validatePayment(value, ops, value.order.orderNumber)).toThrowError(ProblemError)
})
it.each([
  value => { value.mainPaymentRub = 1099.99 },
  value => { value.mainPaymentRub = 1100.01 },
  value => { value.mainPaymentRub = 1220 },
  value => { value.canPay = false; value.paymentInformation = null; value.mainPaymentRub = null },
  value => { value.canPay = false; value.paymentInformation = null; value.order.checkout = null },
  value => { value.canPay = false; value.paymentInformation = null; value.order.pricing.state = 0; value.order.pricing.validUntil = null },
  value => { value.order.pricing.totalRub = 0.30000000000000004 },
  value => { value.order.pricing.domesticDeliveryRub = 0.30000000000000004 }
])('rejects inconsistent amounts through the structured protocol boundary %#', mutate => {
  const value = payment(); mutate(value)
  expect(() => validatePayment(value, ops, value.order.orderNumber)).toThrowError(ProblemError)
})
it.each(['recipientName', 'bankName'])('enforces exact %s bounds and normalized text', key => {
  const value = payment()
  value.paymentInformation.information[key] = 'Я'.repeat(200)
  expect(validatePayment(value, ops, value.order.orderNumber)).toEqual(value)
  for (const text of ['Я'.repeat(201), '', ' padded', 'padded ', 'name\nline', 'name\u0085line', null, 200]) {
    value.paymentInformation.information[key] = text
    expect(() => validatePayment(value, ops, value.order.orderNumber)).toThrowError(ProblemError)
  }
})
it.each([
  ['inn', 10], ['kpp', 9], ['settlementAccount', 20], ['bik', 9], ['correspondentAccount', 20]
])('enforces ASCII digits and exact length for legal-entity %s', (key, length) => {
  const value = payment()
  for (const identifier of ['0'.repeat(length - 1), '0'.repeat(length + 1), '0'.repeat(length - 1) + 'x',
    '٠'.repeat(length), '0'.repeat(length - 1) + '\n', 123, null]) {
    value.paymentInformation.information[key] = identifier
    expect(() => validatePayment(value, ops, value.order.orderNumber)).toThrowError(ProblemError)
  }
})
it('requires a 12-digit entrepreneur INN and absent KPP', () => {
  const value = payment(), fields = value.paymentInformation.information
  fields.recipientType = 1; fields.kpp = null; fields.inn = '001234567890'
  expect(validatePayment(value, ops, value.order.orderNumber)).toEqual(value)
  for (const inn of ['0012345678', '00123456789', '0012345678901', '00123456789x']) {
    fields.inn = inn
    expect(() => validatePayment(value, ops, value.order.orderNumber)).toThrowError(ProblemError)
  }
  fields.inn = '001234567890'; fields.kpp = ''
  expect(() => validatePayment(value, ops, value.order.orderNumber)).toThrowError(ProblemError)
})

it('admits only payment order and digest QR endpoints and navigates in the same tab', () => {
  expect(isOrderPaymentPath('/api/v1/orders/12345678-3/payment')).toBe(true)
  for (const path of [null, '/api/v1/orders/ops/payment', '/api/v1/orders/%zz/payment', '/api/v1/orders/3/payment/other']) expect(isOrderPaymentPath(path)).toBe(false)
  expect(isPaymentQrPath(payment().paymentInformation.qrUrl)).toBe(true)
  for (const path of [null, '/api/v1/payment-information/current/qr', 'https://evil/qr', payment().paymentInformation.qrUrl + '&x=1']) expect(isPaymentQrPath(path)).toBe(false)
  const assign = vi.fn(); vi.stubGlobal('location', { assign })
  openPaymentLink(payment().paymentInformation.information.paymentLink)
  expect(assign).toHaveBeenCalledWith(payment().paymentInformation.information.paymentLink)
  vi.unstubAllGlobals()
})
