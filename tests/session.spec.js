// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const loggerMocks = vi.hoisted(() => ({ log: vi.fn() }))
vi.mock('../src/observability/logger.js', () => ({
  uiLogger: Object.freeze({ log: loggerMocks.log })
}))

import { INTERNAL_PROBLEM_TYPES } from '../src/errors/problem.js'
import { EVENTS } from '../src/observability/catalogue.js'
import { resetSessionForTests, useSession } from '../src/stores/session.js'
import { TEST_TRACE_ID, problemResponse, response } from './fixtures/http.js'
import { customerDto } from './fixtures/customer.js'

const authenticationOps = { steps:[
  { value:0, name:'Код подтверждения', routeAlias:'code' },
  { value:1, name:'Пользовательское соглашение', routeAlias:'agreement' },
  { value:2, name:'Регистрация', routeAlias:'registration' }
] }
const customerOps = { states:[
  { value:0, name:'Предварительный', routeAlias:'preliminary' },
  { value:1, name:'Заполненный', routeAlias:'complete' },
  { value:2, name:'Отключённый', routeAlias:'disabled' }
] }

function opsResponse(url) {
  if (url === '/api/v1/auth/ops') return response(200, authenticationOps)
  if (url === '/api/v1/customers/ops') return response(200, customerOps)
  return null
}

function withOps(handler) {
  return vi.fn((url, options) => {
    const standard = opsResponse(url)
    return standard ? Promise.resolve(standard) : handler(url, options)
  })
}

