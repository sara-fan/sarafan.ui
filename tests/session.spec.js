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

describe('session store', () => {
  beforeEach(() => {
    resetSessionForTests()
    loggerMocks.log.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the bearer token for profile updates', async () => {
    const originalCustomer = {
      id: 1,
      phone: '+79990000001',
      state: 0,
      hasPhoto: false,
      profile: { phone: '+79990000001' }
    }
    const updatedCustomer = {
      ...originalCustomer,
      state: 1,
      profile: { ...originalCustomer.profile, firstName: 'Анна' }
    }
    const fetch = vi.fn((url) => {
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

  it('refreshes once and retries an authorized request after a 401', async () => {
    const customer = {
      id: 2,
      phone: '+79990000002',
      state: 1,
      hasPhoto: false,
      profile: { phone: '+79990000002', firstName: 'Иван' }
    }
    let profileAttempts = 0
    const fetch = vi.fn((url) => {
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
    const customer = { id: 3, phone: '+79990000003', profile: { phone: '+79990000003' } }
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(200, {
        accessToken: 'restored-token',
        expiresAt: '2026-08-30T00:15:00Z',
        customer
      }))
      .mockResolvedValueOnce(problemResponse(401, 'invalid-refresh-token', {
        title: 'Недействительный сеанс',
        detail: 'Войдите в систему повторно'
      }))
    vi.stubGlobal('fetch', fetch)

    const session = useSession()
    await Promise.all([session.restoreSession(), session.restoreSession()])
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(session.customer.value).toEqual(customer)
    expect(session.restoring.value).toBe(false)

    await session.restoreSession()
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

  it('forces logoff after an authenticated request receives a gateway error', async () => {
    const customer = { id: 4, phone: '+79990000004', profile: { phone: '+79990000004' } }
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(200, {
        accessToken: 'active-token',
        expiresAt: '2026-08-30T00:15:00Z',
        customer
      }))
      .mockResolvedValueOnce(response(502, null, 'text/html'))
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
    const customer = {
      id: 4,
      phone: '+79990000004',
      state: 0,
      hasPhoto: false,
      profile: { phone: '+79990000004' }
    }
    const photo = new globalThis.Blob(['image'], { type: 'image/png' })
    let photoReads = 0
    const fetch = vi.fn((url) => {
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
    const customer = { id: 5, phone: '+79990000005', profile: { phone: '+79990000005' } }
    const fetch = vi.fn((url) => {
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
