// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { describe, expect, it } from 'vitest'

import { isIsoDate, isRfc3339DateTime } from '../src/api/validation.js'

describe('Core date validation', () => {
  it.each([
    '2026-09-10T12:00:00Z',
    '2024-02-29T23:59:59.1234567+03:00',
    '2026-09-10T00:00:00-14:00'
  ])('accepts RFC 3339 timestamp %s', value => {
    expect(isRfc3339DateTime(value)).toBe(true)
  })

  it.each([
    null,
    '2026-09-10',
    '2026-02-30T12:00:00Z',
    '2026-09-10T24:00:00Z',
    '2026-09-10T12:60:00Z',
    '2026-09-10T12:00:60Z',
    '2026-09-10T12:00:00+14:01',
    '2026-09-10T12:00:00+15:00',
    '2026-09-10T12:00:00+03:60'
  ])('rejects non-RFC or impossible timestamp %j', value => {
    expect(isRfc3339DateTime(value)).toBe(false)
  })

  it.each([
    ['2026-09-10', true],
    ['2024-02-29', true],
    ['2026-02-29', false],
    ['2026-02-30', false],
    ['0000-01-01', false],
    ['2026-13-01', false],
    ['2026-00-01', false],
    ['2026-01-00', false],
    ['2026-09-10T00:00:00Z', false],
    [null, false]
  ])('validates Core date-only value %j', (value, expected) => {
    expect(isIsoDate(value)).toBe(expected)
  })
})