describe('session store', () => {
  beforeEach(() => {
    resetSessionForTests()
    loggerMocks.log.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([
    ['missing authentication Ops', null, customerOps],
    ['empty authentication steps', { steps:[] }, customerOps],
    ['duplicate authentication values', { steps:[...authenticationOps.steps, { value:0, name:'Другой', routeAlias:'other' }] }, customerOps],
    ['duplicate authentication aliases', { steps:[...authenticationOps.steps, { value:3, name:'Другой', routeAlias:'code' }] }, customerOps],
    ['missing authentication step', { steps:authenticationOps.steps.filter(item => item.routeAlias !== 'agreement') }, customerOps],
    ['malformed authentication item', { steps:[...authenticationOps.steps, { value:3, name:'', routeAlias:'other' }] }, customerOps],
    ['missing customer state', authenticationOps, { states:customerOps.states.filter(item => item.routeAlias !== 'disabled') }],
    ['malformed customer state', authenticationOps, { states:[...customerOps.states, { value:'3', name:'Другой', routeAlias:'other' }] }]
  ])('rejects %s without retaining partial Ops', async (_label, auth, customers) => {
    vi.stubGlobal('fetch', vi.fn(url => {
      if (url === '/api/v1/auth/ops') return Promise.resolve(response(200, auth))
      if (url === '/api/v1/customers/ops') return Promise.resolve(response(200, customers))
      throw new Error(`Unexpected request: ${url}`)
    }))

    const session = useSession()
    await expect(session.ensureOps()).rejects.toMatchObject({ code:'ui_protocol_error' })
    expect(session.flowValue('code')).toBeUndefined()
  })

  it('shares one in-flight Ops request between concurrent callers', async () => {
    let resolveAuthentication
    let resolveCustomers
    const authentication = new Promise(resolve => { resolveAuthentication = resolve })
    const customers = new Promise(resolve => { resolveCustomers = resolve })
    const fetch = vi.fn(url => {
      if (url === '/api/v1/auth/ops') return authentication
      if (url === '/api/v1/customers/ops') return customers
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)

    const session = useSession()
    const first = session.ensureOps()
    const second = session.ensureOps()
    resolveAuthentication(response(200, authenticationOps))
    resolveCustomers(response(200, customerOps))
    await Promise.all([first, second])

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(session.flowValue('code')).toBe(0)
  })

  it.each([undefined, 99, '0', 2])('rejects a restored session with invalid customer state %j', async state => {
    const restoredCustomer = customerDto({ id:3, phone:'+79990000003', state, profile:{ phone:'+79990000003' } })
    const fetch = withOps(url => {
      if (url === '/api/v1/auth/refresh') return Promise.resolve(response(200, {
        accessToken:'restored-token', expiresAt:'2026-08-30T00:15:00Z', customer:restoredCustomer
      }))
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)

    const session = useSession()
    await session.restoreSession()

    expect(session.customer.value).toBeNull()
    expect(session.restoreProblem.value).toMatchObject({ type:INTERNAL_PROBLEM_TYPES.sessionRestoreUnavailable })
    expect(session.notice.value).toBe('Сервис недоступен. Пожалуйста, повторите позже.')
  })

  it.each([
    ['missing access token', undefined, '2026-08-30T00:15:00Z'],
    ['empty access token', '', '2026-08-30T00:15:00Z'],
    ['padded access token', ' token ', '2026-08-30T00:15:00Z'],
    ['missing expiry', 'token', undefined],
    ['date-only expiry', 'token', '2026-08-30'],
    ['impossible expiry', 'token', '2026-02-30T00:15:00Z']
  ])('rejects a verified session with %s', async (_label, accessToken, expiresAt) => {
    const activeCustomer = customerDto({ id:3, phone:'+79990000003', state:0, profile:{ phone:'+79990000003' } })
    const fetch = withOps(url => {
      if (url === '/api/v1/auth/code/verify') {
        return Promise.resolve(response(200, { accessToken, expiresAt, customer:activeCustomer }))
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)

    const session = useSession()
    await expect(session.verifyCode({ phone:activeCustomer.phone, code:'1111' })).rejects.toMatchObject({
      type:INTERNAL_PROBLEM_TYPES.serviceUnavailable
    })
    expect(session.customer.value).toBeNull()
    expect(session.notice.value).toBe('Сервис недоступен. Пожалуйста, повторите позже.')
  })

  it('clears an existing session when verification returns an invalid customer state', async () => {
    const activeCustomer = customerDto({ id:3, phone:'+79990000003', state:0, profile:{ phone:'+79990000003' } })
    let verifications = 0
    const fetch = withOps(url => {
      if (url === '/api/v1/auth/code/verify') {
        verifications++
        return Promise.resolve(response(200, {
          accessToken:`token-${verifications}`,
          expiresAt:'2026-08-30T00:15:00Z',
          customer:verifications === 1 ? activeCustomer : { ...activeCustomer, state:'preliminary' }
        }))
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)

    const session = useSession()
    await session.verifyCode({ phone:activeCustomer.phone, code:'1111' })
    await expect(session.verifyCode({ phone:activeCustomer.phone, code:'2222' })).rejects.toMatchObject({
      type:INTERNAL_PROBLEM_TYPES.serviceUnavailable
    })

    expect(session.customer.value).toBeNull()
    expect(session.notice.value).toBe('Сервис недоступен. Пожалуйста, повторите позже.')
  })

  it('does not clear the current session for an aborted stale verification', async () => {
    const activeCustomer = customerDto({ id:3, phone:'+79990000003', state:0, profile:{ phone:'+79990000003' } })
    const controller = new globalThis.AbortController()
    let current = true
    const fetch = withOps((url, options) => {
      if (url === '/api/v1/auth/code/verify') {
        if (JSON.parse(options.body).code === '1111') {
          return Promise.resolve(response(200, {
            accessToken:'active-token', expiresAt:'2026-08-30T00:15:00Z', customer:activeCustomer
          }))
        }
        return new Promise((_resolve, reject) => {
          const abortError = new Error('Aborted')
          abortError.name = 'AbortError'
          options.signal.addEventListener(
            'abort',
            () => reject(abortError),
            { once:true }
          )
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)

    const session = useSession()
    await session.verifyCode({ phone:activeCustomer.phone, code:'1111' })
    const staleVerification = session.verifyCode(
      { phone:activeCustomer.phone, code:'2222' },
      () => current,
      controller.signal
    )
    current = false
    controller.abort()
    await expect(staleVerification).resolves.toBeNull()

    expect(session.customer.value).toEqual(activeCustomer)
    expect(session.notice.value).toBe('')
  })

  it('skips a stale verification before issuing the verify request', async () => {
    const fetch = withOps(url => {
      if (url === '/api/v1/auth/code/verify') {
        throw new Error('verify should not be called for a stale operation')
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)

    const result = await useSession().verifyCode({ phone:'+79990000003', code:'1111' }, () => false)

    expect(result).toBeNull()
    expect(fetch.mock.calls.filter(([url]) => url === '/api/v1/auth/code/verify')).toHaveLength(0)
  })

  it('clears an existing session when refresh returns an invalid customer state', async () => {
    const activeCustomer = customerDto({ id:3, phone:'+79990000003', state:0, profile:{ phone:'+79990000003' } })
    const fetch = withOps(url => {
      if (url === '/api/v1/auth/code/verify') return Promise.resolve(response(200, {
        accessToken:'active-token', expiresAt:'2026-08-30T00:15:00Z', customer:activeCustomer
      }))
      if (url === '/api/v1/auth/refresh') return Promise.resolve(response(200, {
        accessToken:'invalid-token', expiresAt:'2026-08-30T00:30:00Z',
        customer:{ ...activeCustomer, state:99 }
      }))
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)

    const session = useSession()
    await session.verifyCode({ phone:activeCustomer.phone, code:'1111' })
    await session.restoreSession()

    expect(session.customer.value).toBeNull()
    expect(session.notice.value).toBe('Сервис недоступен. Пожалуйста, повторите позже.')
    expect(session.restoreProblem.value).toMatchObject({ type:INTERNAL_PROBLEM_TYPES.sessionRestoreUnavailable })
  })

  it('clears a previous restoration problem when verification applies a valid session', async () => {
    const verifiedCustomer = customerDto({ id:4, phone:'+79990000004', profile:{ phone:'+79990000004' } })
    const fetch = withOps(url => {
      if (url === '/api/v1/auth/refresh') return Promise.resolve(problemResponse(503, 'service-unavailable'))
      if (url === '/api/v1/auth/code/verify') return Promise.resolve(response(200, {
        accessToken:'verified-token', expiresAt:'2026-08-30T00:15:00Z', customer:verifiedCustomer
      }))
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)

    const session = useSession()
    await session.restoreSession()
    expect(session.restoreProblem.value).toMatchObject({ type:INTERNAL_PROBLEM_TYPES.sessionRestoreUnavailable })

    await session.verifyCode({ phone:verifiedCustomer.phone, code:'1111' })

    expect(session.customer.value).toEqual(verifiedCustomer)
    expect(session.restoreProblem.value).toBeNull()
    expect(session.notice.value).toBe('')
  })

  it.each(['success', 'failure'])('discards a late refresh %s after a newer identity is authenticated', async outcome => {
    const original = customerDto({ id:4, phone:'+79990000004', profile:{ phone:'+79990000004' } })
    const replacement = customerDto({ id:5, phone:'+79990000005', profile:{ phone:'+79990000005' } })
    let completeRefresh
    let markRefreshStarted
    const refreshStarted = new Promise(resolve => { markRefreshStarted = resolve })
    const pendingRefresh = new Promise(resolve => { completeRefresh = resolve })
    let verifications = 0
    let profileAttempts = 0
    const fetch = withOps(url => {
      if (url === '/api/v1/auth/code/verify') return Promise.resolve(response(200, {
        accessToken:verifications++ ? 'replacement-token' : 'original-token',
        expiresAt:'2026-08-30T00:15:00Z',
        customer:verifications === 1 ? original : replacement
      }))
      if (url === '/api/v1/customers/me') {
        profileAttempts++
        return Promise.resolve(profileAttempts === 1
          ? problemResponse(401, 'invalid-access-token')
          : response(200, replacement))
      }
      if (url === '/api/v1/auth/refresh') {
        markRefreshStarted()
        return pendingRefresh
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)

    const session = useSession()
    await session.verifyCode({ phone:original.phone, code:'1111' })
    const update = session.updateProfile({ firstName:'Old request' })
    await refreshStarted
    await session.verifyCode({ phone:replacement.phone, code:'2222' })
    completeRefresh(outcome === 'success'
      ? response(200, {
          accessToken:'stale-token', expiresAt:'2026-08-30T00:30:00Z', customer:original
        })
      : problemResponse(503, 'service-unavailable'))

    await expect(update).resolves.toBeNull()
    expect(session.customer.value).toEqual(replacement)
    expect(session.restoreProblem.value).toBeNull()
    expect(session.notice.value).toBe('')
  })

  it.each([
    null,
    {},
    { nextStep:99, requiredDocumentKinds:[] },
    { nextStep:'0', requiredDocumentKinds:[] },
    { nextStep:0, requiredDocumentKinds:null },
    { nextStep:0, requiredDocumentKinds:[-1] },
    { nextStep:0, requiredDocumentKinds:[1.5] },
    { nextStep:0, requiredDocumentKinds:[1, 1] }
  ])('fails closed on malformed phone resolution %j', async resolution => {
    const fetch = withOps(url => {
      if (url === '/api/v1/auth/phone/resolve') return Promise.resolve(response(200, resolution))
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)

    await expect(useSession().resolvePhone('+79990000003')).rejects.toMatchObject({
      type:INTERNAL_PROBLEM_TYPES.serviceUnavailable
    })
  })

  it.each(['stale operation', 'aborted signal'])('skips phone resolution before Ops for a %s', async mode => {
    const controller = new globalThis.AbortController()
    if (mode === 'aborted signal') controller.abort()
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)

    await expect(useSession().resolvePhone('+79990000003', () => mode !== 'stale operation', controller.signal))
      .resolves.toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['stale operation', 'aborted signal'])('skips phone resolution invalidated during Ops by a %s', async mode => {
    const controller = new globalThis.AbortController()
    let current = true
    let finishOps
    const pendingOps = new Promise(resolve => { finishOps = resolve })
    const fetch = vi.fn(url => {
      if (url === '/api/v1/auth/ops') return pendingOps
      return Promise.resolve(opsResponse(url))
    })
    vi.stubGlobal('fetch', fetch)
    const request = useSession().resolvePhone('+79990000003', () => current, controller.signal)
    if (mode === 'aborted signal') controller.abort()
    else current = false
    finishOps(response(200, authenticationOps))

    await expect(request).resolves.toBeNull()
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/v1/auth/ops', '/api/v1/customers/ops'])
  })

  it.each(['stale operation', 'aborted signal'])('discards a phone response invalidated by a %s', async mode => {
    const controller = new globalThis.AbortController()
    let current = true
    let finishRequest
    const pendingRequest = new Promise(resolve => { finishRequest = resolve })
    const fetch = withOps((url, options) => {
      expect(url).toBe('/api/v1/auth/phone/resolve')
      expect(options.signal).toBe(controller.signal)
      if (mode === 'aborted signal') controller.abort()
      else current = false
      return pendingRequest
    })
    vi.stubGlobal('fetch', fetch)
    const request = useSession().resolvePhone('+79990000003', () => current, controller.signal)
    finishRequest(response(200, { nextStep:99, requiredDocumentKinds:[] }))

    await expect(request).resolves.toBeNull()
    expect(useSession().notice.value).toBe('')
  })

  it('passes the phone-resolution signal and suppresses its cancellation', async () => {
    const controller = new globalThis.AbortController()
    let signal
    let started
    const requestStarted = new Promise(resolve => { started = resolve })
    const fetch = withOps((url, options) => {
      expect(url).toBe('/api/v1/auth/phone/resolve')
      signal = options.signal
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort',
          () => reject(new globalThis.DOMException('Aborted', 'AbortError')), { once:true })
        started()
      })
    })
    vi.stubGlobal('fetch', fetch)
    const request = useSession().resolvePhone('+79990000003', () => true, controller.signal)
    await requestStarted
    controller.abort()

    await expect(request).resolves.toBeNull()
    expect(signal).toBe(controller.signal)
    expect(signal.aborted).toBe(true)
    expect(useSession().notice.value).toBe('')
  })

  describe.each(['verification', 'restoration', 'profile update'])('%s customer DTO validation', operation => {
    const invalidCustomers = [
      ['missing customer', () => null],
      ['empty customer', () => ({})],
      ...[undefined, 0, -1, 1.5, '1', 2147483648].map(id => ['invalid ID ' + id, value => ({ ...value, id })]),
      ...[undefined, 79990000001, '79990000001', '+19990000001', ' +79990000001'].map(phone => ['invalid phone ' + phone, value => ({ ...value, phone })]),
      ...[undefined, '2026-08-01', '2026-02-30T12:00:00Z'].map(createdAt => ['invalid creation time ' + createdAt, value => ({ ...value, createdAt })]),
      ['missing update time', value => ({ ...value, updatedAt:undefined })],
      ['impossible update time', value => ({ ...value, updatedAt:'2026-02-30T12:00:00Z' })],
      ...[undefined, 'false'].map(hasPhoto => ['invalid photo flag ' + hasPhoto, value => ({ ...value, hasPhoto })]),
      ...[undefined, null, [], 'profile'].map(profile => ['invalid profile ' + profile, value => ({ ...value, profile })]),
      ['missing profile phone', value => ({ ...value, profile:{ ...value.profile, phone:undefined } })],
      ['mismatched profile phone', value => ({ ...value, profile:{ ...value.profile, phone:'+79990000002' } })],
      ...['lastName', 'firstName', 'patronymic', 'email', 'passportSeries', 'passportNumber', 'passportIssuedBy', 'inn', 'postalCode', 'city', 'address']
        .flatMap(field => [undefined, 7, 'x'.repeat(501)].map(invalid => ['invalid profile ' + field + ' ' + typeof invalid,
          value => ({ ...value, profile:{ ...value.profile, [field]:invalid } })])),
      ...[undefined, '2026-02-30', '2026-08-01T12:00:00Z'].map(passportIssueDate => ['invalid passport date ' + passportIssueDate,
        value => ({ ...value, profile:{ ...value.profile, passportIssueDate } })])
    ]
    it.each(invalidCustomers)('rejects %s and clears the whole session', async (_label, malformed) => {
      const original = customerDto()
      let fail = false
      const fetch = withOps(url => {
        if (url === '/api/v1/auth/code/verify' || url === '/api/v1/auth/refresh') {
          return Promise.resolve(response(200, { accessToken:'token', expiresAt:'2026-08-30T00:15:00Z',
            customer:fail ? malformed(customerDto()) : original }))
        }
        if (url === '/api/v1/customers/me') return Promise.resolve(response(200, malformed(customerDto())))
        if (url === '/api/v1/customers/me/photo') return Promise.resolve(response(200, new globalThis.Blob(['photo']), 'image/png'))
        throw new Error('Unexpected request')
      })
      vi.stubGlobal('fetch', fetch)
      const session = useSession()
      await session.verifyCode({ phone:original.phone, code:'1111' })
      fail = true
      if (operation === 'restoration') {
        await session.restoreSession()
        expect(session.restoreProblem.value).toMatchObject({ type:INTERNAL_PROBLEM_TYPES.sessionRestoreUnavailable })
      } else {
        await expect(operation === 'verification'
          ? session.verifyCode({ phone:original.phone, code:'1111' })
          : session.updateProfile({ firstName:'Анна' })).rejects.toMatchObject({ type:INTERNAL_PROBLEM_TYPES.serviceUnavailable })
      }
      expect(session.customer.value).toBeNull()
      expect(session.notice.value).toBe('Сервис недоступен. Пожалуйста, повторите позже.')
      await session.getPhoto()
      expect(fetch.mock.calls.at(-1)[1].headers.has('Authorization')).toBe(false)
    })
  })

  it.each(['id', 'phone'])('rejects a valid profile DTO with a different %s', async field => {
    const original = customerDto()
    const other = customerDto(field === 'id' ? { id:2 } : { phone:'+79990000002' })
    vi.stubGlobal('fetch', withOps(url => Promise.resolve(response(200, url === '/api/v1/customers/me' ? other : {
      accessToken:'token', expiresAt:'2026-08-30T00:15:00Z', customer:original
    }))))
    const session = useSession()
    await session.verifyCode({ phone:original.phone, code:'1111' })
    await expect(session.updateProfile({ firstName:'Анна' })).rejects.toMatchObject({ type:INTERNAL_PROBLEM_TYPES.serviceUnavailable })
    expect(session.customer.value).toBeNull()
  })

  it('accepts a complete profile with populated nullable fields and a calendar-valid passport date', async () => {
    const original = customerDto({ profile:{
      lastName:'Иванова', firstName:'Анна', patronymic:'Ивановна', email:'anna@example.test',
      passportSeries:'4500', passportNumber:'123456', passportIssuedBy:'ОВД', passportIssueDate:'2024-02-29',
      inn:'770123456789', postalCode:'101000', city:'Москва', address:'Тверская, 1'
    } })
    vi.stubGlobal('fetch', withOps(url => Promise.resolve(response(200, url === '/api/v1/customers/me' ? original : {
      accessToken:'token', expiresAt:'2026-08-30T00:15:00Z', customer:original
    }))))
    const session = useSession()
    await expect(session.verifyCode({ phone:original.phone, code:'1111' })).resolves.toEqual(original)
    await expect(session.updateProfile(original.profile)).resolves.toEqual(original)
  })

  it('rejects profile updates without an authenticated identity before requesting Core', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(useSession().updateProfile({ firstName:'Анна' })).rejects.toMatchObject({ type:INTERNAL_PROBLEM_TYPES.invalidInput })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['logout', 'switch', 'relogin'])('discards late profile results after %s', async change => {
    const original = customerDto()
    const replacement = customerDto({ id:change === 'switch' ? 2 : 1, profile:{ firstName:'Новая' } })
    let complete
    const pending = new Promise(resolve => { complete = resolve })
    let verifications = 0
    vi.stubGlobal('fetch', withOps(url => {
      if (url === '/api/v1/customers/me') return pending
      if (url === '/api/v1/auth/logout') return Promise.resolve(response(204))
      if (url === '/api/v1/auth/code/verify') return Promise.resolve(response(200, {
        accessToken:'token', expiresAt:'2026-08-30T00:15:00Z', customer:verifications++ ? replacement : original
      }))
      throw new Error('Unexpected request')
    }))
    const session = useSession()
    await session.verifyCode({ phone:original.phone, code:'1111' })
    const update = session.updateProfile({ firstName:'Поздняя' })
    if (change !== 'switch') await session.logout()
    if (change !== 'logout') await session.verifyCode({ phone:replacement.phone, code:'1111' })
    complete(response(200, customerDto({ profile:{ firstName:'Поздняя' } })))
    await expect(update).resolves.toBeNull()
    expect(session.customer.value).toEqual(change === 'logout' ? null : replacement)
    expect(session.notice.value).toBe('')
  })

  it('discards a late profile failure without clearing the new identity', async () => {
    const original = customerDto()
    const replacement = customerDto({ id:2 })
    let complete
    const pending = new Promise(resolve => { complete = resolve })
    let verifications = 0
    vi.stubGlobal('fetch', withOps(url => {
      if (url === '/api/v1/customers/me') return pending
      if (url === '/api/v1/auth/code/verify') return Promise.resolve(response(200, {
        accessToken:'token', expiresAt:'2026-08-30T00:15:00Z', customer:verifications++ ? replacement : original
      }))
      throw new Error('Unexpected request')
    }))
    const session = useSession()
    await session.verifyCode({ phone:original.phone, code:'1111' })
    const update = session.updateProfile({ firstName:'Поздняя' })
    await session.verifyCode({ phone:replacement.phone, code:'1111' })
    complete(problemResponse(503, 'service-unavailable'))
    await expect(update).resolves.toBeNull()
    expect(session.customer.value).toEqual(replacement)
    expect(session.notice.value).toBe('')
  })

  it('propagates the refresh failure that invalidates a current profile request', async () => {
    const original = customerDto()
    vi.stubGlobal('fetch', withOps(url => {
      if (url === '/api/v1/auth/code/verify') return Promise.resolve(response(200, {
        accessToken:'token', expiresAt:'2026-08-30T00:15:00Z', customer:original
      }))
      if (url === '/api/v1/customers/me') return Promise.resolve(problemResponse(401, 'invalid-access-token'))
      if (url === '/api/v1/auth/refresh') return Promise.resolve(problemResponse(503, 'service-unavailable'))
      throw new Error('Unexpected request')
    }))
    const session = useSession()
    await session.verifyCode({ phone:original.phone, code:'1111' })
    await expect(session.updateProfile({ firstName:'Анна' })).rejects.toMatchObject({ type:INTERNAL_PROBLEM_TYPES.serviceUnavailable })
    expect(session.customer.value).toBeNull()
    expect(session.notice.value).toBe('Сервис недоступен. Пожалуйста, повторите позже.')
  })

  it('preserves a structured client error from phone resolution', async () => {
    const fetch = withOps(url => {
      if (url === '/api/v1/auth/phone/resolve') {
        return Promise.resolve(problemResponse(400, 'invalid-phone', {
          title:'Некорректный телефон', detail:'Введите российский номер телефона.'
        }))
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)

    await expect(useSession().resolvePhone('+70000000000')).rejects.toMatchObject({
      status:400,
      code:'invalid_phone'
    })
  })

  it('uses the bearer token for profile updates', async () => {
    const originalCustomer = customerDto({
      id: 1,
      phone: '+79990000001',
      state: 0,
      hasPhoto: false,
      profile: { phone: '+79990000001' }
    })
    const updatedCustomer = customerDto({
      ...originalCustomer,
      state: 1,
      profile: { ...originalCustomer.profile, firstName: 'Анна' }
    })
    const fetch = withOps((url) => {
      if (url === '/api/v1/auth/code/verify') {
        return Promise.resolve(response(200, {
          accessToken: 'jwt-value',
          expiresAt: '2026-08-30T00:15:00Z',
          customer: originalCustomer
        }))
      }
      if (url === '/api/v1/customers/me') return Promise.resolve(response(200, updatedCustomer))
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)

    const session = useSession()
    await session.verifyCode({ phone: originalCustomer.phone, code: '1111' })
    await session.updateProfile({ firstName: 'Анна' })

    const updateCall = fetch.mock.calls.find(([url]) => url === '/api/v1/customers/me')
    expect(updateCall[1].headers.get('Authorization')).toBe('Bearer jwt-value')
    expect(session.customer.value.profile.firstName).toBe('Анна')
  })

  it.each([2, 'preliminary', undefined, null, 99, -1, 0.5])('rejects a profile update with an invalid customer state %j', async state => {
    const originalCustomer = customerDto({
      id: 1,
      phone: '+79990000001',
      state: 0,
      hasPhoto: false,
      profile: { phone: '+79990000001' }
    })
    const fetch = withOps((url) => {
      if (url === '/api/v1/auth/code/verify') {
        return Promise.resolve(response(200, {
          accessToken: 'jwt-value',
          expiresAt: '2026-08-30T00:15:00Z',
          customer: originalCustomer
        }))
      }
      if (url === '/api/v1/customers/me') {
        return Promise.resolve(response(200, { ...originalCustomer, state }))
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)

    const session = useSession()
    await session.verifyCode({ phone: originalCustomer.phone, code: '1111' })
    await expect(session.updateProfile({ firstName: 'Анна' })).rejects.toMatchObject({
      type: INTERNAL_PROBLEM_TYPES.serviceUnavailable
    })
    expect(session.customer.value).toBeNull()
    expect(session.notice.value).toBe('Сервис недоступен. Пожалуйста, повторите позже.')
  })

  it('refreshes once and retries an authorized request after a 401', async () => {
    const customer = customerDto({
      id: 2,
      phone: '+79990000002',
      state: 1,
      hasPhoto: false,
      profile: { phone: '+79990000002', firstName: 'Иван' }
    })
    let profileAttempts = 0
    const fetch = withOps((url) => {
      if (url === '/api/v1/auth/code/verify') {
        return Promise.resolve(response(200, {
          accessToken: 'old-token',
          expiresAt: '2026-08-30T00:15:00Z',
          customer
        }))
      }
      if (url === '/api/v1/customers/me') {
        profileAttempts += 1
        return Promise.resolve(profileAttempts === 1
          ? problemResponse(401, 'invalid-access-token', {
              title: 'Недействительный токен доступа',
              detail: 'Обновите сеанс и повторите запрос'
            })
          : response(200, customer))
      }
      if (url === '/api/v1/auth/refresh') {
        return Promise.resolve(response(200, {
          accessToken: 'new-token',
          expiresAt: '2026-08-30T00:30:00Z',
          customer
        }))
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)

    const session = useSession()
    await session.verifyCode({ phone: customer.phone, code: '1111' })
    await session.updateProfile({ firstName: 'Иван' })

    const profileCalls = fetch.mock.calls.filter(([url]) => url === '/api/v1/customers/me')
    expect(profileCalls).toHaveLength(2)
    expect(profileCalls[1][1].headers.get('Authorization')).toBe('Bearer new-token')
    expect(fetch.mock.calls.filter(([url]) => url === '/api/v1/auth/refresh')).toHaveLength(1)

    const flowCalls = fetch.mock.calls.filter(([url]) =>
      url === '/api/v1/customers/me' || url === '/api/v1/auth/refresh'
    )
    const traceparents = flowCalls.map(([, options]) => options.headers.get('traceparent'))
    expect(new Set(traceparents.map(traceparent => traceparent.slice(3, 35))).size).toBe(1)
    expect(new Set(traceparents.map(traceparent => traceparent.slice(36, 52))).size).toBe(3)
  })

  it('restores one shared refresh request and clears an unavailable session', async () => {
    const customer = customerDto({ id: 3, phone: '+79990000003', state:0, profile: { phone: '+79990000003' } })
    const refreshResponses = [
      response(200, {
        accessToken: 'restored-token',
        expiresAt: '2026-08-30T00:15:00Z',
        customer
      }),
      problemResponse(401, 'invalid-refresh-token', {
        title: 'Недействительный сеанс',
        detail: 'Войдите в систему повторно'
      })
    ]
    const fetch = withOps(url => {
      if (url === '/api/v1/auth/refresh') return Promise.resolve(refreshResponses.shift())
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)

    const session = useSession()
    await Promise.all([session.restoreSession(), session.restoreSession()])
    expect(fetch.mock.calls.filter(([url]) => url === '/api/v1/auth/refresh')).toHaveLength(1)
    expect(session.customer.value).toEqual(customer)
    expect(session.restoring.value).toBe(false)

    await session.restoreSession()
    expect(fetch.mock.calls.filter(([url]) => url === '/api/v1/auth/refresh')).toHaveLength(2)
    expect(session.customer.value).toBeNull()
    expect(session.restoreProblem.value).toBeNull()
    expect(session.restoring.value).toBe(false)
  })

  it('preserves validation details and presents malformed HTTP errors as service unavailability', async () => {
    const malformed = response(502, null, 'text/html')
    const fetch = vi.fn()
      .mockResolvedValueOnce(problemResponse(400, 'validation-failed', {
        title: 'Некорректный запрос',
        detail: 'Исправьте указанные поля и повторите запрос',
        errors: { phone: ['Введите номер телефона'] }
      }))
      .mockResolvedValueOnce(malformed)
    vi.stubGlobal('fetch', fetch)

    const session = useSession()
    await expect(session.requestCode('')).rejects.toMatchObject({
      message: 'Исправьте указанные поля и повторите запрос',
      status: 400,
      code: 'validation_failed',
      errors: { phone: ['Введите номер телефона'] }
    })
    await expect(session.requestCode('+79990000004')).rejects.toMatchObject({
      type: INTERNAL_PROBLEM_TYPES.serviceUnavailable,
      code: 'ui_service_unavailable',
      detail: 'Сервис недоступен. Пожалуйста, повторите позже.'
    })
  })

  it('presents a network failure during code request as service unavailability', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const session = useSession()
    await expect(session.requestCode('+79990000004')).rejects.toMatchObject({
      type: INTERNAL_PROBLEM_TYPES.serviceUnavailable,
      code: 'ui_service_unavailable',
      detail: 'Сервис недоступен. Пожалуйста, повторите позже.'
    })
  })

  it('passes the operation signal and suppresses an aborted stale code request', async () => {
    const controller = new globalThis.AbortController()
    let current = true
    let requestSignal = null
    const fetch = vi.fn((url, options) => {
      if (url === '/api/v1/auth/code/request') {
        requestSignal = options.signal
        return new Promise((_resolve, reject) => {
          const abortError = new Error('Aborted')
          abortError.name = 'AbortError'
          options.signal.addEventListener('abort', () => reject(abortError), { once:true })
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)

    const request = useSession().requestCode('+79990000004', {}, () => current, controller.signal)
    current = false
    controller.abort()

    await expect(request).resolves.toBeNull()
    expect(requestSignal).toBe(controller.signal)
    expect(requestSignal.aborted).toBe(true)
  })

  it('skips a stale code request before issuing it', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)

    await expect(useSession().requestCode('+79990000004', {}, () => false)).resolves.toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    null,
    {},
    { onboardingToken:false },
    { onboardingToken:'' },
    { onboardingToken:'short' },
    { onboardingToken:'x'.repeat(129) }
  ])('fails closed on malformed code-request receipt %j', async receipt => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(202, receipt)))

    await expect(useSession().requestCode('+79990000004')).rejects.toMatchObject({
      type:INTERNAL_PROBLEM_TYPES.serviceUnavailable
    })
  })

  it('forces logoff after an authenticated request receives a gateway error', async () => {
    const customer = customerDto({ id: 4, phone: '+79990000004', state:0, profile: { phone: '+79990000004' } })
    const fetch = withOps((url) => {
      if (url === '/api/v1/auth/code/verify') return Promise.resolve(response(200, {
        accessToken: 'active-token',
        expiresAt: '2026-08-30T00:15:00Z',
        customer
      }))
      if (url === '/api/v1/customers/me') return Promise.resolve(response(502, null, 'text/html'))
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)

    const session = useSession()
    await session.verifyCode({ phone: customer.phone, code: '1111' })
    await expect(session.updateProfile({ firstName:'Анна' })).rejects.toMatchObject({
      code: 'ui_service_unavailable',
      detail: 'Сервис недоступен. Пожалуйста, повторите позже.'
    })
    expect(session.customer.value).toBeNull()
    expect(session.notice.value).toBe('Сервис недоступен. Пожалуйста, повторите позже.')
  })

  it('uploads, refreshes, reads, and deletes a profile photo', async () => {
    const customer = customerDto({
      id: 4,
      phone: '+79990000004',
      state: 0,
      hasPhoto: false,
      profile: { phone: '+79990000004' }
    })
    const photo = new globalThis.Blob(['image'], { type: 'image/png' })
    let photoReads = 0
    const fetch = withOps((url) => {
      if (url === '/api/v1/auth/code/verify') {
        return Promise.resolve(response(200, {
          accessToken: 'photo-token',
          expiresAt: '2026-08-30T00:15:00Z',
          customer
        }))
      }
      if (url === '/api/v1/customers/me/photo') {
        const call = fetch.mock.calls.at(-1)[1]
        if (call.method === 'PUT') return Promise.resolve(response(204))
        if (call.method === 'DELETE') return Promise.resolve(response(204))
        photoReads += 1
        return Promise.resolve(photoReads === 1
          ? problemResponse(401, 'invalid-access-token', {
              title: 'Недействительный токен доступа',
              detail: 'Обновите сеанс и повторите запрос'
            })
          : response(200, photo, 'image/png'))
      }
      if (url === '/api/v1/auth/refresh') {
        return Promise.resolve(response(200, {
          accessToken: 'refreshed-photo-token',
          expiresAt: '2026-08-30T00:30:00Z',
          customer: { ...customer, hasPhoto: true }
        }))
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)

    const session = useSession()
    await session.verifyCode({ phone: customer.phone, code: '1111' })
    const file = new globalThis.File(['png'], 'photo.png', { type: 'image/png' })
    await session.uploadPhoto(file)
    expect(session.customer.value.hasPhoto).toBe(true)
    const uploadCall = fetch.mock.calls.find(([, options]) => options.method === 'PUT')
    expect(uploadCall[1].body.get('file')).toEqual(file)

    expect(await session.getPhoto()).toBe(photo)
    expect(fetch.mock.calls.at(-1)[1].headers.get('Authorization')).toBe('Bearer refreshed-photo-token')
    expect(fetch.mock.calls.at(-1)[1].headers.get('Accept')).toContain('application/problem+json')

    await session.deletePhoto()
    expect(session.customer.value.hasPhoto).toBe(false)
  })

  it('clears local state when logout fails and surfaces photo errors', async () => {
    const customer = customerDto({ id: 5, phone: '+79990000005', state:0, profile: { phone: '+79990000005' } })
    const fetch = withOps((url) => {
      if (url === '/api/v1/auth/code/verify') {
        return Promise.resolve(response(200, {
          accessToken: 'token',
          expiresAt: '2026-08-30T00:15:00Z',
          customer
        }))
      }
      if (url === '/api/v1/customers/me/photo') {
        return Promise.resolve(problemResponse(415, 'invalid-photo-type', {
          title: 'Недопустимый тип фотографии',
          detail: 'Фотография должна быть в формате JPEG, PNG или WebP'
        }))
      }
      if (url === '/api/v1/auth/logout') throw new Error('offline')
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)

    const session = useSession()
    await session.verifyCode({ phone: customer.phone, code: '1111' })
    await expect(session.getPhoto()).rejects.toMatchObject({
      message: 'Фотография должна быть в формате JPEG, PNG или WebP',
      status: 415,
      code: 'invalid_photo_type'
    })
    await expect(session.logout()).rejects.toMatchObject({
      type: INTERNAL_PROBLEM_TYPES.networkUnavailable,
      code: 'ui_network_unavailable'
    })
    expect(session.customer.value).toBeNull()
  })

  it('exposes a recoverable restore problem for infrastructure failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const session = useSession()
    await session.restoreSession()

    expect(session.customer.value).toBeNull()
    expect(session.restoreProblem.value).toMatchObject({
      type: INTERNAL_PROBLEM_TYPES.sessionRestoreUnavailable
    })
    expect(session.restoreProblem.value).not.toHaveProperty('status')
  })

  it('keeps a server restore failure recoverable without exposing its transport detail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      problemResponse(503, 'service-unavailable')
    ))

    const session = useSession()
    await session.restoreSession()

    expect(session.restoreProblem.value).toMatchObject({
      type: INTERNAL_PROBLEM_TYPES.sessionRestoreUnavailable
    })
    expect(session.notice.value).toBe('Сервис недоступен. Пожалуйста, повторите позже.')
    expect(loggerMocks.log.mock.calls.filter(([event]) => event === EVENTS.sessionRestoreFailed)).toHaveLength(1)
    expect(loggerMocks.log.mock.calls.some(([event, attributes, context]) =>
      event === EVENTS.apiRequestFailed
      && attributes['http.response.status_code'] === 503
      && attributes['sarafan.problem.code'] === 'service_unavailable'
      && context.traceId === TEST_TRACE_ID
    )).toBe(true)
  })
})
