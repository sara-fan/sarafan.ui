// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { readonly, ref } from 'vue'

import { isIsoDate, isRfc3339DateTime } from '../api/validation.js'
import { createInternalProblem } from '../errors/problem.js'
import { priceCents, validatePreviewProductDto, validateProductDto, validateProductLimits } from '../orderProduct.js'
import { normalizeProductAddress } from '../productAddress.js'

const ROUTE_ALIAS_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/u
const TOP_LEVEL_DOMAIN_PATTERN = /^[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?$/u
const TOP_LEVEL_DOMAIN_VERSION_PATTERN = /^\d{10}$/u

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
      && !url.username && !url.password
  } catch {
    return false
  }
}

export function validateOrderOps(value) {
  if (!value || !Array.isArray(value.statuses) || value.statuses.length === 0
    || !Array.isArray(value.currencies) || value.currencies.length === 0
    || !value.productSourceUrl
    || !Number.isInteger(value.productSourceUrl.maximumLength)
    || value.productSourceUrl.maximumLength <= 0 || value.productSourceUrl.maximumLength > 65535
    || typeof value.productSourceUrl.topLevelDomainListVersion !== 'string'
    || !TOP_LEVEL_DOMAIN_VERSION_PATTERN.test(value.productSourceUrl.topLevelDomainListVersion)
    || !Array.isArray(value.productSourceUrl.topLevelDomains)
    || value.productSourceUrl.topLevelDomains.length === 0) protocolError()
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
  const productLimits = validateProductLimits(value.productLimits, value.currencies)
  const topLevelDomains = new Set()
  let previousTopLevelDomain = null
  for (const item of value.productSourceUrl.topLevelDomains) {
    if (typeof item !== 'string' || !TOP_LEVEL_DOMAIN_PATTERN.test(item)
      || topLevelDomains.has(item) || previousTopLevelDomain !== null && item < previousTopLevelDomain) protocolError()
    topLevelDomains.add(item)
    previousTopLevelDomain = item
  }
  return {
    statuses:value.statuses.map(item => ({ ...item })),
    currencies:value.currencies.map(item => ({ ...item })),
    productSourceUrl:{
      ...value.productSourceUrl,
      topLevelDomains:[...value.productSourceUrl.topLevelDomains]
    },
    productLimits
  }
}

function validateSellerPrice(value, currencyValues, limits) {
  if (value === null) return
  if (!value || typeof value.amount !== 'number' || !Number.isFinite(value.amount) || value.amount <= 0
    || !Number.isInteger(value.currency) || !currencyValues.has(value.currency)
    || value.currency !== limits.sellerPriceCurrency
    || priceCents(value.amount) === null || value.amount > limits.maximumUnitPrice) protocolError()
}

function validateOrderIdentityAndProduct(item, statusValues, currencyValues, limits) {
  if (!item || !Number.isSafeInteger(item.id) || item.id <= 0
    || !validText(item.orderNumber, 64)
    || !Number.isInteger(item.status) || !statusValues.has(item.status)
    || !validHttpUrl(item.sourceUrl) || !validNullableText(item.productName, limits.productNameMaximumLength)
    || !validNullableText(item.storeName, limits.storeNameMaximumLength)
    || item.imageUrl !== null && !validHttpUrl(item.imageUrl)
    || !Number.isInteger(item.quantity) || item.quantity <= 0) protocolError()
  validateSellerPrice(item.sellerPrice, currencyValues, limits)
}

export function validateProductPreview(value, ops) {
  if (!value || !['manual_review', 'recognized'].includes(value.outcome)
    || typeof value.sourceUrl !== 'string'
    || normalizeProductAddress(value.sourceUrl, ops.productSourceUrl) !== value.sourceUrl
    || !Object.hasOwn(value, 'product')) protocolError()
  return {
    sourceUrl:value.sourceUrl,
    outcome:value.outcome,
    product:value.product === null ? null : validatePreviewProductDto(value.product, ops.currencies, ops.productLimits)
  }
}

