// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'

import { createInternalProblem } from '../src/errors/problem.js'
import { createSarafanVuetify } from '../src/plugins/vuetify.js'
import { createAppRouter } from '../src/router.js'
import { resetSessionForTests, useSession } from '../src/stores/session.js'
import ProfileView from '../src/views/ProfileView.vue'
import { problemResponse, response } from './fixtures/http.js'

const consent = vi.hoisted(() => ({
  requirePersonalData: vi.fn(),
  ops: { value: { kinds: [{ value: 4, routeAlias: 'privacy-policy' }] } }
}))
vi.mock('../src/stores/consents.js', () => ({ useConsents: () => consent }))

const originalUrl = globalThis.URL
let mountedWrapper

function sessionResponse(customer) {
  return response(200, { accessToken: 'profile-token', expiresAt: '2026-08-30T00:15:00Z', customer })
}

function deferred() {
  let resolve
  const promise = new Promise(resolvePromise => { resolve = resolvePromise })
  return { promise, resolve }
}

function mountView() {
  const router = createAppRouter(createMemoryHistory())
  router.push('/profile')
  mountedWrapper = mount(ProfileView, { global: { plugins: [createSarafanVuetify(), router] } })
  return mountedWrapper
}

async function setFile(input, file) {
  Object.defineProperty(input, 'files', { value: file ? [file] : [], configurable: true })
  input.dispatchEvent(new globalThis.Event('change', { bubbles: true }))
  await flushPromises()
}

async function startEditing(wrapper) {
  await wrapper.findAll('button').find(item => item.text() === 'Редактировать').trigger('click')
}

