// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application
import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createConsentStore } from '../src/stores/consents.js'
import { LEGAL_DOCUMENT_KIND, documentNodes, isDocumentId, moscowTime, downloadBytes } from '../src/consentFormatting.js'

const id = '11111111-1111-1111-1111-111111111111'
const now = '2026-09-07T12:00:00Z'
const document = {
  id,
  kind:LEGAL_DOCUMENT_KIND.COOKIE_CONSENT,
  locale:'ru',
  title:'Согласие на использование куки',
  displayVersion:'1',
  html:'<p>Текст</p>',
  sourceHash:'b'.repeat(64),
  contentHash:'a'.repeat(64),
  rendererVersion:'sarafan-safe-markdown-1/markdig-1.3.2',
  cookieCategories:[0],
  effectiveAt:'2026-09-06T21:00:00Z',
  createdAt:'2026-09-05T12:00:00Z',
  createdBy:null,
  effectiveLocalDate:'2026-09-07',
  effectiveTimeZone:'Europe/Moscow',
  canDelete:null
}
const ops = { kinds:[
  { value:0, name:'Согласие на использование куки', routeAlias:'cookie-consent' },
  { value:1, name:'Согласие на обработку персональных данных', routeAlias:'personal-data-consent' },
  { value:2, name:'Пользовательское соглашение', routeAlias:'user-agreement' },
  { value:3, name:'Правила заказа товаров', routeAlias:'order-rules' },
  { value:4, name:'Политика обработки персональных данных', routeAlias:'privacy-policy' }
] , cookieCategories:[{ value:0, name:'Обязательные', required:true }] }
const receipt = { status:'current', categories:[0], documentId:id, serverNow:now, expiresAt:'2026-09-07T13:00:00Z', nextChangeAt:null }
const history = { customerId:7, statuses:[], history:[], withdrawalRequest:null }
let session, store
beforeEach(async () => {
  vi.useFakeTimers()
  session = { customer:ref(null), consentRequest:vi.fn() }
  store = createConsentStore(session)
  session.consentRequest.mockResolvedValueOnce(ops)
  await store.loadOps()
  session.consentRequest.mockReset()
})
afterEach(() => { store.dispose(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('consent state and request contracts', () => {
  it('loads backend kind metadata, derives lookups, and retries without a compiled fallback', async () => {
    const localSession = { customer:ref(null), consentRequest:vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(ops) }
    const local = createConsentStore(localSession)
    await expect(local.loadOps()).rejects.toBeDefined()
    expect(local.ops.value).toBeNull()
    expect(local.opsProblem.value).toBeTruthy()
    await expect(local.loadOps()).resolves.toEqual(ops)
    expect(local.kindByAlias('privacy-policy')).toBe(LEGAL_DOCUMENT_KIND.PRIVACY_POLICY)
    expect(local.kindName(LEGAL_DOCUMENT_KIND.USER_AGREEMENT)).toBe('Пользовательское соглашение')
    expect(local.routeAlias(LEGAL_DOCUMENT_KIND.COOKIE_CONSENT)).toBe('cookie-consent')
    expect(local.cookieCategoryName(0)).toBe('Обязательные')
    expect(local.requiredCookieCategories()).toEqual([0])
    expect(local.kindByAlias('unknown')).toBeUndefined()
    local.dispose()
  })
  it.each([null, {}, { kinds:[], cookieCategories:ops.cookieCategories }, { kinds:[{ value:'0', name:'Куки', routeAlias:'cookie-consent' }], cookieCategories:ops.cookieCategories },
    { kinds:[{ value:0, name:'', routeAlias:'cookie-consent' }], cookieCategories:ops.cookieCategories }, { kinds:[{ value:0, name:'Куки', routeAlias:'Bad alias' }], cookieCategories:ops.cookieCategories },
    { kinds:[{ value:0, name:'One', routeAlias:'one' }, { value:0, name:'Two', routeAlias:'two' }], cookieCategories:ops.cookieCategories },
    { kinds:[{ value:0, name:'One', routeAlias:'same' }, { value:1, name:'Two', routeAlias:'same' }], cookieCategories:ops.cookieCategories },
    { ...ops, cookieCategories:[] }, { ...ops, cookieCategories:[{ value:'0', name:'Обязательные', required:true }] },
    { ...ops, cookieCategories:[{ value:0, name:'', required:true }] }, { ...ops, cookieCategories:[{ value:0, name:'Обязательные', required:'yes' }] },
    { ...ops, cookieCategories:[{ value:0, name:'Первая', required:true }, { value:0, name:'Вторая', required:false }] },
    { ...ops, cookieCategories:[{ value:0, name:'Необязательные', required:false }] }])('rejects malformed legal-document ops %j', async value => {
    const local = createConsentStore({ customer:ref(null), consentRequest:vi.fn().mockResolvedValue(value) })
    await expect(local.loadOps()).rejects.toMatchObject({ code:'ui_protocol_error' })
    expect(local.ops.value).toBeNull()
    local.dispose()
  })
  it('rechecks personal consent at activation, before writes, and fails closed on refresh errors', async () => {
    session.customer.value = { id:7 }
    const granted = { ...history, serverNow:now, statuses:[{ kind:LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT, status:'current' }], nextChangeAt:'2026-09-07T12:00:01Z' }
    session.consentRequest.mockResolvedValue(granted)
    await store.requirePersonalData()
    session.consentRequest.mockResolvedValue({ ...history, statuses:[{ kind:LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT, status:'renewal-required' }] })
    await vi.advanceTimersByTimeAsync(1000)
    expect(store.mine.value.statuses[0].status).toBe('renewal-required')
    await expect(store.requirePersonalData()).rejects.toMatchObject({ code:'ui_invalid_input' })
    session.consentRequest.mockResolvedValue({ ...granted, nextChangeAt:'2027-01-01T12:00:00Z' })
    await store.loadMine(); await vi.advanceTimersByTimeAsync(2147483647)
    expect(store.mine.value.statuses[0].status).toBe('current')
    session.consentRequest.mockResolvedValue(granted); await store.loadMine()
    const error = new Error('private')
    session.consentRequest.mockRejectedValue(error)
    await vi.advanceTimersByTimeAsync(1000)
    expect(store.mine.value).toBeNull()
    expect(store.personalProblem.value).toBe(error)
    session.consentRequest.mockResolvedValue({ ...granted, nextChangeAt:'invalid' })
    await expect(store.loadMine()).rejects.toMatchObject({ code:'ui_protocol_error' })
    session.customer.value = null
    await expect(store.requirePersonalData()).rejects.toMatchObject({ code:'ui_invalid_input' })
  })
  it('loads only supported public documents and exact immutable source', async () => {
    session.consentRequest.mockResolvedValue({ serverNow:now, nextChangeAt:null, document })
    expect((await store.current(LEGAL_DOCUMENT_KIND.COOKIE_CONSENT)).document.id).toBe(id)
    await expect(store.current(99)).rejects.toMatchObject({ code:'ui_invalid_input' })
    session.consentRequest.mockResolvedValue(null)
    await expect(store.current(LEGAL_DOCUMENT_KIND.COOKIE_CONSENT)).rejects.toMatchObject({ code:'ui_protocol_error' })
    session.consentRequest.mockResolvedValue({ serverNow:'invalid', nextChangeAt:null, document })
    await expect(store.current(LEGAL_DOCUMENT_KIND.COOKIE_CONSENT)).rejects.toBeDefined()
    session.consentRequest.mockResolvedValue({ serverNow:now, nextChangeAt:null, document:{ id:'bad' } })
    await expect(store.current(LEGAL_DOCUMENT_KIND.COOKIE_CONSENT)).rejects.toBeDefined()
    session.consentRequest.mockResolvedValue({ serverNow:now, nextChangeAt:null, document:null })
    expect((await store.current(LEGAL_DOCUMENT_KIND.PRIVACY_POLICY)).document).toBeNull()
    await expect(store.read('bad')).rejects.toBeDefined()
    await expect(store.source('bad')).rejects.toBeDefined()
    session.consentRequest.mockResolvedValue(document)
    expect(await store.read(id)).toEqual(document)
    await store.source(id)
    expect(session.consentRequest).toHaveBeenLastCalledWith(`/api/v1/legal/documents/${id}/source`, expect.objectContaining({ headers:{ Accept:'text/markdown, application/problem+json' } }), false, 'blob')
  })
  it.each([
    ['kind', '0'],
    ['kind', -1],
    ['kind', 99],
    ['locale', ''],
    ['locale', 'en'],
    ['title', ''],
    ['displayVersion', ''],
    ['html', null],
    ['sourceHash', 'invalid'],
    ['sourceHash', undefined],
    ['sourceHash', ['b'.repeat(64)]],
    ['contentHash', 'invalid'],
    ['contentHash', undefined],
    ['contentHash', ['a'.repeat(64)]],
    ['rendererVersion', ''],
    ['effectiveAt', 'invalid'],
    ['effectiveAt', '2026-09-06'],
    ['createdAt', 'invalid'],
    ['createdAt', '2026-02-30T12:00:00Z'],
    ['effectiveLocalDate', '07.09.2026'],
    ['effectiveLocalDate', '2026-02-30'],
    ['effectiveTimeZone', 'UTC'],
    ['createdBy', 7],
    ['canDelete', false],
    ['cookieCategories', null],
    ['cookieCategories', [99]],
    ['cookieCategories', ['0']],
    ['cookieCategories', []]
  ])('rejects current and UUID documents with invalid %s', async (property, value) => {
    session.consentRequest.mockResolvedValue({
      serverNow:now,
      nextChangeAt:null,
      document:{ ...document, [property]:value }
    })

    await expect(store.current(LEGAL_DOCUMENT_KIND.COOKIE_CONSENT)).rejects.toMatchObject({ code:'ui_protocol_error' })
    session.consentRequest.mockResolvedValue({ ...document, [property]:value })
    await expect(store.read(id)).rejects.toMatchObject({ code:'ui_protocol_error' })
  })
  it.each([{}, { document:undefined }, { document:false }, { document:0 }, { document:'' }, { document:[] }])(
    'rejects malformed current-document absence %j', async payload => {
      session.consentRequest.mockResolvedValue({ serverNow:now, nextChangeAt:null, ...payload })
      await expect(store.current(LEGAL_DOCUMENT_KIND.COOKIE_CONSENT)).rejects.toMatchObject({ code:'ui_protocol_error' })
    })
  it.each([null, undefined, false, {}, [], { ...document, id:'22222222-2222-2222-2222-222222222222' },
    { ...document, kind:LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT, cookieCategories:[0] }])(
    'rejects malformed or mismatched UUID documents %j', async value => {
      session.consentRequest.mockResolvedValue(value)
      await expect(store.read(id)).rejects.toMatchObject({ code:'ui_protocol_error' })
    })
  it('loads Ops before validating a UUID read and permits an immutable future document', async () => {
    const futureDocument = { ...document, id:'aaaaaaaa-1111-1111-1111-111111111111',
      kind:LEGAL_DOCUMENT_KIND.USER_AGREEMENT, cookieCategories:[],
      effectiveAt:'2026-09-08T21:00:00Z', effectiveLocalDate:'2026-09-09' }
    const request = vi.fn().mockResolvedValueOnce(ops).mockResolvedValueOnce(futureDocument)
    const local = createConsentStore({ customer:ref(null), consentRequest:request })
    await expect(local.read(futureDocument.id.toUpperCase())).resolves.toEqual(futureDocument)
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      '/api/v1/legal/ops', '/api/v1/legal/documents/' + futureDocument.id.toUpperCase()
    ])
    local.dispose()
  })
  it.each([undefined, 'invalid', '2026-09-08', '2026-02-30T12:00:00Z', now])('rejects an invalid current-document boundary %j', async nextChangeAt => {
    session.consentRequest.mockResolvedValue({ serverNow:now, nextChangeAt, document })

    await expect(store.current(LEGAL_DOCUMENT_KIND.COOKIE_CONSENT)).rejects.toMatchObject({ code:'ui_protocol_error' })
  })
  it.each(['2026-09-07', '2026-02-30T12:00:00Z'])('rejects invalid current-document server time %s', async serverNow => {
    session.consentRequest.mockResolvedValue({ serverNow, nextChangeAt:null, document })

    await expect(store.current(LEGAL_DOCUMENT_KIND.COOKIE_CONSENT)).rejects.toMatchObject({ code:'ui_protocol_error' })
  })
  it('rejects a current document before its effective boundary', async () => {
    session.consentRequest.mockResolvedValue({
      serverNow:now,
      nextChangeAt:null,
      document:{ ...document, effectiveAt:'2026-09-07T12:00:01Z' }
    })

    await expect(store.current(LEGAL_DOCUMENT_KIND.COOKIE_CONSENT)).rejects.toMatchObject({ code:'ui_protocol_error' })
  })
  it('allows service only with all required categories and invalidates exactly at server boundaries', async () => {
    session.consentRequest.mockResolvedValue(receipt)
    await store.loadCookies()
    expect(store.serviceAllowed.value).toBe(true)
    await vi.advanceTimersByTimeAsync(3600000)
    expect(store.cookies.value).toBeNull()
    expect(store.serviceAllowed.value).toBe(false)
    session.consentRequest.mockResolvedValue({ ...receipt, nextChangeAt:'2026-09-07T12:00:01Z' })
    await store.loadCookies(); await vi.advanceTimersByTimeAsync(1000)
    expect(store.cookies.value).toBeNull()
    session.consentRequest.mockResolvedValue({ ...receipt, expiresAt:'2027-01-01T00:00:00Z' })
    await store.loadCookies(); await vi.advanceTimersByTimeAsync(2147483647)
    expect(store.cookies.value.status).toBe('current')
    session.consentRequest.mockResolvedValue({ ...receipt, expiresAt:now })
    await store.loadCookies(); expect(store.cookies.value).toBeNull()
  })
  it.each([null, {}, { ...receipt, categories:[99] }, { ...receipt, categories:[] }, { ...receipt, serverNow:'bad' }, { ...receipt, status:'unknown' }, { ...receipt, documentId:'bad' }, { ...receipt, expiresAt:null }, { ...receipt, nextChangeAt:'invalid' }])('fails closed on invalid receipts %j', async value => {
    session.consentRequest.mockResolvedValue(value)
    await expect(store.loadCookies()).rejects.toBeDefined()
    expect(store.cookies.value).toBeNull()
    expect(store.cookieProblem.value).toBeTruthy()
  })
  it.each(['missing', 'renewal-required', 'refused', 'withdrawn', 'unavailable'])('keeps service unavailable for %s', async status => {
    session.consentRequest.mockResolvedValue({ ...receipt, status, expiresAt:null, categories:[] })
    await store.loadCookies()
    expect(store.serviceAllowed.value).toBe(false)
  })
  it('sends explicit version/hash/decision and associates only an authenticated observed browser', async () => {
    session.consentRequest.mockResolvedValue(receipt)
    await store.decideCookies(document, 'grant', [0], 'retry-key')
    expect(JSON.parse(session.consentRequest.mock.calls[0][1].body)).toEqual({ documentId:id, contentHash:document.contentHash, decision:'grant', categories:[0], idempotencyKey:'retry-key' })
    session.customer.value = { id:7 }
    await store.decideCookies(document, 'refuse', [])
    expect(session.consentRequest).toHaveBeenLastCalledWith('/api/v1/consents/me/browser', { method:'POST' }, true)
    const error = new Error('private')
    session.consentRequest.mockRejectedValue(error)
    await expect(store.decideCookies(document, 'withdraw', [])).rejects.toBe(error)
    expect(store.cookieProblem.value).toBe(error)
  })
  it('ignores out-of-order cookie responses and failures', async () => {
    let resolve, reject
    session.consentRequest.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    const old = store.loadCookies()
    await Promise.resolve()
    session.consentRequest.mockResolvedValue({ ...receipt, status:'refused', categories:[] })
    await store.decideCookies(document, 'refuse', [])
    resolve(receipt); await old
    expect(store.cookies.value.status).toBe('refused')
    session.consentRequest.mockImplementationOnce(() => new Promise((_r,j) => { reject = j }))
    const fail = store.loadCookies().catch(() => {})
    await Promise.resolve()
    session.consentRequest.mockResolvedValue({ ...receipt, status:'refused', categories:[] })
    await store.loadCookies(); reject(new Error('stale')); await fail
    expect(store.cookieProblem.value).toBeNull()
  })
  it('scopes customer histories to identity and protects against stale loads', async () => {
    await store.loadMine(); await store.associate()
    expect(session.consentRequest).not.toHaveBeenCalled()
    session.customer.value = { id:7 }
    session.consentRequest.mockResolvedValue(history)
    await store.loadMine(); expect(store.mine.value).toEqual(history)
    await store.associate()
    await store.grant(document)
    await store.requestWithdrawal()
    expect(session.consentRequest.mock.calls.some(x => x[0] === '/api/v1/consents/me/withdrawal-request' && x[1]?.method === 'POST')).toBe(true)
    let resolve
    session.consentRequest.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    const old = store.loadMine()
    await Promise.resolve()
    store.resetCustomer(); session.customer.value = { id:8 }
    resolve(history); await old
    expect(store.mine.value).toBeNull()
    session.customer.value = { id:7 }
    session.consentRequest.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    const stale = store.loadMine(); await store.loadMine(); resolve({ ...history, history:[{ kind:LEGAL_DOCUMENT_KIND.PERSONAL_DATA_CONSENT }] }); await stale
    expect(store.mine.value.history).toEqual([])
  })
  it.each([null, { ...history, customerId:8 }, { ...history, statuses:null }, { ...history, history:null },
    { ...history, withdrawalRequest:undefined }, { ...history, withdrawalRequest:{} },
    { ...history, withdrawalRequest:{ customerId:8, requestedAt:now, processed:false } },
    { ...history, withdrawalRequest:{ customerId:7, requestedAt:'bad', processed:false } },
    { ...history, withdrawalRequest:{ customerId:7, requestedAt:now, processed:'false' } }])('rejects malformed customer histories %j', async value => {
    session.customer.value = { id:7 }; session.consentRequest.mockResolvedValue(value)
    await expect(store.loadMine()).rejects.toBeDefined()
    expect(store.personalProblem.value).toBeTruthy()
  })
  it('does not report a previous identity failure in the next session', async () => {
    session.customer.value = { id:7 }
    let reject
    session.consentRequest.mockImplementation(() => new Promise((_r,j) => { reject = j }))
    const pending = store.loadMine().catch(() => {})
    await Promise.resolve()
    store.resetCustomer(); reject(new Error('private')); await pending
    expect(store.personalProblem.value).toBeNull()
  })
})
describe('safe legal reader formatting', () => {
  it('preserves supported structure and blocks attributes and active nodes', () => {
    const nodes = documentNodes('<h1>Текст</h1><p><em>Курсив</em> <a href="https://example.test" title="сайт">ссылка</a></p><ol start="2"><li>Два</li></ol><table><tr><td style="text-align: center">Ячейка</td></tr></table>')
    expect(nodes).toHaveLength(4)
    expect(documentNodes('<a href="mailto:help@example.test">Почта</a>')).toHaveLength(1)
    for (const html of [null, 'x'.repeat(2097153), '<script>bad</script>', '<!-- comment -->', '<p onclick="bad()">bad</p>', '<a href="javascript:alert(1)">bad</a>', '<a href="relative">bad</a>', '<img src="https://example.test">', '<td style="color:red">bad</td>', '<ol start="bad"><li>bad</li></ol>']) expect(() => documentNodes(html)).toThrow()
    expect(isDocumentId(id)).toBe(true); expect(isDocumentId(null)).toBe(false)
    expect(moscowTime(null)).toBe('—'); expect(moscowTime('bad')).toBe('—'); expect(moscowTime(now)).toContain('15:00')
  })
  it('downloads exact bytes with a fixed filename and releases the URL', async () => {
    const create = vi.fn(() => 'blob:test'), revoke = vi.fn()
    globalThis.URL.createObjectURL = create; globalThis.URL.revokeObjectURL = revoke
    const click = vi.spyOn(globalThis.HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const blob = new globalThis.Blob(['# Текст'])
    downloadBytes(blob, id); expect(create).toHaveBeenCalledWith(blob); expect(click).toHaveBeenCalled()
    await vi.runOnlyPendingTimersAsync(); expect(revoke).toHaveBeenCalledWith('blob:test')
  })
})
