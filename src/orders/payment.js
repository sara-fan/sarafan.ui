// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { createInternalProblem } from '../errors/problem.js'
import { validateCustomerOrder } from '../stores/orders.js'
import { priceCents } from '../orderProduct.js'

export const BANK_FIELDS = Object.freeze({ recipientName:'Получатель', inn:'ИНН', kpp:'КПП', settlementAccount:'Расчётный счёт', bankName:'Банк', bik:'БИК', correspondentAccount:'Корреспондентский счёт' })
export const isPaymentQrPath = value => typeof value === 'string' && /^\/api\/v1\/payment-information\/current\/qr\?v=[a-f0-9]{64}$/u.test(value)
const digits = (value, length) => typeof value === 'string' && value.length === length && /^[0-9]+$/u.test(value)
const hasControlCharacters = value => /\p{Cc}/u.test(value)
function validBankInformation(data) {
  return data && [0, 1].includes(data.recipientType)
    && ['recipientName', 'bankName'].every(key => typeof data[key] === 'string' && data[key].length > 0
      && data[key].length <= 200 && data[key].trim() === data[key] && !hasControlCharacters(data[key]))
    && digits(data.inn, data.recipientType === 0 ? 10 : 12)
    && (data.recipientType === 1 ? data.kpp === null : digits(data.kpp, 9))
    && Object.entries({ settlementAccount:20, bik:9, correspondentAccount:20 }).every(([key, length]) => digits(data[key], length))
    && validPaymentLink(data.paymentLink)
}
export function validPaymentLink(value) {
  if (typeof value !== 'string' || value.length > 2048 || value.trim() !== value
    || hasControlCharacters(value) || value.includes(' ') || value.includes('\\')) return false
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
  const pricing = order.pricing
  if (order.checkout && pricing.validUntil !== null && pricing.totalRub !== null) {
    const total = priceCents(pricing.totalRub), delivery = priceCents(pricing.domesticDeliveryRub ?? 0)
    if (total === null || delivery === null || priceCents(value.mainPaymentRub) !== total + delivery) fail()
  } else if (value.mainPaymentRub !== null) fail()
  const information = value.paymentInformation
  if (!value.canPay && information !== null) fail()
  if (information !== null && (!Number.isSafeInteger(information?.bundleId) || information.bundleId <= 0
    || !isPaymentQrPath(information.qrUrl) || !validBankInformation(information.information))) fail()
  if (value.canPay && (order.status !== 100 || order.pricing.state !== 100 || !order.checkout
    || Date.parse(order.pricing.validUntil) <= Date.parse(order.pricing.asOf) || value.mainPaymentRub === null || !information)) fail()
  return { order, mainPaymentRub:value.mainPaymentRub, canPay:value.canPay, paymentInformation:information }
}
export function paymentFingerprint(value) {
  return JSON.stringify([value.mainPaymentRub, value.order.updatedAt, value.paymentInformation?.bundleId,
    value.paymentInformation?.qrUrl, value.paymentInformation?.information.paymentLink])
}
export function openPaymentLink(link) { globalThis.location.assign(link) }
