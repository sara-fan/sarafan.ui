// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AuthView from '../src/components/AuthView.vue'
import { createSarafanVuetify } from '../src/plugins/vuetify.js'
import { resetSessionForTests, useSession } from '../src/stores/session.js'
import { problemResponse, response } from './fixtures/http.js'

const legalOps = { kinds:[
  { value:0, name:'Согласие на куки', routeAlias:'cookie-consent' },
  { value:1, name:'Согласие на обработку персональных данных', routeAlias:'personal-data-consent' },
  { value:2, name:'Пользовательское соглашение', routeAlias:'user-agreement' },
  { value:3, name:'Правила заказа товаров', routeAlias:'order-rules' },
  { value:4, name:'Политика обработки персональных данных', routeAlias:'privacy-policy' }
], cookieCategories:[{ value:0, name:'Обязательные', required:true }] }
const legalDocument = (url, value = {}) => ({
  id:'11111111-1111-1111-1111-111111111111',
  kind:Number(url.slice(url.lastIndexOf('/') + 1)),
  contentHash:'hash',
  cookieCategories:[],
  ...value
})

function mountView() {
  return mount(AuthView, {
    global: { plugins: [createSarafanVuetify()] }
  })
}

describe('AuthView', () => {
  beforeEach(resetSessionForTests)

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('validates registration, consent, and server errors before authenticating', async () => {
    const customer = { id: 9, phone: '+79991234567', profile: { phone: '+79991234567' } }
    let requestAttempts = 0
    let verifyAttempts = 0
    const fetch = vi.fn((url) => {
      if (url === '/api/v1/legal/ops') return Promise.resolve(response(200, legalOps))
      if (url.startsWith('/api/v1/legal/current/')) return Promise.resolve(response(200, { serverNow:'2026-09-07T12:00:00Z', document:legalDocument(url, { displayVersion:'1' }) }))
      if (url === '/api/v1/auth/code/request') {
        requestAttempts += 1
        return Promise.resolve(requestAttempts === 1
          ? problemResponse(404, 'customer-not-found', {
              title: 'Пользователь не найден',
              detail: 'Код для регистрации недоступен'
            })
          : response(202, { onboardingToken: 'synthetic-onboarding-receipt-at-least-32-characters' }))
      }
      if (url === '/api/v1/auth/code/verify') {
        verifyAttempts += 1
        return Promise.resolve(verifyAttempts === 1
          ? problemResponse(401, 'invalid-code', {
              title: 'Некорректный код подтверждения',
              detail: 'Неверный код'
            })
          : response(200, {
              accessToken: 'token',
              expiresAt: '2026-08-30T00:15:00Z',
              customer
            }))
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)

    const wrapper = mountView()
    await wrapper.get('.auth-form').trigger('submit')
    expect(wrapper.get('.form-error').text()).toBe('Введите номер телефона')

    await wrapper.findAll('[role="tab"]')[1].trigger('click')
    await flushPromises()
    expect(wrapper.get('h1').text()).toBe('Создайте аккаунт')
    expect(wrapper.find('.consent-registration').exists()).toBe(true)
    expect(wrapper.findAll('.consent-document-link')).toHaveLength(2)
    expect(wrapper.find('.consent-registration__retry').text()).toBe('Обновить документы')
    const registrationConsents = wrapper.findAll('input[type="checkbox"]')
    expect(registrationConsents.every(item => !item.element.checked)).toBe(true)
    expect(registrationConsents[0].attributes('aria-describedby')).toBe('registration-terms-document')
    expect(registrationConsents[1].attributes('aria-describedby')).toBe('registration-personal-document')
    await wrapper.get('input[name="phone"]').setValue('+7 999 123-45-67')
    await wrapper.get('.auth-form').trigger('submit')
    expect(requestAttempts).toBe(0)
    const consents = wrapper.findAll('input[type="checkbox"]')
    await consents[0].setValue(true)
    await wrapper.get('.auth-form').trigger('submit')
    expect(requestAttempts).toBe(0)
    await consents[1].setValue(true)
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('.form-error').text()).toBe('Код для регистрации недоступен')

    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('Введите код')
    const registrationRequests = fetch.mock.calls
      .filter(([url]) => url === '/api/v1/auth/code/request')
      .map(([, options]) => JSON.parse(options.body))
    expect(registrationRequests).toHaveLength(2)
    expect(registrationRequests[0].personalDataConsent.idempotencyKey)
      .toBe(registrationRequests[1].personalDataConsent.idempotencyKey)
    expect(wrapper.text()).toContain('Код отправлен на +7 999 123-45-67')
    expect(wrapper.text()).not.toContain('используйте')

    await wrapper.get('.auth-form').trigger('submit')
    expect(wrapper.get('.form-error').text()).toBe('Введите код подтверждения')
    await wrapper.get('input[name="code"]').setValue('4567')
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('.form-error').text()).toBe('Неверный код')
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()
    expect(useSession().customer.value).toEqual(customer)

    await wrapper.get('.auth-back').trigger('click')
    expect(wrapper.get('input[name="phone"]').element.value).toBe('+7 999 123-45-67')
    await wrapper.findAll('[role="tab"]')[0].trigger('click')
    expect(wrapper.get('h1').text()).toBe('Рады видеть снова')
  })

  it('trims authentication values before sending them to the API', async () => {
    const customer = { id: 10, phone: '+79991234567', profile: { phone: '+79991234567' } }
    const fetch = vi.fn((url) => {
      if (url === '/api/v1/auth/code/request') return Promise.resolve(response(202, { message: 'sent' }))
      if (url === '/api/v1/auth/code/verify') {
        return Promise.resolve(response(200, {
          accessToken: 'token',
          expiresAt: '2026-08-30T00:15:00Z',
          customer
        }))
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)

    const wrapper = mountView()
    await wrapper.get('input[name="phone"]').setValue('  +7 999 123-45-67  ')
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      phone: '+7 999 123-45-67',
      purpose: 'login'
    })

    await wrapper.get('input[name="code"]').setValue('  4567  ')
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({
      phone: '+7 999 123-45-67',
      purpose: 'login',
      code: '4567'
    })
  })

  it('explains a missing login account and handles an unavailable service', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(problemResponse(404, 'customer-not-found', {
        title: 'Пользователь не найден',
        detail: 'Пользователь с таким телефоном не найден'
      }))
      .mockResolvedValueOnce(response(502, null, 'text/html'))
    vi.stubGlobal('fetch', fetch)

    const wrapper = mountView()
    await wrapper.get('input[name="phone"]').setValue('+7 999 000-00-00')
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('.form-error').text()).toContain('Пользователь с таким телефоном не найден')

    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('.form-error').text()).toBe('Сервис недоступен. Пожалуйста, повторите позже.')
  })

  it.each(['request', 'verify'])('requires fresh consent when the %s step rejects the displayed version', async phase => {
    const fetch = vi.fn(url => {
      if (url === '/api/v1/legal/ops') return Promise.resolve(response(200, legalOps))
      if (url.startsWith('/api/v1/legal/current/')) return Promise.resolve(response(200, { serverNow:'2026-09-07T12:00:00Z', document:legalDocument(url) }))
      if (url.endsWith('/request') && phase === 'verify') return Promise.resolve(response(202, { onboardingToken:'synthetic-onboarding-receipt-at-least-32-characters' }))
      return Promise.resolve(problemResponse(409, phase === 'request' ? 'consent-version-changed' : 'onboarding-consent-expired'))
    })
    vi.stubGlobal('fetch', fetch)
    const wrapper = mountView()
    await wrapper.findAll('[role="tab"]')[1].trigger('click'); await flushPromises()
    await wrapper.get('input[name="phone"]').setValue('+7 999 123-45-67')
    for (const checkbox of wrapper.findAll('input[type=checkbox]')) await checkbox.setValue(true)
    await wrapper.get('.auth-form').trigger('submit'); await flushPromises()
    if (phase === 'verify') {
      await wrapper.get('input[name="code"]').setValue('4567')
      await wrapper.get('.auth-form').trigger('submit'); await flushPromises()
    }
    expect(wrapper.find('input[name="phone"]').exists()).toBe(true)
    expect(wrapper.get('input[name="phone"]').element.value).toBe('+7 999 123-45-67')
    expect(wrapper.findAll('input[type=checkbox]').every(x => !x.element.checked)).toBe(true)
    expect(fetch.mock.calls.filter(x => x[0].startsWith('/api/v1/legal/current/'))).toHaveLength(4)
    expect(useSession().customer.value).toBeNull()
    wrapper.unmount()
  })

  it.each([null, 'short'])('does not send the verification step without a valid onboarding receipt: %s', async token => {
    vi.stubGlobal('fetch', vi.fn(url => Promise.resolve(url === '/api/v1/legal/ops'
      ? response(200, legalOps)
      : url.startsWith('/api/v1/legal/current/')
        ? response(200, { serverNow:'2026-09-07T12:00:00Z', document:legalDocument(url) })
        : response(202, { onboardingToken:token }))))
    const wrapper = mountView()
    await wrapper.findAll('[role="tab"]')[1].trigger('click'); await flushPromises()
    await wrapper.get('input[name="phone"]').setValue('+7 999 123-45-67')
    for (const checkbox of wrapper.findAll('input[type=checkbox]')) await checkbox.setValue(true)
    await wrapper.get('.auth-form').trigger('submit'); await flushPromises()
    expect(wrapper.find('input[name="code"]').exists()).toBe(false)
    expect(wrapper.get('.form-error').text()).toBeTruthy()
    wrapper.unmount()
  })

  it('keeps registration unavailable when either legal document is not effective', async () => {
    vi.stubGlobal('fetch', vi.fn(url => Promise.resolve(url === '/api/v1/legal/ops'
      ? response(200, legalOps)
      : response(200, { serverNow:'2026-09-07T12:00:00Z', document:null }))))
    const wrapper = mountView()
    await wrapper.findAll('[role="tab"]')[1].trigger('click'); await flushPromises()
    expect(wrapper.get('.form-error').text()).toContain('Нет действующих документов для регистрации')
    expect(wrapper.findAll('a[href^="#legal/"]')).toHaveLength(0)
    expect(wrapper.findAll('input[type="checkbox"]').every(item => item.attributes('aria-describedby') === undefined)).toBe(true)
    wrapper.unmount()
  })
})
