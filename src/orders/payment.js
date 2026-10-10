// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { createInternalProblem } from '../errors/problem.js'
import { validateCustomerOrder } from '../stores/orders.js'
import { priceCents } from '../orderProduct.js'

export const BANK_FIELDS = Object.freeze({ recipientName:'Получатель', inn:'ИНН', kpp:'КПП', settlementAccount:'Расчётный счёт', bankName:'Банк', bik:'БИК', correspondentAccount:'Корреспондентский счёт' })
export const isPaymentQrPath = value => typeof value === 'string' && /^\/api\/v1\/payment-information\/current\/qr\?v=[a-f0-9]{64}$/u.test(value)
export function validPaymentLink(value) {
  if (typeof value !== 'string' || value.length > 2048 || value.trim() !== value || [...value].some(char => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127 || char === '\\')) return false
  try {
    const url = new globalThis.URL(value)
    return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password
  } catch { return false }
}
export function validatePayment(value, ops, number) {
  const fail = () => { throw createInternalProblem('protocolError') }
  const order = validateCustomerOrder(value?.order, ops, number)
  if (typeof value.canPay !== 'boolean' || !(value.mainPaymentRub === null || typeof value.mainPaymentRub === 'number'
    && value.mainPaymentRub >= 0 && priceCents(value.mainPaymentRub) !== null)) fail()
  const information = value.paymentInformation
  if (information !== null) {
    const data = information?.information
    if (!Number.isSafeInteger(information?.bundleId) || information.bundleId <= 0 || !isPaymentQrPath(information.qrUrl)
      || !data || ![0, 1].includes(data.recipientType) || !validPaymentLink(data.paymentLink)
      || Object.keys(BANK_FIELDS).some(key => key === 'kpp' && data.recipientType === 1 ? data[key] !== null
        : typeof data[key] !== 'string' || !data[key].trim() || data[key].length > 500)) fail()
  }
  if (value.canPay && (order.status !== 100 || order.pricing.state !== 100 || !order.checkout
    || Date.parse(order.pricing.validUntil) <= Date.parse(order.pricing.asOf) || value.mainPaymentRub === null || !information)) fail()
  return { order, mainPaymentRub:value.mainPaymentRub, canPay:value.canPay, paymentInformation:information }
}
export function paymentFingerprint(value) {
  return JSON.stringify([value.mainPaymentRub, value.order.updatedAt, value.paymentInformation?.bundleId,
    value.paymentInformation?.qrUrl, value.paymentInformation?.information.paymentLink])
}
export function openPaymentLink(link) { globalThis.location.assign(link) }