function validateCompleteOrder(value, ops) {
  const statusValues = new Set(ops.statuses.map(item => item.value))
  const currencyValues = new Set(ops.currencies.map(item => item.value))
  validateOrderIdentityAndProduct(value, statusValues, currencyValues, ops.productLimits)
  const product = validateProductDto(value.product, ops.currencies, ops.productLimits)
  if (!validNullableText(value.comment, ops.productLimits.commentMaximumLength)
    || !isRfc3339DateTime(value.createdAt)
    || typeof value.showReviewFields !== 'boolean'
    || value.dimensions !== null && (!value.dimensions
      || ['lengthCm', 'widthCm', 'heightCm'].some(field => typeof value.dimensions[field] !== 'number'
        || !Number.isFinite(value.dimensions[field]) || value.dimensions[field] <= 0))
    || value.characteristics !== null && (!value.characteristics
      || typeof value.characteristics !== 'object' || Array.isArray(value.characteristics)
      || Object.entries(value.characteristics).some(([key, item]) => !key || typeof item !== 'string'))
    || value.appliedExchangeRate !== null && (!value.appliedExchangeRate
      || !Number.isSafeInteger(value.appliedExchangeRate.id) || value.appliedExchangeRate.id <= 0
      || !validText(value.appliedExchangeRate.provider, 200)
      || !Number.isInteger(value.appliedExchangeRate.baseCurrency)
      || !currencyValues.has(value.appliedExchangeRate.baseCurrency)
      || !Number.isInteger(value.appliedExchangeRate.quoteCurrency)
      || !currencyValues.has(value.appliedExchangeRate.quoteCurrency)
      || value.appliedExchangeRate.baseCurrency === value.appliedExchangeRate.quoteCurrency
      || !Number.isInteger(value.appliedExchangeRate.nominal) || value.appliedExchangeRate.nominal <= 0
      || typeof value.appliedExchangeRate.officialRate !== 'number'
      || !Number.isFinite(value.appliedExchangeRate.officialRate) || value.appliedExchangeRate.officialRate <= 0
      || !isIsoDate(value.appliedExchangeRate.sourceEffectiveDate))) protocolError()
  if (value.productName !== product.productName || value.storeName !== product.storeName
    || value.quantity !== product.quantity || value.comment !== product.comment
    || value.sellerPrice?.amount !== product.sellerPrice?.amount
    || value.sellerPrice?.currency !== product.sellerPrice?.currency) protocolError()
  return {
    ...value,
    product,
    sellerPrice:value.sellerPrice ? { ...value.sellerPrice } : null,
    dimensions:value.dimensions ? { ...value.dimensions } : null,
    characteristics:value.characteristics ? { ...value.characteristics } : null,
    appliedExchangeRate:value.appliedExchangeRate ? { ...value.appliedExchangeRate } : null
  }
}

export function validateCreatedOrder(value, ops, expected) {
  const order = validateCompleteOrder(value, ops)
  if (order.sourceUrl !== expected.sourceUrl) protocolError()
  return order
}

export function validateCustomerOrder(value, ops, expectedId) {
  const order = validateCompleteOrder(value, ops)
  if (order.id !== expectedId) protocolError()
  return order
}

export function validateCustomerOrders(value, ops) {
  if (!Array.isArray(value)) protocolError()
  const statusValues = new Set(ops.statuses.map(item => item.value))
  const currencyValues = new Set(ops.currencies.map(item => item.value))
  const ids = new Set()
  const orderNumbers = new Set()
  let previous = null
  for (const item of value) {
    validateOrderIdentityAndProduct(item, statusValues, currencyValues, ops.productLimits)
    if (ids.has(item.id) || orderNumbers.has(item.orderNumber) || !isRfc3339DateTime(item.createdAt)) protocolError()
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
