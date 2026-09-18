// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application
import { describe, expect, it, vi } from 'vitest'
import { createPublicStores, storeSort, validatePublicStores } from '../src/stores/publicStores.js'

export const store = (id = 1) => ({ id, name:`Магазин ${id}`, description:'Описание магазина', officialUrl:'https://example.com/', logoUrl:`/api/v1/stores/${id}/logo?v=${'a'.repeat(64)}` })
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve = a; reject = b }); return { promise, resolve, reject } }

describe('public stores boundary', () => {
  it.each([undefined, '', 'bad', ['name-asc'], null])('normalizes invalid sort %s', value => expect(storeSort(value)).toBe('recommended'))
  it.each(['recommended','name-asc','name-desc'])('preserves sort %s', value => expect(storeSort(value)).toBe(value))
  it('preserves server order and projects public fields', () => {
    const items = [{ ...store(2), name:'Zebra', secret:'ignored' }, { ...store(1), name:'Альфа' }]
    expect(validatePublicStores({ items })).toEqual([store(2), store(1)].map((item, i) => ({ ...item, name:items[i].name })))
    expect(validatePublicStores({ items:[] }, true)).toEqual([])
    expect(validatePublicStores({ items:Array.from({ length:6 }, (_, i) => store(i+1)) }, true)).toHaveLength(6)
  })
  it.each([
    null, {}, { items:{} }, { items:[null] }, { items:[store(),store()] },
    ...[0,-1,1.2,2147483648,'1'].map(id => ({ items:[{ ...store(), id }] })),
    ...[null,'',' ', 'x'.repeat(201)].map(name => ({ items:[{ ...store(), name }] })),
    ...[null,'',' ', 'x'.repeat(161)].map(description => ({ items:[{ ...store(), description }] })),
    ...[null,'javascript:alert(1)','//example.com','https://x.com/ a','https://x.com\\bad','https://user:pass@x.com','http://[','x'.repeat(2049)].map(officialUrl => ({ items:[{ ...store(), officialUrl }] })),
    ...[null,'https://other.com/logo','/api/v1/stores/2/logo?v='+'a'.repeat(64),'/api/v1/stores/1/logo'].map(logoUrl => ({ items:[{ ...store(), logoUrl }] }))
  ])('rejects malformed or unsafe DTO %j', value => expect(() => validatePublicStores(value)).toThrow())
  it('rejects over-capacity featured responses without trimming or selecting locally', () => {
    expect(() => validatePublicStores({ items:Array.from({ length:7 }, (_,i) => store(i+1)) }, true)).toThrow()
  })
  it('accepts internationalized websites and explicit HTTP', () => {
    for (const officialUrl of ['https://магазин.рф/', 'http://example.com/']) expect(validatePublicStores({ items:[{ ...store(), officialUrl }] })[0].officialUrl).toBe(officialUrl)
  })
})

describe('independent public catalogue state', () => {
  it('keeps full availability independent of an empty featured selection', async () => {
    const client = { request:vi.fn(async path => ({ items:path.includes('featured') ? [] : [store()] })) }
    const catalogue = createPublicStores(client)
    expect(catalogue.available.value).toBeNull()
    await catalogue.refresh('recommended', true)
    expect(catalogue.hasStores.value).toBe(true)
    expect(catalogue.featured.items).toEqual([])
    expect(client.request.mock.calls.map(([path]) => path)).toEqual(['/api/v1/stores?sort=recommended','/api/v1/stores/featured'])
    client.request.mockResolvedValue({ items:[] })
    await catalogue.refresh()
    expect(catalogue.available.value).toBe(false)
  })
  it('deduplicates reads and accepts only the newest sorting response', async () => {
    const old = deferred(), fresh = deferred()
    const client = { request:vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise) }
    const catalogue = createPublicStores(client)
    const first = catalogue.refresh(), shared = catalogue.refresh()
    expect(client.request).toHaveBeenCalledTimes(1)
    const next = catalogue.refresh('name-desc')
    fresh.resolve({ items:[store(2),store()] }); await next
    old.resolve({ items:[] }); await Promise.all([first,shared])
    expect(catalogue.full.items.map(item => item.id)).toEqual([2,1])
    expect(catalogue.full.sort).toBe('name-desc')
    expect(catalogue.hasStores.value).toBe(true)
  })
  it('keeps recoverable failures distinct from confirmed empty and retries', async () => {
    const client = { request:vi.fn().mockRejectedValue(new Error('private network data')) }
    const catalogue = createPublicStores(client)
    const result = await catalogue.refresh('recommended', true)
    expect(result.every(item => item.status === 'rejected')).toBe(true)
    expect(catalogue.available.value).toBeNull()
    expect(catalogue.full.problem).toBeTruthy()
    expect(catalogue.featured.problem).toBeTruthy()
    expect(catalogue.full.loading).toBe(false)
    client.request.mockResolvedValue({ items:[store()] })
    await catalogue.refresh('recommended', true)
    expect(catalogue.full.problem).toBeNull()
    expect(catalogue.featured.items).toHaveLength(1)
    client.request.mockRejectedValue(new Error('failure'))
    await catalogue.refresh()
    expect(catalogue.hasStores.value).toBe(true)
  })
  it('discards failures and successes after leaving the owning shell', async () => {
    const full = deferred(), featured = deferred()
    const catalogue = createPublicStores({ request:vi.fn().mockReturnValueOnce(full.promise).mockReturnValueOnce(featured.promise) })
    const operation = catalogue.refresh('recommended', true)
    catalogue.invalidate()
    full.reject(new Error('late')); featured.resolve({ items:[store()] })
    await operation
    expect(catalogue.full.problem).toBeNull()
    expect(catalogue.featured.items).toBeNull()
    expect(catalogue.available.value).toBeNull()
  })
  it('updates logo digests on revalidation and clears old sort rows immediately', async () => {
    const client = { request:vi.fn().mockResolvedValue({ items:[store()] }) }
    const catalogue = createPublicStores(client)
    await catalogue.refresh()
    client.request.mockResolvedValue({ items:[{ ...store(), logoUrl:`/api/v1/stores/1/logo?v=${'b'.repeat(64)}` }] })
    const next = catalogue.refresh('name-asc')
    expect(catalogue.full.items).toBeNull()
    await next
    expect(catalogue.full.items[0].logoUrl).toContain('b'.repeat(64))
  })
})
