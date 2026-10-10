// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { isRfc3339DateTime } from '../api/validation.js'
import { createInternalProblem } from '../errors/problem.js'
import { formatMoneyAmount } from '../moneyFormatting.js'

const money = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
  && Math.abs(Math.round(value * 100) - value * 100) < 0.000001

function protocolError() { throw createInternalProblem('protocolError') }

export function validatePricingStates(value) {
  if (!Array.isArray(value) || value.length < 3) protocolError()
  const values = new Set()
  const aliases = new Set()
  for (const item of value) {
    if (!item || !Number.isInteger(item.value) || item.value < 0
      || typeof item.name !== 'string' || !item.name.trim()
      || typeof item.routeAlias !== 'string' || !/^[a-z0-9]+(?:_[a-z0-9]+)*$/u.test(item.routeAlias)
      || values.has(item.value) || aliases.has(item.routeAlias)) protocolError()
    values.add(item.value)
    aliases.add(item.routeAlias)
  }
  if ([0, 100, 200].some(value => !values.has(value))) protocolError()
  return value.map(item => ({ ...item }))
}

export function validatePricing(value) {
  if (!value || ![0, 100, 200].includes(value.state)
    || !isRfc3339DateTime(value.asOf)
    || value.totalRub !== null && !money(value.totalRub)
    || value.totalRub !== null && value.calculatedAt === null
    || value.calculatedAt !== null && !isRfc3339DateTime(value.calculatedAt)
    || value.validUntil !== null && !isRfc3339DateTime(value.validUntil)
    || value.domesticDeliveryRub !== null && !money(value.domesticDeliveryRub)
    || value.customsRub !== null && !money(value.customsRub)
    || typeof value.customsPaid !== 'boolean'
    || value.state === 0 && value.validUntil !== null
    || value.state !== 0 && (value.totalRub === null || value.validUntil === null)) protocolError()
  return { ...value }
}

export function formatRub(amount, symbol) {
  return amount === null ? 'Стоимость уточняется' : `${formatMoneyAmount(amount)} ${symbol}`
}

export function formatMoscow(instant) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone:'Europe/Moscow', day:'2-digit', month:'2-digit', year:'numeric',
    hour:'2-digit', minute:'2-digit'
  }).format(new Date(instant)) + ' МСК'
}
