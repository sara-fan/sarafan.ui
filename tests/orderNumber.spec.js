// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { expect, it } from 'vitest'
import { isOrderDetailPath, isOrderNumber } from '../src/orderNumber.js'

it.each([null, 7, '', ' ', 'x'.repeat(65), 'ops', 'OPS', 'preview', 'Preview', '.', '..'])(
  'rejects invalid order number %s', value => expect(isOrderNumber(value)).toBe(false)
)

it.each(['01234567-3', 'Заказ / 3', 'ops-1', 'preview-1', 'x'.repeat(64), '%6f%70%73'])(
  'preserves opaque order number %s through one encoding', value => {
    expect(isOrderNumber(value)).toBe(true)
    expect(isOrderDetailPath(`/api/v1/orders/${encodeURIComponent(value)}`)).toBe(true)
  }
)

it.each(['ops', 'OPS', '%6f%70%73', 'preview', '%70review', '.', '%2e%2e', '%FF', '%20', 'x'.repeat(65), 'a/b', 'a?b', 'a#b'])(
  'rejects invalid detail segment %s', value => {
    expect(isOrderDetailPath(`/api/v1/orders/${value}`)).toBe(false)
  }
)