describe('ProfileView', () => {
  beforeEach(() => {
    resetSessionForTests()
    consent.requirePersonalData.mockReset().mockResolvedValue()
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn().mockReturnValue('blob:profile-photo'),
      revokeObjectURL: vi.fn()
    })
  })

  afterEach(() => {
    mountedWrapper?.unmount()
    mountedWrapper = null
    vi.unstubAllGlobals()
    globalThis.URL = originalUrl
  })

  it('loads, saves, replaces, removes, and presents customer profile data', async () => {
    const customer = {
      id: 12,
      phone: '+79991234567',
      state: 'preliminary',
      hasPhoto: true,
      profile: { lastName: 'Старая', firstName: null }
    }
    const updated = {
      ...customer,
      state: 'complete',
      profile: { ...customer.profile, lastName: 'Новая', firstName: 'Мария' }
    }
    const photo = new globalThis.Blob(['photo'], { type: 'image/png' })
    const fetch = vi.fn((url, options = {}) => {
      if (url === '/api/v1/auth/code/verify') return Promise.resolve(sessionResponse(customer))
      if (url === '/api/v1/customers/me' && options.method === 'PUT') return Promise.resolve(response(200, updated))
      if (url === '/api/v1/customers/me/photo' && options.method === 'PUT') return Promise.resolve(response(204))
      if (url === '/api/v1/customers/me/photo' && options.method === 'DELETE') return Promise.resolve(response(204))
      if (url === '/api/v1/customers/me/photo') return Promise.resolve(response(200, photo))
      if (url === '/api/v1/auth/logout') return Promise.resolve(response(204))
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)
    await useSession().verifyCode({ phone: customer.phone, purpose: 'login', code: '1111' })

    const wrapper = mountView()
    await vi.waitFor(() => expect(wrapper.find('.profile-avatar img').exists()).toBe(true))
    expect(wrapper.text()).toContain('Старая')
    expect(wrapper.findAll('.profile-privacy a')).toHaveLength(2)
    await startEditing(wrapper)

    const values = [
      'maria@example.test', 'Мария', 'Новая', 'Ивановна', '770123456789',
      '45 00', '123456', '2020-01-02', 'ОВД', 'Москва', '101000', 'Тверская, 1'
    ]
    const inputs = wrapper.findAll('form .ui-field__control')
    expect(inputs).toHaveLength(values.length)
    for (const [index, input] of inputs.entries()) await input.setValue(values[index])
    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => expect(wrapper.text()).toContain('Профиль сохранён'))
    const updateCall = fetch.mock.calls.find(([url]) => url === '/api/v1/customers/me')
    expect(JSON.parse(updateCall[1].body)).toMatchObject({
      lastName: 'Новая',
      firstName: 'Мария',
      passportIssueDate: '2020-01-02'
    })

    await startEditing(wrapper)
    const fileInput = wrapper.get('input[type="file"]').element
    await setFile(fileInput, new globalThis.File(['png'], 'profile.png', { type: 'image/png' }))
    expect(fetch.mock.calls.some(([, options]) => options.method === 'PUT' && options.body instanceof globalThis.FormData)).toBe(true)
    await wrapper.get('.photo-remove').trigger('click')
    expect(fetch.mock.calls.some(([, options]) => options.method === 'DELETE')).toBe(true)
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalled()

    await wrapper.findAll('button').find(item => item.text() === 'Отмена').trigger('click')
    await wrapper.findAll('button').find(item => item.text() === 'Выйти').trigger('click')
    expect(fetch.mock.calls.some(([url]) => url === '/api/v1/auth/logout')).toBe(true)
  })

  it('retains editable data when current personal-data consent is required', async () => {
    const customer = { id: 13, phone: '+79991234567', hasPhoto: false, profile: { firstName: 'Мария' } }
    const fetch = vi.fn(() => Promise.resolve(sessionResponse(customer)))
    vi.stubGlobal('fetch', fetch)
    await useSession().verifyCode({ phone: customer.phone, purpose: 'login', code: '4567' })
    const wrapper = mountView()
    await startEditing(wrapper)
    consent.requirePersonalData.mockRejectedValue(createInternalProblem('invalidInput', { detail: 'Требуется актуальное согласие' }))
    await wrapper.get('form').trigger('submit')
    expect(wrapper.text()).toContain('Требуется актуальное согласие')
    expect(wrapper.findAll('form .ui-field__control')[1].element.value).toBe('Мария')
    await setFile(wrapper.get('input[type="file"]').element, new globalThis.File(['png'], 'photo.png', { type: 'image/png' }))
    expect(consent.requirePersonalData).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('ignores a photo response that arrives after unmount', async () => {
    const customer = { id: 14, phone: '+79990000014', hasPhoto: true, profile: {} }
    const pendingPhoto = deferred()
    vi.stubGlobal('fetch', vi.fn(url => {
      if (url === '/api/v1/auth/code/verify') return Promise.resolve(sessionResponse(customer))
      if (url === '/api/v1/customers/me/photo') return pendingPhoto.promise
      throw new Error(`Unexpected request: ${url}`)
    }))
    await useSession().verifyCode({ phone: customer.phone, purpose: 'login', code: '1111' })
    const wrapper = mountView()
    wrapper.unmount()
    mountedWrapper = null
    pendingPhoto.resolve(response(200, new globalThis.Blob(['stale'])))
    await flushPromises()
    expect(globalThis.URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('keeps editing usable when profile and photo operations fail or input is invalid', async () => {
    const customer = { id: 15, phone: '+79990000015', hasPhoto: true, profile: {} }
    const fetch = vi.fn((url, options = {}) => {
      if (url === '/api/v1/auth/code/verify') return Promise.resolve(sessionResponse(customer))
      if (url === '/api/v1/customers/me') return Promise.resolve(problemResponse(400, 'validation-failed', { detail: 'Профиль не сохранён', errors: { firstName: ['Проверьте имя'] } }))
      if (url === '/api/v1/customers/me/photo' && options.method === 'PUT') return Promise.resolve(problemResponse(400, 'invalid-photo-content', { detail: 'Фото не загружено' }))
      if (url === '/api/v1/customers/me/photo' && options.method === 'DELETE') return Promise.resolve(problemResponse(409, 'photo-delete-failed', { detail: 'Фото не удалено' }))
      if (url === '/api/v1/customers/me/photo') return Promise.resolve(problemResponse(404, 'photo-not-found', { detail: 'Фотография временно недоступна' }))
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)
    await useSession().verifyCode({ phone: customer.phone, purpose: 'login', code: '1111' })
    const wrapper = mountView()
    await flushPromises()
    await startEditing(wrapper)
    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => expect(wrapper.text()).toContain('Профиль не сохранён'))
    const fileInput = wrapper.get('input[type="file"]').element
    await setFile(fileInput, null)
    await setFile(fileInput, new globalThis.File(['text'], 'bad.txt', { type: 'text/plain' }))
    expect(wrapper.text()).toContain('Выберите JPEG')
    await setFile(fileInput, new globalThis.File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }))
    expect(wrapper.text()).toContain('не более 5 МБ')
    await setFile(fileInput, new globalThis.File(['png'], 'valid.png', { type: 'image/png' }))
    await vi.waitFor(() => expect(wrapper.text()).toContain('Фото не загружено'))
    await wrapper.get('.photo-remove').trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).toContain('Фото не удалено'))
  })
})
