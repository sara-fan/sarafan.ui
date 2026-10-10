// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { expect, it, vi } from 'vitest'
import { validatePayment, validPaymentLink, isPaymentQrPath, paymentFingerprint, openPaymentLink } from '../src/orders/payment.js'
import { isOrderPaymentPath } from '../src/orderNumber.js'
import { payment } from './fixtures/payment.js'
import { ops } from './fixtures/orders.js'

it('retains exact bank links and string identifiers and distinguishes unknown/zero delivery', () => {
  for (const delivery of [null, 0, 100]) {
    const value = payment(); value.order.pricing.domesticDeliveryRub = delivery; value.mainPaymentRub = 1000 + (delivery ?? 0)
    expect(validatePayment(value, ops, value.order.orderNumber)).toEqual(value)
    expect(value.paymentInformation.information.inn).toBe('0012345678')
  }
  const individual = payment(); individual.paymentInformation.information.recipientType = 1; individual.paymentInformation.information.kpp = null
  expect(validatePayment(individual, ops, individual.order.orderNumber)).toEqual(individual)
  const empty = payment({ canPay:false, paymentInformation:null, mainPaymentRub:null })
  expect(validatePayment(empty, ops, empty.order.orderNumber)).toEqual(empty)
  expect(paymentFingerprint(empty)).not.toBe(paymentFingerprint(payment()))
})
it.each([null, '', 'https://', 'http://bank.example', 'https://user:pass@bank.example', 'https://bank.example/ x', 'https://bank.example/\\x', 'https://bank.example/' + 'a'.repeat(2048), ' https://bank.example'])('rejects invalid payment links %#', value => {
  expect(validPaymentLink(value)).toBe(false)
})
it.each([
  value => { value.canPay = 1 }, value => { value.mainPaymentRub = undefined }, value => { value.mainPaymentRub = -1 },
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
