// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { describe, expect, it } from 'vitest'

import { normalizeProductAddress } from '../src/productAddress.js'

const productSourceUrlOps = {
  maximumLength:2048,
  topLevelDomains:['COM', 'XN--P1AI']
}

describe('product address normalization', () => {
  it.each([
    [' shop.example.com/product ', 'https://shop.example.com/product'],
    ['//shop.example.com/product', 'https://shop.example.com/product'],
    ['http://shop.example.com/product', 'http://shop.example.com/product'],
    ['HTTPS://SHOP.Example.COM/Product?Color=Blue#Size', 'https://shop.example.com/Product?Color=Blue#Size'],
    ['shop.example.com:8443/product', 'https://shop.example.com:8443/product'],
    ['https://shop.example.com./product', 'https://shop.example.com./product'],
    ['магазин.рф/товар', 'https://xn--80aairftm.xn--p1ai/%D1%82%D0%BE%D0%B2%D0%B0%D1%80']
  ])('normalizes %s', (input, expected) => {
    expect(normalizeProductAddress(input, productSourceUrlOps)).toBe(expected)
  })

  it.each([
    null,
    undefined,
    '',
    '   ',
    'https://',
    'https:///path',
    '[invalid',
    'shop example/product',
    'ftp://shop.example.com/product',
    'file:///tmp/product',
    'javascript:alert(1)',
    'ftp:21',
    'javascript:123',
    'xxxx',
    'http://xxxx',
    'shop.invalid/product',
    'https://127.0.0.1/product',
    'https://[::1]/product',
    'https://bad_label.com/product',
    'https://-shop.com/product',
    'https://shop-.com/product',
    'https://shop..com/product'
  ])('rejects an invalid address %#', input => {
    expect(normalizeProductAddress(input, productSourceUrlOps)).toBeNull()
  })

  it('uses the Core Ops catalogue instead of compiling suffixes into the UI', () => {
    expect(normalizeProductAddress('shop.invalid/product')).toBe('https://shop.invalid/product')
    expect(normalizeProductAddress('shop.invalid/product', productSourceUrlOps)).toBeNull()
  })

  it('rejects a normalized URL longer than 2048 characters', () => {
    expect(normalizeProductAddress(`shop.example.com/${'a'.repeat(2040)}`, productSourceUrlOps)).toBeNull()
  })
})
