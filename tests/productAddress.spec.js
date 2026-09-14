// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { describe, expect, it } from 'vitest'

import { normalizeProductAddress } from '../src/productAddress.js'

describe('product address normalization', () => {
  it.each([
    [' shop.example/product ', 'https://shop.example/product'],
    ['//shop.example/product', 'https://shop.example/product'],
    ['http://shop.example/product', 'http://shop.example/product'],
    ['HTTPS://SHOP.Example/Product?Color=Blue#Size', 'https://shop.example/Product?Color=Blue#Size'],
    ['shop.example:8443/product', 'https://shop.example:8443/product']
  ])('normalizes %s', (input, expected) => {
    expect(normalizeProductAddress(input)).toBe(expected)
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
    'ftp://shop.example/product',
    'file:///tmp/product',
    'javascript:alert(1)'
  ])('rejects an invalid address %#', input => {
    expect(normalizeProductAddress(input)).toBeNull()
  })

  it('rejects a normalized URL longer than 2048 characters', () => {
    expect(normalizeProductAddress(`shop.example/${'a'.repeat(2040)}`)).toBeNull()
  })
})
