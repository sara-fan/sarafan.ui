// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PRODUCT_DRAFT_STORAGE_KEY, resetProductDraftForTests, useProductDraft } from '../src/stores/productDraft.js'

const FIRST_KEY = '11111111-1111-4111-8111-111111111111'
const SECOND_KEY = '22222222-2222-4222-8222-222222222222'
const LEGACY_KEY = 'sarafan.product-draft.v1'
const prefill = {
  storeName:'Amazon', productName:'Термос', sellerPrice:'40,00', quantity:'2',
  color:'cherry', size:'1 л', comment:'Распознано'
}

describe('same-tab product draft', () => {
  beforeEach(() => {
    globalThis.sessionStorage.clear()
    resetProductDraftForTests()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('persists, restores, and allowlists a complete v2 draft', () => {
    const drafts = useProductDraft()
    expect(drafts.start(' shop.example.com/item ')).toBe(true)
    expect(drafts.update({ productName:'Термос', quantity:'3', comment:'цвет синий' })).toBe(true)
    const stored = JSON.parse(globalThis.sessionStorage.getItem(PRODUCT_DRAFT_STORAGE_KEY))
    expect(stored).toMatchObject({
      version:2, sourceUrl:'https://shop.example.com/item', productName:'Термос', quantity:'3',
      comment:'цвет синий', previewApplied:false, previewOutcome:null,
      dirtyFields:['productName', 'quantity', 'comment'], idempotencyKey:null,
      resumeMode:'none', boundCustomerId:null
    })

    resetProductDraftForTests()
    globalThis.sessionStorage.setItem(PRODUCT_DRAFT_STORAGE_KEY, JSON.stringify({
      ...stored, unexpectedPersonalData:'must not survive'
    }))
    const restored = useProductDraft()
    expect(restored.draft.value).not.toHaveProperty('unexpectedPersonalData')
    restored.update({ color:'синий' })
    expect(JSON.parse(globalThis.sessionStorage.getItem(PRODUCT_DRAFT_STORAGE_KEY)))
      .not.toHaveProperty('unexpectedPersonalData')
  })

  it('migrates legacy URL, quantity, and comment without submitting or reusing a key', () => {
    globalThis.sessionStorage.setItem(LEGACY_KEY, JSON.stringify({
      version:1, sourceUrl:'shop.example.com/item', quantity:'4', comment:'Сохранить',
      idempotencyKey:FIRST_KEY, resumeMode:'consent', boundCustomerId:7
    }))
    const value = useProductDraft().draft.value
    expect(value).toMatchObject({
      version:2, sourceUrl:'https://shop.example.com/item', quantity:'4', comment:'Сохранить',
      dirtyFields:['quantity', 'comment'], previewApplied:false, idempotencyKey:null,
      resumeMode:'none', boundCustomerId:null
    })
    expect(globalThis.sessionStorage.getItem(LEGACY_KEY)).toBeNull()
    expect(globalThis.sessionStorage.getItem(PRODUCT_DRAFT_STORAGE_KEY)).not.toBeNull()
  })

  it('retains the legacy draft when its replacement cannot be saved', () => {
    const values = new Map([[LEGACY_KEY, JSON.stringify({
      version:1, sourceUrl:'shop.example.com/item', quantity:'4', comment:'Сохранить'
    })]])
    const removeItem = vi.fn(key => { values.delete(key) })
    vi.stubGlobal('sessionStorage', {
      getItem:key => values.get(key) ?? null,
      setItem:key => {
        if (key === PRODUCT_DRAFT_STORAGE_KEY) throw new Error('quota exceeded')
      },
      removeItem
    })

    expect(useProductDraft().draft.value).toMatchObject({
      version:2, sourceUrl:'https://shop.example.com/item', quantity:'4', comment:'Сохранить'
    })
    expect(values.get(LEGACY_KEY)).not.toBeNull()
    expect(removeItem).not.toHaveBeenCalledWith(LEGACY_KEY)
  })

  it('applies preview values only once and preserves every edited field', () => {
    const drafts = useProductDraft()
    drafts.start('shop.example.com/item')
    drafts.update({ productName:'Моё название', comment:'Мой комментарий' })
    expect(drafts.applyPreview('https://shop.example.com/canonical', 'recognized', prefill)).toBe(true)
    expect(drafts.draft.value).toMatchObject({
      sourceUrl:'https://shop.example.com/canonical', storeName:'Amazon', productName:'Моё название',
      sellerPrice:'40,00', quantity:'2', comment:'Мой комментарий',
      previewApplied:true, previewOutcome:'recognized'
    })
    expect(drafts.applyPreview('https://shop.example.com/canonical', 'manual_review', {
      ...prefill, storeName:'Другой', quantity:'4'
    })).toBe(true)
    expect(drafts.draft.value).toMatchObject({ storeName:'Amazon', quantity:'2', previewOutcome:'manual_review' })
  })

  it('retains one key for normalized equivalents and changes it for effective payload changes', () => {
    const randomUUID = vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce(FIRST_KEY)
      .mockReturnValueOnce(SECOND_KEY)
    const drafts = useProductDraft()
    drafts.start('shop.example.com/item')
    drafts.applyPreview('https://shop.example.com/item', 'recognized', prefill)
    expect(drafts.ensureIdempotencyKey()).toBe(FIRST_KEY)
    expect(drafts.ensureIdempotencyKey()).toBe(FIRST_KEY)
    drafts.update({ sellerPrice:'40.0', quantity:'02', comment:' Распознано ' })
    expect(drafts.draft.value.idempotencyKey).toBe(FIRST_KEY)
    drafts.update({ color:'blue' })
    expect(drafts.draft.value.idempotencyKey).toBeNull()
    expect(drafts.ensureIdempotencyKey()).toBe(SECOND_KEY)
    expect(randomUUID).toHaveBeenCalledTimes(2)
  })

  it('binds consent resume to one customer and clears resume after an effective edit', () => {
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
    expect(globalThis.sessionStorage.getItem(PRODUCT_DRAFT_STORAGE_KEY)).toBeNull()
  })

  it.each([
    '{', '{}', JSON.stringify({ version:1 }), JSON.stringify({ version:2 }),
    JSON.stringify({ version:2, sourceUrl:'ftp://bad' })
  ])('discards corrupted current storage %#', serialized => {
    globalThis.sessionStorage.setItem(PRODUCT_DRAFT_STORAGE_KEY, serialized)
    expect(useProductDraft().draft.value).toBeNull()
    expect(globalThis.sessionStorage.getItem(PRODUCT_DRAFT_STORAGE_KEY)).toBeNull()
  })

  it.each([
    { version:1, sourceUrl:'ftp://bad', quantity:'1', comment:'' },
    { version:1, sourceUrl:'https://shop.example.com', quantity:'1'.repeat(21), comment:'' },
    { version:1, sourceUrl:'https://shop.example.com', quantity:'1', comment:'x'.repeat(2001) }
  ])('discards a malformed legacy draft %#', value => {
    globalThis.sessionStorage.setItem(LEGACY_KEY, JSON.stringify(value))
    expect(useProductDraft().draft.value).toBeNull()
    expect(globalThis.sessionStorage.getItem(LEGACY_KEY)).toBeNull()
  })

  it('rejects invalid operations without replacing the current draft', () => {
    const drafts = useProductDraft()
    expect(drafts.start('ftp://shop.example.com/item')).toBe(false)
    expect(drafts.update({ quantity:'2' })).toBe(false)
    expect(drafts.applyPreview('javascript:alert(1)', 'manual_review', prefill)).toBe(false)
    expect(drafts.ensureIdempotencyKey()).toBeNull()
    drafts.markAuthenticationResume()
    drafts.markConsentResume(7)
    drafts.clearResume()
    drafts.start('shop.example.com/item')
    expect(drafts.update({ comment:'x'.repeat(10001) })).toBe(false)
    expect(drafts.applyPreview('https://shop.example.com/item', 'unknown', prefill)).toBe(false)
    expect(drafts.applyPreview('https://shop.example.com/item', 'recognized', { ...prefill, size:7 })).toBe(false)
    expect(drafts.draft.value.comment).toBe('')
  })

  it('retains a long canonical URL through updates and restoration', () => {
    const sourceUrl = 'https://shop.example.com/' + 'a'.repeat(2050)
    const drafts = useProductDraft()
    expect(drafts.start(sourceUrl)).toBe(true)
    expect(drafts.update({ quantity:'2' })).toBe(true)
    const serialized = globalThis.sessionStorage.getItem(PRODUCT_DRAFT_STORAGE_KEY)
    resetProductDraftForTests()
    globalThis.sessionStorage.setItem(PRODUCT_DRAFT_STORAGE_KEY, serialized)
    expect(useProductDraft().draft.value).toMatchObject({ sourceUrl, quantity:'2' })
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
