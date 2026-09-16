// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { createInternalProblem } from './errors/problem.js'
import { formatMoneyInput } from './moneyFormatting.js'
import { isIsoDate } from './api/validation.js'

export const PRODUCT_FIELDS = Object.freeze([
  'storeName', 'productName', 'sellerPrice', 'quantity', 'color', 'size', 'comment'
])

const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0
const nullableNormalizedText = (value, maximum) => value === null
  || typeof value === 'string' && Boolean(value) && value.trim() === value && value.length <= maximum
const protocolError = () => { throw createInternalProblem('protocolError') }

function limitIsValid(value, currencies) {
  return value && positive(value.maximumAmount) && priceCents(value.maximumAmount) !== null
    && typeof value.exceededMessage === 'string' && Boolean(value.exceededMessage.trim())
    && currencies.some(item => item.value === value.currency && item.routeAlias === 'eur')
    && typeof value.available === 'boolean'
    && (value.available
      ? isIsoDate(value.sourceEffectiveDate)
        && typeof value.maximumTotalUsd === 'number' && Number.isFinite(value.maximumTotalUsd)
        && value.maximumTotalUsd >= 0 && priceCents(value.maximumTotalUsd) !== null
      : value.sourceEffectiveDate === null && value.maximumTotalUsd === null)
}

export function validateProductLimits(value, currencies) {
  if (!value || !['minimumQuantity', 'maximumQuantity', 'defaultQuantity', 'storeNameMaximumLength',
    'productNameMaximumLength', 'colorMaximumLength', 'sizeMaximumLength', 'commentMaximumLength']
    .every(key => Number.isSafeInteger(value[key]) && value[key] > 0)
    || value.minimumQuantity > value.defaultQuantity || value.defaultQuantity > value.maximumQuantity
    || !positive(value.maximumUnitPrice) || priceCents(value.maximumUnitPrice) === null || value.priceDecimalPlaces !== 2
    || !currencies.some(item => item.value === value.sellerPriceCurrency && item.routeAlias === 'usd')
    || !limitIsValid(value.valueLimit, currencies)) protocolError()
  return {
    ...value,
    valueLimit:{ ...value.valueLimit }
  }
}

function validateProduct(value, currencies, limits, allowPreviewCurrency) {
  if (!value || !nullableNormalizedText(value.storeName, limits.storeNameMaximumLength)
    || !nullableNormalizedText(value.productName, limits.productNameMaximumLength)
    || !nullableNormalizedText(value.color, limits.colorMaximumLength)
    || !nullableNormalizedText(value.size, limits.sizeMaximumLength)
    || !nullableNormalizedText(value.comment, limits.commentMaximumLength)
    || !Number.isSafeInteger(value.quantity) || value.quantity <= 0
    || value.sellerPrice !== null && (!value.sellerPrice || !positive(value.sellerPrice.amount)
      || !Number.isInteger(value.sellerPrice.currency)
      || !currencies.some(item => item.value === value.sellerPrice.currency)
      || !allowPreviewCurrency && value.sellerPrice.currency !== limits.sellerPriceCurrency
      || priceCents(value.sellerPrice.amount) === null
      || !allowPreviewCurrency && priceCents(value.sellerPrice.amount) > priceCents(limits.maximumUnitPrice))) protocolError()
  return {
    storeName:value.storeName,
    productName:value.productName,
    sellerPrice:value.sellerPrice ? { ...value.sellerPrice } : null,
    quantity:value.quantity,
    color:value.color,
    size:value.size,
    comment:value.comment
  }
}

export function validateProductDto(value, currencies, limits) {
  return validateProduct(value, currencies, limits, false)
}

export function validatePreviewProductDto(value, currencies, limits) {
  return validateProduct(value, currencies, limits, true)
}

export function previewPrefill(product, limits) {
  if (!product) {
    return {
      storeName:'', productName:'', sellerPrice:'', quantity:String(limits.defaultQuantity),
      color:'', size:'', comment:''
    }
  }
  return {
    storeName:product.storeName ?? '',
    productName:product.productName ?? '',
    sellerPrice:product.sellerPrice?.currency === limits.sellerPriceCurrency
      ? formatMoneyInput(product.sellerPrice.amount) : '',
    quantity:String(product.quantity),
    color:product.color ?? '',
    size:product.size ?? '',
    comment:product.comment ?? ''
  }
}

// Parse decimal input into integer cents, without binary floating-point comparisons.
export function priceCents(value) {
  const raw = String(value).trim().replace(',', '.')
  if (!/^\d+(?:\.\d{1,2})?$/u.test(raw)) return null
  const [whole, fraction = ''] = raw.split('.')
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
}

export function productFormErrors(form, limits) {
  const errors = {}
  const name = form.productName.trim()
  if (!name) errors.productName = ['Укажите название товара.']
  else if (name.length > limits.productNameMaximumLength) {
    errors.productName = [`Не более ${limits.productNameMaximumLength} символов.`]
  }
  for (const [key, maximum] of [
    ['storeName', limits.storeNameMaximumLength],
    ['color', limits.colorMaximumLength],
    ['size', limits.sizeMaximumLength],
    ['comment', limits.commentMaximumLength]
  ]) {
    if (form[key].trim().length > maximum) errors[key] = [`Не более ${maximum} символов.`]
  }

  const rawQuantity = form.quantity.trim()
  let quantity = null
  if (!rawQuantity) errors.quantity = ['Укажите количество товара.']
  else if (!/^-?\d+$/u.test(rawQuantity)) errors.quantity = ['Количество должно быть целым числом.']
  else {
    quantity = Number(rawQuantity)
    if (!Number.isSafeInteger(quantity)) {
      errors.quantity = ['Количество должно быть целым числом.']
    } else if (quantity === 0 || quantity < limits.minimumQuantity) {
      errors.quantity = ['Такое количество нельзя заказать.']
    } else if (quantity > limits.maximumQuantity) {
      errors.quantity = ['Такое количество товара может быть признано коммерческой партией и запрещено к ввозу']
    }
  }

  const rawPrice = form.sellerPrice.trim()
  const cents = priceCents(rawPrice)
  if (!rawPrice) errors.sellerPrice = ['Укажите цену товара.']
  else if (cents === null || cents <= 0n || cents > priceCents(limits.maximumUnitPrice)) {
    errors.sellerPrice = ['Укажите положительную цену в USD, не более двух знаков после запятой.']
  } else if (!errors.quantity && limits.valueLimit.available
    && cents * BigInt(quantity) > priceCents(limits.valueLimit.maximumTotalUsd)) {
    errors.sellerPrice = [limits.valueLimit.exceededMessage]
  }
  return errors
}

export function productPayload(form, limits) {
  const cents = priceCents(form.sellerPrice)
  return {
    sourceUrl:form.sourceUrl,
    product:{
      storeName:form.storeName.trim() || null,
      productName:form.productName.trim(),
      sellerPrice:{ amount:Number(cents) / 100, currency:limits.sellerPriceCurrency },
      color:form.color.trim() || null,
      size:form.size.trim() || null
    },
    quantity:Number(form.quantity),
    comment:form.comment.trim() || null
  }
}
