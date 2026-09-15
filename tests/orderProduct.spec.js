// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { describe, expect, it } from 'vitest'

import { formatMoneyAmount, formatMoneyInput } from '../src/moneyFormatting.js'
import {
  previewPrefill,
  priceCents,
  productFormErrors,
  productPayload,
  validateProductDto,
  validatePreviewProductDto,
  validateProductLimits
} from '../src/orderProduct.js'
import { currencies, product, productLimits } from './fixtures/orders.js'

function protocolFailure(action) {
  expect(action).toThrow(expect.objectContaining({ code:'ui_protocol_error' }))
}

describe('order product rules', () => {
  it('formats display and input money for the Russian locale', () => {
    expect(formatMoneyAmount(1234.5)).toBe('1 234,50')
    expect(formatMoneyInput(16.5)).toBe('16,50')
  })

  it.each([
    ['1', 100n], ['1.2', 120n], ['1,23', 123n], ['0001.00', 100n]
  ])('parses cents exactly from %s', (value, expected) => {
    expect(priceCents(value)).toBe(expected)
  })

  it.each(['', '-1', '1.234', '1,2.3', 'one'])('rejects malformed decimal %s', value => {
    expect(priceCents(value)).toBeNull()
  })

  it('validates and clones Ops product limits', () => {
    const validated = validateProductLimits(productLimits, currencies)
    expect(validated).toEqual(productLimits)
    expect(validated).not.toBe(productLimits)
    expect(validated.valueLimit).not.toBe(productLimits.valueLimit)
    expect(validateProductLimits({
      ...productLimits,
      valueLimit:{ ...productLimits.valueLimit, available:false, sourceEffectiveDate:null, maximumTotalUsd:null }
    }, currencies).valueLimit.available).toBe(false)
  })

  it.each([
    null,
    {},
    { ...productLimits, minimumQuantity:0 },
    { ...productLimits, defaultQuantity:5 },
    { ...productLimits, priceDecimalPlaces:3 },
    { ...productLimits, sellerPriceCurrency:978 },
    { ...productLimits, maximumUnitPrice:0 },
    { ...productLimits, maximumUnitPrice:1.234 },
    { ...productLimits, valueLimit:null },
    { ...productLimits, valueLimit:{ ...productLimits.valueLimit, maximumAmount:0 } },
    { ...productLimits, valueLimit:{ ...productLimits.valueLimit, currency:840 } },
    { ...productLimits, valueLimit:{ ...productLimits.valueLimit, exceededMessage:' ' } },
    { ...productLimits, valueLimit:{ ...productLimits.valueLimit, sourceEffectiveDate:'2026-02-30' } },
    { ...productLimits, valueLimit:{ ...productLimits.valueLimit, maximumTotalUsd:-1 } },
    { ...productLimits, valueLimit:{ ...productLimits.valueLimit, maximumTotalUsd:1.234 } },
    { ...productLimits, valueLimit:{ ...productLimits.valueLimit, available:false } }
  ])('rejects malformed product limits %#', value => {
    protocolFailure(() => validateProductLimits(value, currencies))
  })

  it('validates and clones product DTOs including nullable values', () => {
    const value = product()
    const validated = validateProductDto(value, currencies, productLimits)
    expect(validated).toEqual(value)
    expect(validated.sellerPrice).not.toBe(value.sellerPrice)
    expect(validateProductDto(product({
      storeName:null, productName:null, sellerPrice:null, color:null, size:null, comment:null
    }), currencies, productLimits).sellerPrice).toBeNull()
  })

  it.each([
    null,
    {},
    product({ quantity:0 }),
    product({ quantity:1.5 }),
    product({ productName:'x'.repeat(501) }),
    product({ productName:' Товар ' }),
    product({ sellerPrice:{} }),
    product({ sellerPrice:{ amount:0, currency:840 } }),
    product({ sellerPrice:{ amount:1, currency:999 } }),
    product({ sellerPrice:{ amount:1, currency:978 } }),
    product({ sellerPrice:{ amount:1.234, currency:840 } }),
    product({ sellerPrice:{ amount:100000000, currency:840 } })
  ])('rejects malformed product DTO %#', value => {
    protocolFailure(() => validateProductDto(value, currencies, productLimits))
  })

  it('accepts a Core-owned non-USD preview price without treating it as a USD submission', () => {
    expect(validatePreviewProductDto(product({ sellerPrice:{ amount:16.5, currency:978 } }), currencies, productLimits))
      .toMatchObject({ sellerPrice:{ amount:16.5, currency:978 } })
  })

  it('maps recognized and empty previews into form input strings', () => {
    expect(previewPrefill(null, productLimits)).toEqual({
      storeName:'', productName:'', sellerPrice:'', quantity:'1', color:'', size:'', comment:''
    })
    expect(previewPrefill(product({ sellerPrice:{ amount:16.5, currency:840 } }), productLimits))
      .toMatchObject({ productName:'Товар', sellerPrice:'16,50', quantity:'2' })
    expect(previewPrefill(product({ sellerPrice:{ amount:16.5, currency:978 } }), productLimits).sellerPrice)
      .toBe('')
  })

  it('produces all local field errors and uses the server-provided value message', () => {
    const empty = productFormErrors({
      storeName:'x'.repeat(201), productName:'', sellerPrice:'', quantity:'',
      color:'x'.repeat(201), size:'x'.repeat(201), comment:'x'.repeat(2001)
    }, productLimits)
    expect(Object.keys(empty).sort()).toEqual(['color', 'comment', 'productName', 'quantity', 'sellerPrice', 'size', 'storeName'].sort())
    expect(productFormErrors({
      storeName:'', productName:'Товар', sellerPrice:'10', quantity:'1.5', color:'', size:'', comment:''
    }, productLimits).quantity).toEqual(['Количество должно быть целым числом.'])
    expect(productFormErrors({
      storeName:'', productName:'Товар', sellerPrice:'10', quantity:'0', color:'', size:'', comment:''
    }, productLimits).quantity).toEqual(['Количество должно быть больше нуля.'])
    expect(productFormErrors({
      storeName:'', productName:'Товар', sellerPrice:'10', quantity:'-1', color:'', size:'', comment:''
    }, productLimits).quantity).toEqual(['Количество не может быть отрицательным.'])
    expect(productFormErrors({
      storeName:'', productName:'Товар', sellerPrice:'10', quantity:'5', color:'', size:'', comment:''
    }, productLimits).quantity).toEqual(['Такое количество товара может быть признано коммерческой партией и запрещено к ввозу'])
    expect(productFormErrors({
      storeName:'', productName:'x'.repeat(501), sellerPrice:'10', quantity:'1', color:'', size:'', comment:''
    }, productLimits).productName).toEqual(['Не более 500 символов.'])
    expect(productFormErrors({
      storeName:'', productName:'Товар', sellerPrice:'300', quantity:'4', color:'', size:'', comment:''
    }, productLimits).sellerPrice).toEqual([productLimits.valueLimit.exceededMessage])
    expect(productFormErrors({
      storeName:'', productName:'Товар', sellerPrice:'-1', quantity:'1', color:'', size:'', comment:''
    }, productLimits).sellerPrice[0]).toContain('положительную цену')
  })

  it('builds the trimmed Core payload with a numeric price', () => {
    expect(productPayload({
      sourceUrl:'https://shop.example.com/item', storeName:' Amazon ', productName:' Термос ',
      sellerPrice:'16,50', quantity:'2', color:' blue ', size:' ', comment:' подарок '
    }, productLimits)).toEqual({
      sourceUrl:'https://shop.example.com/item',
      product:{
        storeName:'Amazon', productName:'Термос', sellerPrice:{ amount:16.5, currency:840 },
        color:'blue', size:null
      },
      quantity:2,
      comment:'подарок'
    })
  })
})
