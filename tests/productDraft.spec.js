// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  PRODUCT_DRAFT_STORAGE_KEY,
  resetProductDraftForTests,
  useProductDraft
} from '../src/stores/productDraft.js'

const FIRST_KEY = '11111111-1111-4111-8111-111111111111'
const SECOND_KEY = '22222222-2222-4222-8222-222222222222'

describe('same-tab product draft', () => {
  beforeEach(() => {
    globalThis.sessionStorage.clear()
    resetProductDraftForTests()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('persists and restores a versioned canonical draft', () => {
    const drafts = useProductDraft()
    expect(drafts.start(' shop.example.com/item ')).toBe(true)
    drafts.update({ quantity:'3', comment:'цвет синий' })

    expect(JSON.parse(globalThis.sessionStorage.getItem(PRODUCT_DRAFT_STORAGE_KEY))).toMatchObject({
      version:1,
      sourceUrl:'https://shop.example.com/item',
      quantity:'3',
      comment:'цвет синий',
      idempotencyKey:null,
      resumeMode:'none',
      boundCustomerId:null
    })

    resetProductDraftForTests()
    globalThis.sessionStorage.setItem(PRODUCT_DRAFT_STORAGE_KEY, JSON.stringify({
      version:1,
      sourceUrl:'https://shop.example.com/item',
      quantity:'3',
      comment:'цвет синий',
      idempotencyKey:null,
      resumeMode:'none',
      boundCustomerId:null
    }))
    expect(useProductDraft().draft.value.sourceUrl).toBe('https://shop.example.com/item')
  })

  it('drops unknown stored properties instead of persisting them again', () => {
    globalThis.sessionStorage.setItem(PRODUCT_DRAFT_STORAGE_KEY, JSON.stringify({
      version:1,
      sourceUrl:'https://shop.example.com/item',
      quantity:'1',
      comment:'',
      idempotencyKey:null,
      resumeMode:'none',
      boundCustomerId:null,
      unexpectedPersonalData:'must not survive'
    }))

    const drafts = useProductDraft()
    expect(drafts.draft.value).not.toHaveProperty('unexpectedPersonalData')
    drafts.update({ quantity:'2' })
    expect(JSON.parse(globalThis.sessionStorage.getItem(PRODUCT_DRAFT_STORAGE_KEY)))
      .not.toHaveProperty('unexpectedPersonalData')
  })

  it.each([
    '{',
    '{}',
    JSON.stringify({ version:2 }),
    JSON.stringify({ version:1, sourceUrl:'ftp://bad', quantity:'1', comment:'', idempotencyKey:null, resumeMode:'none', boundCustomerId:null }),
    JSON.stringify({ version:1, sourceUrl:'https://shop.example.com', quantity:'1', comment:'', idempotencyKey:'bad', resumeMode:'none', boundCustomerId:null }),
    JSON.stringify({ version:1, sourceUrl:'https://shop.example.com', quantity:'1', comment:'', idempotencyKey:null, resumeMode:'consent', boundCustomerId:null })
  ])('discards corrupted storage %#', serialized => {
    globalThis.sessionStorage.setItem(PRODUCT_DRAFT_STORAGE_KEY, serialized)
    expect(useProductDraft().draft.value).toBeNull()
    expect(globalThis.sessionStorage.getItem(PRODUCT_DRAFT_STORAGE_KEY)).toBeNull()
  })

  it('retains one key for equivalent values and changes it for effective payload changes', () => {
    const randomUUID = vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce(FIRST_KEY)
      .mockReturnValueOnce(SECOND_KEY)
    const drafts = useProductDraft()
    drafts.start('shop.example.com/item')
    expect(drafts.ensureIdempotencyKey()).toBe(FIRST_KEY)
    expect(drafts.ensureIdempotencyKey()).toBe(FIRST_KEY)

    drafts.update({ sourceUrl:'https://shop.example.com/item', quantity:'01', comment:'  ' })
    expect(drafts.draft.value.idempotencyKey).toBe(FIRST_KEY)
    drafts.update({ comment:'blue' })
    expect(drafts.draft.value.idempotencyKey).toBeNull()
    expect(drafts.ensureIdempotencyKey()).toBe(SECOND_KEY)
    expect(randomUUID).toHaveBeenCalledTimes(2)
  })

  it('binds consent resume to one customer and clears resume on editing or cancellation', () => {
    const drafts = useProductDraft()
    drafts.start('shop.example.com/item')
    drafts.markAuthenticationResume()
    expect(drafts.draft.value).toMatchObject({ resumeMode:'authentication', boundCustomerId:null })
    drafts.markConsentResume(7)
    expect(drafts.draft.value).toMatchObject({ resumeMode:'consent', boundCustomerId:7 })
    drafts.update({ quantity:'2' })
    expect(drafts.draft.value).toMatchObject({ resumeMode:'none', boundCustomerId:null })
    drafts.markConsentResume(0)
    expect(drafts.draft.value.resumeMode).toBe('none')
    drafts.markAuthenticationResume()
    drafts.clearResume()
    expect(drafts.draft.value.resumeMode).toBe('none')
    drafts.clear()
    expect(drafts.draft.value).toBeNull()
    expect(drafts.start('ftp://shop.example.com/item')).toBe(false)
    expect(drafts.update({ quantity:'2' })).toBe(false)
    expect(drafts.setCanonicalSourceUrl('javascript:alert(1)')).toBe(false)
    expect(drafts.ensureIdempotencyKey()).toBeNull()
    drafts.markAuthenticationResume()
    drafts.markConsentResume(7)
    drafts.clearResume()
    expect(drafts.draft.value).toBeNull()
  })

  it('rejects an invalid draft update without replacing the current draft', () => {
    const drafts = useProductDraft()
    drafts.start('shop.example.com/item')
    expect(drafts.update({ comment:'x'.repeat(2001) })).toBe(false)
    expect(drafts.draft.value.comment).toBe('')
  })

  it('keeps an in-memory draft when session storage is unavailable', () => {
    vi.stubGlobal('sessionStorage', {
      getItem:vi.fn(() => { throw new Error('blocked') }),
      setItem:vi.fn(() => { throw new Error('blocked') }),
      removeItem:vi.fn(() => { throw new Error('blocked') })
    })
    resetProductDraftForTests()
    const drafts = useProductDraft()
    expect(drafts.start('shop.example.com/item')).toBe(true)
    expect(drafts.draft.value.sourceUrl).toBe('https://shop.example.com/item')
  })
})
