// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PhoneAuthDialog from '../src/components/PhoneAuthDialog.vue'
import { createSarafanVuetify } from '../src/plugins/vuetify.js'
import { resetConsentsForTests } from '../src/stores/consents.js'
import { resetSessionForTests, useSession } from '../src/stores/session.js'
import { problemResponse, response } from './fixtures/http.js'

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
const legalOps = { kinds:[
  { value:0, name:'Согласие на использование куки', routeAlias:'cookie-consent' },
  { value:1, name:'Согласие на обработку персональных данных', routeAlias:'personal-data-consent' },
  { value:2, name:'Пользовательское соглашение', routeAlias:'user-agreement' },
  { value:3, name:'Правила заказа товаров', routeAlias:'order-rules' },
  { value:4, name:'Политика обработки персональных данных', routeAlias:'privacy-policy' }
], cookieCategories:[{ value:0, name:'Обязательные', required:true }] }
const documentIds = {
  1:'11111111-1111-1111-1111-111111111111',
  2:'22222222-2222-2222-2222-222222222222'
}
const customer = { id:9, phone:'+79991234567', state:0, hasPhoto:false, profile:{ phone:'+79991234567' } }

function legalDocument(url) {
  const kind = Number(url.slice(url.lastIndexOf('/') + 1))
  return {
    id:documentIds[kind],
    kind,
    displayVersion:'1',
    contentHash:`hash-${kind}`,
    cookieCategories:[]
  }
}

function mountView() {
  return mount(PhoneAuthDialog, {
    props: { modelValue:true },
    global: {
      plugins: [createSarafanVuetify()],
      stubs: {
        RouterLink: { template:'<a><slot /></a>' },
        VDialog: { props:['modelValue'], template:'<section v-if="modelValue"><slot /></section>' }
      }
    }
  })
}

function standardResponse(url) {
  if (url === '/api/v1/auth/ops') return response(200, authenticationOps)
  if (url === '/api/v1/customers/ops') return response(200, customerOps)
  if (url === '/api/v1/legal/ops') return response(200, legalOps)
  if (url.startsWith('/api/v1/legal/current/')) {
    return response(200, { serverNow:'2026-09-11T12:00:00Z', document:legalDocument(url) })
  }
  return null
}

