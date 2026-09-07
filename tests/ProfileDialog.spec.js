// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ProfileDialog from '../src/components/ProfileDialog.vue'
import { createSarafanVuetify } from '../src/plugins/vuetify.js'
import { resetSessionForTests, useSession } from '../src/stores/session.js'
import { problemResponse, response } from './fixtures/http.js'

const originalUrl = globalThis.URL

function sessionResponse(customer) {
  return response(200, {
    accessToken: 'profile-token',
    expiresAt: '2026-08-30T00:15:00Z',
    customer
  })
}

function deferred() {
  let resolve
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function mountDialog() {
  return mount(ProfileDialog, {
    props: { modelValue: false },
    attachTo: document.body,
    global: { plugins: [createSarafanVuetify()] }
  })
}

async function setFile(input, file) {
  Object.defineProperty(input, 'files', { value: file ? [file] : [], configurable: true })
  input.dispatchEvent(new globalThis.Event('change', { bubbles: true }))
  await flushPromises()
}

describe('ProfileDialog', () => {
  beforeEach(() => {
    resetSessionForTests()
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn().mockReturnValue('blob:profile-photo'),
      revokeObjectURL: vi.fn()
    })
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
    globalThis.URL = originalUrl
  })

  it('loads, saves, replaces, and removes customer profile data', async () => {
    const customer = {
      id: 12,
      phone: '+79991234567',
      state: 'preliminary',
      hasPhoto: true,
      profile: {
        phone: '+79991234567',
        lastName: 'Старая',
        firstName: null
      }
    }
    const updated = {
      ...customer,
      state: 'complete',
      profile: { ...customer.profile, lastName: 'Новая', firstName: 'Мария' }
    }
    const photo = new globalThis.Blob(['photo'], { type: 'image/png' })
    const fetch = vi.fn((url, options) => {
      if (url === '/api/v1/auth/code/verify') return Promise.resolve(sessionResponse(customer))
      if (url === '/api/v1/customers/me' && options.method === 'PUT') return Promise.resolve(response(200, updated))
      if (url === '/api/v1/customers/me/photo' && options.method === 'PUT') return Promise.resolve(response(204))
      if (url === '/api/v1/customers/me/photo' && options.method === 'DELETE') return Promise.resolve(response(204))
      if (url === '/api/v1/customers/me/photo') return Promise.resolve(response(200, photo))
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)
    await useSession().verifyCode({ phone: customer.phone, purpose: 'login', code: '1111' })

    const wrapper = mountDialog()
    await wrapper.setProps({ modelValue: true })
    await vi.waitFor(() => expect(document.querySelector('.profile-photo__preview img')).not.toBeNull())
    expect(globalThis.URL.createObjectURL).toHaveBeenCalledWith(photo)

    const inputs = [...document.querySelectorAll('.profile-grid input')]
    const values = [
      'Новая', 'Мария', 'Ивановна', 'maria@example.test', '770123456789', '101000',
      'Москва', 'Тверская, 1', '45 00', '123456', '2020-01-02', 'ОВД'
    ]
    expect(inputs).toHaveLength(values.length)
    for (const [index, input] of inputs.entries()) {
      input.value = values[index]
      input.dispatchEvent(new globalThis.Event('input', { bubbles: true }))
    }

    document.querySelector('.profile-dialog form').dispatchEvent(
      new globalThis.Event('submit', { bubbles: true, cancelable: true })
    )
    await vi.waitFor(() => expect(document.querySelector('.form-success')).not.toBeNull())
    const updateCall = fetch.mock.calls.find(([url]) => url === '/api/v1/customers/me')
    expect(JSON.parse(updateCall[1].body)).toMatchObject({
      lastName: 'Новая',
      firstName: 'Мария',
      passportIssueDate: '2020-01-02'
    })

    const fileInput = document.querySelector('input[type="file"]')
    const file = new globalThis.File(['png'], 'profile.png', { type: 'image/png' })
    await setFile(fileInput, file)
    await vi.waitFor(() => {
      expect(fetch.mock.calls.some(([, options]) => options.method === 'PUT' && options.body instanceof globalThis.FormData)).toBe(true)
    })

    document.querySelector('.photo-remove').click()
    await vi.waitFor(() => {
      expect(fetch.mock.calls.some(([, options]) => options.method === 'DELETE')).toBe(true)
    })
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalled()

    await wrapper.findComponent({ name: 'VDialog' }).vm.$emit('update:modelValue', false)
    expect(wrapper.emitted('update:modelValue')).toContainEqual([false])
    const buttons = wrapper.findAllComponents({ name: 'VBtn' })
    await buttons[0].trigger('click')
    const cancelButton = [...document.querySelectorAll('.profile-dialog__actions button')]
      .find((button) => button.textContent.includes('Отмена'))
    await vi.waitFor(() => expect(cancelButton.disabled).toBe(false))
    cancelButton.click()
    await flushPromises()
    expect(wrapper.emitted('update:modelValue').filter(([value]) => value === false).length).toBeGreaterThan(2)

    await wrapper.setProps({ modelValue: false })
    await wrapper.setProps({ modelValue: true })
    await vi.waitFor(() => expect(globalThis.URL.createObjectURL).toHaveBeenCalledTimes(2))
    wrapper.unmount()
  })

  it('ignores stale photo loads after the dialog is closed and reopened', async () => {
    const customer = {
      id: 14,
      phone: '+79990000014',
      state: 'preliminary',
      hasPhoto: true,
      profile: { phone: '+79990000014' }
    }
    const stalePhoto = new globalThis.Blob(['stale'], { type: 'image/png' })
    const latestPhoto = new globalThis.Blob(['latest'], { type: 'image/png' })
    const firstPhotoResponse = deferred()
    const secondPhotoResponse = deferred()
    let photoReads = 0
    const fetch = vi.fn((url) => {
      if (url === '/api/v1/auth/code/verify') return Promise.resolve(sessionResponse(customer))
      if (url === '/api/v1/customers/me/photo') {
        photoReads += 1
        return photoReads === 1 ? firstPhotoResponse.promise : secondPhotoResponse.promise
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)
    globalThis.URL.createObjectURL.mockImplementation((photo) =>
      photo === latestPhoto ? 'blob:latest-photo' : 'blob:stale-photo'
    )
    await useSession().verifyCode({ phone: customer.phone, purpose: 'login', code: '1111' })

    const wrapper = mountDialog()
    await wrapper.setProps({ modelValue: true })
    await vi.waitFor(() => expect(photoReads).toBe(1))
    await wrapper.setProps({ modelValue: false })
    await wrapper.setProps({ modelValue: true })
    await vi.waitFor(() => expect(photoReads).toBe(2))

    secondPhotoResponse.resolve(response(200, latestPhoto))
    await vi.waitFor(() => {
      expect(document.querySelector('.profile-photo__preview img')?.getAttribute('src'))
        .toBe('blob:latest-photo')
    })
    firstPhotoResponse.resolve(response(200, stalePhoto))
    await flushPromises()
    expect(globalThis.URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(globalThis.URL.createObjectURL).toHaveBeenCalledWith(latestPhoto)

    await wrapper.setProps({ modelValue: false })
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('blob:latest-photo')
    wrapper.unmount()
  })

  it('keeps the form usable when profile and photo operations fail', async () => {
    const customer = {
      id: 13,
      phone: '+79990000013',
      state: 'preliminary',
      hasPhoto: true,
      profile: { phone: '+79990000013' }
    }
    let photoReads = 0
    const fetch = vi.fn((url, options) => {
      if (url === '/api/v1/auth/code/verify') return Promise.resolve(sessionResponse(customer))
      if (url === '/api/v1/customers/me') {
        return Promise.resolve(problemResponse(400, 'validation-failed', {
          title: 'Некорректный запрос',
          detail: 'Профиль не сохранён',
          errors: { firstName: ['Проверьте имя'] }
        }))
      }
      if (url === '/api/v1/customers/me/photo' && options.method === 'PUT') {
        return Promise.resolve(problemResponse(400, 'invalid-photo-content', {
          title: 'Некорректное содержимое фотографии',
          detail: 'Фото не загружено'
        }))
      }
      if (url === '/api/v1/customers/me/photo' && options.method === 'DELETE') {
        return Promise.resolve(problemResponse(409, 'photo-delete-failed', {
          title: 'Фотография не удалена',
          detail: 'Фото не удалено'
        }))
      }
      if (url === '/api/v1/customers/me/photo') {
        photoReads += 1
        return Promise.resolve(photoReads === 1
          ? problemResponse(404, 'photo-not-found', {
              title: 'Фотография не найдена',
              detail: 'Фотография временно недоступна'
            })
          : response(200, new globalThis.Blob(['photo']), 'image/png'))
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)
    await useSession().verifyCode({ phone: customer.phone, purpose: 'login', code: '1111' })

    const wrapper = mountDialog()
    await wrapper.setProps({ modelValue: true })
    await vi.waitFor(() => expect(photoReads).toBe(1))
    expect(document.querySelector('.profile-photo__preview img')).toBeNull()

    document.querySelector('.profile-dialog form').dispatchEvent(
      new globalThis.Event('submit', { bubbles: true, cancelable: true })
    )
    await vi.waitFor(() => expect(document.querySelector('.form-error').textContent).toContain('Профиль не сохранён'))

    const fileInput = document.querySelector('input[type="file"]')
    await setFile(fileInput, null)
    await setFile(fileInput, new globalThis.File(['text'], 'bad.txt', { type: 'text/plain' }))
    expect(document.querySelector('.form-error').textContent).toContain('Выберите JPEG')
    await setFile(fileInput, new globalThis.File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }))
    expect(document.querySelector('.form-error').textContent).toContain('не более 5 МБ')

    await setFile(fileInput, new globalThis.File(['png'], 'valid.png', { type: 'image/png' }))
    await vi.waitFor(() => expect(document.querySelector('.form-error').textContent).toContain('Фото не загружено'))

    document.querySelector('.photo-remove').click()
    await vi.waitFor(() => expect(document.querySelector('.form-error').textContent).toContain('Фото не удалено'))
    wrapper.unmount()
  })
})
