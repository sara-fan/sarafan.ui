// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { readonly, ref } from 'vue'

import { isRfc3339DateTime } from '../api/validation.js'
import { createInternalProblem } from '../errors/problem.js'

const ROUTE_ALIAS_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/u

function protocolError() { throw createInternalProblem('protocolError') }
function validText(value, maximum) {
  return typeof value === 'string' && Boolean(value.trim()) && value.length <= maximum
}
function validNullableText(value, maximum) {
  return value === null || typeof value === 'string' && value.length <= maximum
}
function validHttpUrl(value) {
  if (!validText(value, 2048)) return false
  try {
    const url = new globalThis.URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname)
  } catch {
    return false
  }
}

export function validateOrderOps(value) {
  if (!value || !Array.isArray(value.statuses) || value.statuses.length === 0
    || !Array.isArray(value.currencies) || value.currencies.length === 0) protocolError()
  const statusValues = new Set()
  const statusAliases = new Set()
  for (const item of value.statuses) {
    if (!item || !Number.isInteger(item.value) || item.value < 0
      || !validText(item.name, 200) || !validText(item.routeAlias, 100) || !ROUTE_ALIAS_PATTERN.test(item.routeAlias)
      || !Number.isInteger(item.upperStatusValue) || item.upperStatusValue < 0
      || !validText(item.upperStatusName, 200) || !validText(item.upperStatusRouteAlias, 100)
      || !ROUTE_ALIAS_PATTERN.test(item.upperStatusRouteAlias)
      || typeof item.isTerminal !== 'boolean'
      || !Number.isInteger(item.progressPercent) || item.progressPercent < 0 || item.progressPercent > 100
      || item.isTerminal && item.progressPercent !== 100
      || statusValues.has(item.value) || statusAliases.has(item.routeAlias)) protocolError()
    statusValues.add(item.value)
    statusAliases.add(item.routeAlias)
  }
  const statusByValue = new Map(value.statuses.map(item => [item.value, item]))
  if (value.statuses.some(item => !statusValues.has(item.upperStatusValue)
    || item.isTerminal !== statusByValue.get(item.upperStatusValue)?.isTerminal)) {
    protocolError()
  }
  const currencyValues = new Set()
  const currencyAliases = new Set()
  for (const item of value.currencies) {
    if (!item || !Number.isInteger(item.value) || item.value < 0
      || !validText(item.name, 200) || !validText(item.routeAlias, 100) || !ROUTE_ALIAS_PATTERN.test(item.routeAlias)
      || currencyValues.has(item.value) || currencyAliases.has(item.routeAlias)) protocolError()
    currencyValues.add(item.value)
    currencyAliases.add(item.routeAlias)
  }
  return {
    statuses:value.statuses.map(item => ({ ...item })),
    currencies:value.currencies.map(item => ({ ...item }))
  }
}

function validateSellerPrice(value, currencyValues) {
  if (value === null) return
  if (!value || typeof value.amount !== 'number' || !Number.isFinite(value.amount) || value.amount <= 0
    || !Number.isInteger(value.currency) || !currencyValues.has(value.currency)) protocolError()
}

export function validateCustomerOrders(value, ops) {
  if (!Array.isArray(value)) protocolError()
  const statusValues = new Set(ops.statuses.map(item => item.value))
  const currencyValues = new Set(ops.currencies.map(item => item.value))
  const ids = new Set()
  const orderNumbers = new Set()
  let previous = null
  for (const item of value) {
    if (!item || !Number.isSafeInteger(item.id) || item.id <= 0 || ids.has(item.id)
      || !validText(item.orderNumber, 64) || orderNumbers.has(item.orderNumber)
      || !Number.isInteger(item.status) || !statusValues.has(item.status)
      || !validHttpUrl(item.sourceUrl) || !validNullableText(item.productName, 500)
      || !validNullableText(item.storeName, 200)
      || item.imageUrl !== null && !validHttpUrl(item.imageUrl)
      || !Number.isInteger(item.quantity) || item.quantity <= 0 || !isRfc3339DateTime(item.createdAt)) protocolError()
    validateSellerPrice(item.sellerPrice, currencyValues)
    const createdAt = Date.parse(item.createdAt)
    if (previous && (createdAt > previous.createdAt
      || createdAt === previous.createdAt && item.id > previous.id)) protocolError()
    ids.add(item.id)
    orderNumbers.add(item.orderNumber)
    previous = { createdAt, id:item.id }
  }
  return value.map(item => ({ ...item, sellerPrice:item.sellerPrice ? { ...item.sellerPrice } : null }))
}

export function createOrderStore(session) {
  const orders = ref([])
  const ops = ref(null)
  const loading = ref(false)
  let generation = 0

  async function load() {
    const requestGeneration = ++generation
    const customerId = session.customer.value?.id
    const isCurrent = () => requestGeneration === generation && session.customer.value?.id === customerId
    loading.value = true
    try {
      let validatedOps
      await session.orderRequest('/api/v1/orders/ops', {}, isCurrent, value => {
        validatedOps = validateOrderOps(value)
      })
      if (!isCurrent()) return false
      let validatedOrders
      await session.orderRequest('/api/v1/orders', {}, isCurrent, value => {
        validatedOrders = validateCustomerOrders(value, validatedOps)
      })
      if (!isCurrent()) return false
      ops.value = validatedOps
      orders.value = validatedOrders
      return true
    } finally {
      if (requestGeneration === generation) loading.value = false
    }
  }

  function statusFor(value) { return ops.value?.statuses.find(item => item.value === value) }
  function currencyFor(value) { return ops.value?.currencies.find(item => item.value === value) }
  function progressFor(value) { return statusFor(value)?.progressPercent }
  function reset() { generation++; loading.value = false; orders.value = []; ops.value = null }
  function dispose() { reset() }

  return {
    orders:readonly(orders),
    ops:readonly(ops),
    loading:readonly(loading),
    load,
    statusFor,
    currencyFor,
    progressFor,
    reset,
    dispose
  }
}