describe('PhoneAuthDialog', () => {
  beforeEach(() => {
    resetSessionForTests()
    resetConsentsForTests()
  })

  afterEach(() => vi.unstubAllGlobals())

  it('uses the direct code flow for an active customer without exposing a mode selector', async () => {
    const fetch = vi.fn((url, options) => {
      const standard = standardResponse(url)
      if (standard) return Promise.resolve(standard)
      if (url === '/api/v1/auth/phone/resolve') return Promise.resolve(response(200, { nextStep:0, requiredDocumentKinds:[] }))
      if (url === '/api/v1/auth/code/request') return Promise.resolve(response(202, { onboardingToken:null }))
      if (url === '/api/v1/auth/code/verify') return Promise.resolve(response(200, {
        accessToken:'token', expiresAt:'2026-09-11T12:15:00Z', customer
      }))
      throw new Error(`Unexpected request: ${url} ${options?.method}`)
    })
    vi.stubGlobal('fetch', fetch)
    const wrapper = mountView()

    expect(wrapper.find('[role="tablist"]').exists()).toBe(false)
    await wrapper.get('input[name="phone"]').setValue('  +7 999 123-45-67  ')
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('input[name="code"]').exists()).toBe(true)
    expect(wrapper.find('.auth-back').exists()).toBe(false)
    expect(JSON.parse(fetch.mock.calls.find(([url]) => url.endsWith('/phone/resolve'))[1].body)).toEqual({
      phone:'+7 999 123-45-67'
    })
    expect(JSON.parse(fetch.mock.calls.find(([url]) => url.endsWith('/code/request'))[1].body)).toEqual({
      phone:'+7 999 123-45-67'
    })

    await wrapper.get('input[name="code"]').setValue(' 4567 ')
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()
    const verifyBody = JSON.parse(fetch.mock.calls.find(([url]) => url.endsWith('/code/verify'))[1].body)
    expect(verifyBody).toEqual({ phone:'+7 999 123-45-67', code:'4567' })
    expect(useSession().customer.value).toEqual(customer)

    await wrapper.setProps({ modelValue:false })
    await wrapper.setProps({ modelValue:true })
    expect(wrapper.get('input[name="phone"]').element.value).toBe('')
    expect(wrapper.find('input[name="code"]').exists()).toBe(false)
  })

  it('gradually changes an unknown phone to registration and sends both exact consents', async () => {
    const receipt = 'synthetic-onboarding-receipt-at-least-32-characters'
    const fetch = vi.fn(url => {
      const standard = standardResponse(url)
      if (standard) return Promise.resolve(standard)
      if (url === '/api/v1/auth/phone/resolve') return Promise.resolve(response(200, { nextStep:2, requiredDocumentKinds:[2, 1] }))
      if (url === '/api/v1/auth/code/request') return Promise.resolve(response(202, { onboardingToken:receipt }))
      if (url === '/api/v1/auth/code/verify') return Promise.resolve(response(200, {
        accessToken:'token', expiresAt:'2026-09-11T12:15:00Z', customer
      }))
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)
    const wrapper = mountView()

    await wrapper.get('input[name="phone"]').setValue('+79991234567')
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('h2').text()).toBe('Создайте аккаунт')
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(2)
    expect(wrapper.findAll('.consent-document-link')).toHaveLength(2)

    for (const checkbox of wrapper.findAll('input[type="checkbox"]')) await checkbox.setValue(true)
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()
    const requestBody = JSON.parse(fetch.mock.calls.find(([url]) => url.endsWith('/code/request'))[1].body)
    expect(requestBody).toMatchObject({
      phone:'+79991234567',
      termsAccepted:true,
      termsDocumentId:documentIds[2],
      personalDataConsent:{
        documentId:documentIds[1], contentHash:'hash-1', decision:'grant', categories:[]
      }
    })
    expect(requestBody).not.toHaveProperty('purpose')

    await wrapper.get('input[name="code"]').setValue('4567')
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()
    expect(JSON.parse(fetch.mock.calls.find(([url]) => url.endsWith('/code/verify'))[1].body)).toEqual({
      phone:'+79991234567', code:'4567', onboardingToken:receipt
    })
  })

  it.each([
    { nextStep:1, required:[2], title:'Продолжите вход', checkbox:'authentication-terms', omitted:'personalDataConsent' },
    { nextStep:2, required:[1], title:'Создайте аккаунт', checkbox:'authentication-personal-data', omitted:'termsAccepted' }
  ])('renders only the requirements selected by Ops for $title', async scenario => {
    const fetch = vi.fn(url => {
      const standard = standardResponse(url)
      if (standard) return Promise.resolve(standard)
      if (url === '/api/v1/auth/phone/resolve') {
        return Promise.resolve(response(200, { nextStep:scenario.nextStep, requiredDocumentKinds:scenario.required }))
      }
      if (url === '/api/v1/auth/code/request') {
        return Promise.resolve(response(202, { onboardingToken:'synthetic-onboarding-receipt-at-least-32-characters' }))
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)
    const wrapper = mountView()
    await wrapper.get('input[name="phone"]').setValue('+79991234567')
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('h2').text()).toBe(scenario.title)
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(1)
    await wrapper.get(`#${scenario.checkbox}`).setValue(true)
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()
    const body = JSON.parse(fetch.mock.calls.find(([url]) => url.endsWith('/code/request'))[1].body)
    expect(body).not.toHaveProperty(scenario.omitted)
  })

  it('shows field-specific errors until every required registration consent is selected', async () => {
    const fetch = vi.fn(url => {
      const standard = standardResponse(url)
      if (standard) return Promise.resolve(standard)
      if (url === '/api/v1/auth/phone/resolve') {
        return Promise.resolve(response(200, { nextStep:2, requiredDocumentKinds:[2, 1] }))
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)
    const wrapper = mountView()

    await wrapper.get('input[name="phone"]').setValue('+79991234567')
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('#authentication-terms-error').text()).toContain('Примите условия')
    expect(wrapper.get('#authentication-personal-error').text()).toContain('Дайте согласие')
    expect(wrapper.get('.form-error').text()).toContain('Подтвердите необходимые документы')
    expect(wrapper.get('#authentication-terms').attributes('aria-describedby')).toContain('authentication-terms-error')
    expect(wrapper.get('#authentication-personal-data').attributes('aria-describedby')).toContain('authentication-personal-error')
    expect(fetch.mock.calls.some(([url]) => url.endsWith('/code/request'))).toBe(false)
  })

  it('validates an empty phone locally and exposes the field error', async () => {
    const fetch = vi.fn(url => {
      const standard = standardResponse(url)
      if (standard) return Promise.resolve(standard)
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)
    const wrapper = mountView()

    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('.form-error').text()).toContain('Введите номер телефона')
    expect(wrapper.text()).toContain('Введите номер телефона')
    expect(fetch.mock.calls.some(([url]) => url.endsWith('/phone/resolve'))).toBe(false)
  })

  it('keeps the phone, refreshes requirements, and obtains a fresh code when verification requirements change', async () => {
    let resolves = 0
    let requests = 0
    const fetch = vi.fn(url => {
      const standard = standardResponse(url)
      if (standard) return Promise.resolve(standard)
      if (url === '/api/v1/auth/phone/resolve') {
        resolves += 1
        return Promise.resolve(response(200, resolves === 1
          ? { nextStep:0, requiredDocumentKinds:[] }
          : { nextStep:1, requiredDocumentKinds:[2] }))
      }
      if (url === '/api/v1/auth/code/request') {
        requests += 1
        return Promise.resolve(response(202, { onboardingToken:requests === 1 ? null : 'fresh-receipt-at-least-thirty-two-characters' }))
      }
      if (url === '/api/v1/auth/code/verify') return Promise.resolve(problemResponse(409, 'authentication-requirements-changed'))
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)
    const wrapper = mountView()
    await wrapper.get('input[name="phone"]').setValue('+79991234567')
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()
    await wrapper.get('input[name="code"]').setValue('4567')
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('h2').text()).toBe('Продолжите вход')
    expect(wrapper.text()).toContain('+79991234567')
    expect(wrapper.find('input[name="code"]').exists()).toBe(false)
    expect(resolves).toBe(2)
  })

  it('keeps the code step, clears a wrong code, and does not offer change or resend controls', async () => {
    const fetch = vi.fn(url => {
      const standard = standardResponse(url)
      if (standard) return Promise.resolve(standard)
      if (url === '/api/v1/auth/phone/resolve') return Promise.resolve(response(200, { nextStep:0, requiredDocumentKinds:[] }))
      if (url === '/api/v1/auth/code/request') return Promise.resolve(response(202, { onboardingToken:null }))
      if (url === '/api/v1/auth/code/verify') return Promise.resolve(problemResponse(401, 'invalid-code', {
        title:'Некорректный код подтверждения', detail:'Неверный код'
      }))
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)
    const wrapper = mountView()
    await wrapper.get('input[name="phone"]').setValue('+79991234567')
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()
    await wrapper.get('input[name="code"]').setValue('0000')
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('input[name="code"]').element.value).toBe('')
    expect(wrapper.get('.form-error').text()).toContain('Неверный код')
    expect(wrapper.text()).not.toContain('Изменить номер')
    expect(wrapper.text()).not.toContain('Отправить код повторно')
  })
})
