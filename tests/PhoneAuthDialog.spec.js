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
    locale:'ru',
    title:`Документ ${kind}`,
    displayVersion:'1',
    html:'<p>Текст</p>',
    sourceHash:'a'.repeat(64),
    contentHash:String(kind).repeat(64),
    rendererVersion:'sarafan-safe-markdown-1/markdig-1.3.2',
    cookieCategories:[],
    effectiveAt:'2026-09-10T21:00:00Z',
    createdAt:'2026-09-09T12:00:00Z',
    createdBy:null,
    effectiveLocalDate:'2026-09-11',
    effectiveTimeZone:'Europe/Moscow',
    canDelete:null
  }
}

function mountView(attachTo) {
  return mount(PhoneAuthDialog, {
    props: { modelValue:true },
    ...(attachTo ? { attachTo } : {}),
    global: {
      plugins: [createSarafanVuetify()],
      stubs: {
        RouterLink: { template:'<a><slot /></a>' },
        VDialog: { props:['modelValue'], template:'<section v-if="modelValue"><slot /></section>' }
      }
    }
  })
}

function deferred() {
  let resolve
  const promise = new Promise(accept => { resolve = accept })
  return { promise, resolve }
}

function standardResponse(url) {
  if (url === '/api/v1/auth/ops') return response(200, authenticationOps)
  if (url === '/api/v1/customers/ops') return response(200, customerOps)
  if (url === '/api/v1/legal/ops') return response(200, legalOps)
  if (url.startsWith('/api/v1/legal/current/')) {
    return response(200, { serverNow:'2026-09-11T12:00:00Z', nextChangeAt:null, document:legalDocument(url) })
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

  it.each(['verification', 'restoration'])('clears the stale %s notice when the dialog reopens', async failure => {
    const fetch = vi.fn(url => {
      const standard = standardResponse(url)
      if (standard) return Promise.resolve(standard)
      if (url === '/api/v1/auth/phone/resolve') {
        return Promise.resolve(response(200, { nextStep:0, requiredDocumentKinds:[] }))
      }
      if (url === '/api/v1/auth/code/request') return Promise.resolve(response(202, { onboardingToken:null }))
      if (url === '/api/v1/auth/code/verify' || url === '/api/v1/auth/refresh') {
        return Promise.resolve(problemResponse(503, 'service-unavailable'))
      }
      throw new Error('Unexpected request')
    })
    vi.stubGlobal('fetch', fetch)
    const session = useSession()
    if (failure === 'restoration') await session.restoreSession()
    const wrapper = mountView()
    if (failure === 'verification') {
      await wrapper.get('input[name="phone"]').setValue('+79991234567')
      await wrapper.get('.auth-form').trigger('submit')
      await flushPromises()
      await wrapper.get('input[name="code"]').setValue('4567')
      await wrapper.get('.auth-form').trigger('submit')
      await flushPromises()
    }
    expect(wrapper.get('.form-error').text()).toContain('Сервис недоступен. Пожалуйста, повторите позже.')
    expect(session.notice.value).toBe('Сервис недоступен. Пожалуйста, повторите позже.')
    const requestCount = fetch.mock.calls.length

    await wrapper.setProps({ modelValue:false })
    await wrapper.setProps({ modelValue:true })
    await flushPromises()

    expect(wrapper.get('input[name="phone"]').element.value).toBe('')
    expect(wrapper.find('.form-error').exists()).toBe(false)
    expect(session.notice.value).toBe('')
    expect(session.customer.value).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(requestCount)
  })

  it('focuses the confirmation code field when the code step opens', async () => {
    const fetch = vi.fn(url => {
      const standard = standardResponse(url)
      if (standard) return Promise.resolve(standard)
      if (url === '/api/v1/auth/phone/resolve') {
        return Promise.resolve(response(200, { nextStep:0, requiredDocumentKinds:[] }))
      }
      if (url === '/api/v1/auth/code/request') {
        return Promise.resolve(response(202, { onboardingToken:null }))
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)
    const wrapper = mountView(globalThis.document.body)

    await wrapper.get('input[name="phone"]').setValue('+79991234567')
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()

    expect(globalThis.document.activeElement).toBe(wrapper.get('input[name="code"]').element)
    wrapper.unmount()
  })

  it('ignores a phone resolution completed after the dialog is reopened', async () => {
    const pending = deferred()
    const fetch = vi.fn(url => {
      const standard = standardResponse(url)
      if (standard) return Promise.resolve(standard)
      if (url === '/api/v1/auth/phone/resolve') return pending.promise
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)
    const wrapper = mountView()

    await wrapper.get('input[name="phone"]').setValue('+79991234567')
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()
    await wrapper.setProps({ modelValue:false })
    await wrapper.setProps({ modelValue:true })
    pending.resolve(response(200, { nextStep:2, requiredDocumentKinds:[2, 1] }))
    await flushPromises()

    expect(wrapper.get('input[name="phone"]').element.value).toBe('')
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
    expect(fetch.mock.calls.some(([url]) => url.startsWith('/api/v1/legal/current/'))).toBe(false)
  })

  it.each(['close', 'replacement', 'unmount'])('aborts phone resolution on dialog %s', async action => {
    const signals = []
    const fetch = vi.fn((url, options) => {
      const standard = standardResponse(url)
      if (standard) return Promise.resolve(standard)
      if (url === '/api/v1/auth/phone/resolve') {
        signals.push(options.signal)
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort',
            () => reject(new globalThis.DOMException('Aborted', 'AbortError')), { once:true })
        })
      }
      throw new Error('Unexpected request')
    })
    vi.stubGlobal('fetch', fetch)
    const wrapper = mountView()
    await wrapper.get('input[name="phone"]').setValue('+79991234567')
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()
    expect(signals).toHaveLength(1)
    expect(signals[0].aborted).toBe(false)

    if (action === 'unmount') wrapper.unmount()
    else if (action === 'replacement') await wrapper.get('.auth-form').trigger('submit')
    else await wrapper.setProps({ modelValue:false })
    await flushPromises()

    expect(signals[0].aborted).toBe(true)
    expect(fetch.mock.calls.some(([url]) => url === '/api/v1/auth/code/request')).toBe(false)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    if (action === 'replacement') {
      expect(signals).toHaveLength(2)
      expect(signals[1].aborted).toBe(false)
      expect(wrapper.get('input[name="phone"]').attributes('disabled')).toBeDefined()
      await wrapper.setProps({ modelValue:false })
      expect(signals[1].aborted).toBe(true)
    }
    if (action !== 'unmount') {
      await wrapper.setProps({ modelValue:true })
      await flushPromises()
      expect(wrapper.get('input[name="phone"]').element.value).toBe('')
      expect(wrapper.find('.form-error').exists()).toBe(false)
      expect(wrapper.find('input[name="code"]').exists()).toBe(false)
    }
  })

  it('resolves only the reopened phone after shared authentication Ops finish loading', async () => {
    const pendingOps = deferred()
    const fetch = vi.fn(url => {
      if (url === '/api/v1/auth/ops') return pendingOps.promise
      const standard = standardResponse(url)
      if (standard) return Promise.resolve(standard)
      if (url === '/api/v1/auth/phone/resolve') {
        return Promise.resolve(response(200, { nextStep:0, requiredDocumentKinds:[] }))
      }
      if (url === '/api/v1/auth/code/request') return Promise.resolve(response(202, { onboardingToken:null }))
      throw new Error('Unexpected request')
    })
    vi.stubGlobal('fetch', fetch)
    const wrapper = mountView()
    await wrapper.get('input[name="phone"]').setValue('+79991234567')
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()
    await wrapper.setProps({ modelValue:false })
    await wrapper.setProps({ modelValue:true })
    await wrapper.get('input[name="phone"]').setValue('+79991234568')
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()

    pendingOps.resolve(response(200, authenticationOps))
    await flushPromises()

    const resolutions = fetch.mock.calls.filter(([url]) => url === '/api/v1/auth/phone/resolve')
    expect(resolutions).toHaveLength(1)
    expect(JSON.parse(resolutions[0][1].body)).toEqual({ phone:'+79991234568' })
    expect(wrapper.find('input[name="code"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('+79991234568')
    expect(wrapper.find('.form-error').exists()).toBe(false)
  })

  it('ignores legal documents completed after the dialog is reopened', async () => {
    const pendingAgreement = deferred()
    const pendingPersonal = deferred()
    const fetch = vi.fn(url => {
      if (url === '/api/v1/legal/current/2') return pendingAgreement.promise
      if (url === '/api/v1/legal/current/1') return pendingPersonal.promise
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
    await wrapper.setProps({ modelValue:false })
    await wrapper.setProps({ modelValue:true })
    pendingAgreement.resolve(standardResponse('/api/v1/legal/current/2'))
    pendingPersonal.resolve(standardResponse('/api/v1/legal/current/1'))
    await flushPromises()

    expect(wrapper.get('input[name="phone"]').element.value).toBe('')
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
  })

  it('stops a stale requirements load after the legal Ops request completes', async () => {
    const pendingOps = deferred()
    const fetch = vi.fn(url => {
      if (url === '/api/v1/legal/ops') return pendingOps.promise
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
    await wrapper.setProps({ modelValue:false })
    await wrapper.setProps({ modelValue:true })
    pendingOps.resolve(response(200, legalOps))
    await flushPromises()

    expect(wrapper.get('input[name="phone"]').element.value).toBe('')
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
    expect(fetch.mock.calls.some(([url]) => url.startsWith('/api/v1/legal/current/'))).toBe(false)
  })

  it('aborts a direct code request when the dialog is reopened', async () => {
    let requestSignal = null
    const fetch = vi.fn((url, options) => {
      const standard = standardResponse(url)
      if (standard) return Promise.resolve(standard)
      if (url === '/api/v1/auth/phone/resolve') {
        return Promise.resolve(response(200, { nextStep:0, requiredDocumentKinds:[] }))
      }
      if (url === '/api/v1/auth/code/request') {
        requestSignal = options.signal
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener(
            'abort',
            () => reject(new globalThis.DOMException('Aborted', 'AbortError')),
            { once:true }
          )
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)
    const wrapper = mountView()

    await wrapper.get('input[name="phone"]').setValue('+79991234567')
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()
    expect(requestSignal).not.toBeNull()

    await wrapper.setProps({ modelValue:false })
    await wrapper.setProps({ modelValue:true })
    await flushPromises()

    expect(requestSignal.aborted).toBe(true)
    expect(wrapper.get('input[name="phone"]').element.value).toBe('')
    expect(wrapper.find('input[name="code"]').exists()).toBe(false)
  })

  it('aborts a requirements code request when the dialog is reopened', async () => {
    let requestSignal = null
    const fetch = vi.fn((url, options) => {
      const standard = standardResponse(url)
      if (standard) return Promise.resolve(standard)
      if (url === '/api/v1/auth/phone/resolve') {
        return Promise.resolve(response(200, { nextStep:2, requiredDocumentKinds:[2, 1] }))
      }
      if (url === '/api/v1/auth/code/request') {
        requestSignal = options.signal
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener(
            'abort',
            () => reject(new globalThis.DOMException('Aborted', 'AbortError')),
            { once:true }
          )
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)
    const wrapper = mountView()

    await wrapper.get('input[name="phone"]').setValue('+79991234567')
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()
    for (const checkbox of wrapper.findAll('input[type="checkbox"]')) await checkbox.setValue(true)
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()
    expect(requestSignal).not.toBeNull()

    await wrapper.setProps({ modelValue:false })
    await wrapper.setProps({ modelValue:true })
    await flushPromises()

    expect(requestSignal.aborted).toBe(true)
    expect(wrapper.get('input[name="phone"]').element.value).toBe('')
    expect(wrapper.find('input[name="code"]').exists()).toBe(false)
  })

  it('does not let a stale verification replace the session from a reopened dialog', async () => {
    const pendingVerification = deferred()
    const firstCustomer = { ...customer, id:8, phone:'+79991234568' }
    const currentCustomer = { ...customer, id:9, phone:'+79991234569' }
    let staleVerificationSignal = null
    const fetch = vi.fn((url, options) => {
      const standard = standardResponse(url)
      if (standard) return Promise.resolve(standard)
      if (url === '/api/v1/auth/phone/resolve') {
        return Promise.resolve(response(200, { nextStep:0, requiredDocumentKinds:[] }))
      }
      if (url === '/api/v1/auth/code/request') return Promise.resolve(response(202, { onboardingToken:null }))
      if (url === '/api/v1/auth/code/verify') {
        const body = JSON.parse(options.body)
        if (body.phone === firstCustomer.phone) {
          staleVerificationSignal = options.signal
          return new Promise((resolve, reject) => {
            options.signal.addEventListener(
              'abort',
              () => reject(new globalThis.DOMException('Aborted', 'AbortError')),
              { once:true }
            )
            pendingVerification.promise.then(resolve, reject)
          })
        }
        return Promise.resolve(response(200, {
              accessToken:'current-token', expiresAt:'2026-09-11T12:15:00Z', customer:currentCustomer
            }))
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)
    const wrapper = mountView()

    await wrapper.get('input[name="phone"]').setValue(firstCustomer.phone)
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()
    await wrapper.get('input[name="code"]').setValue('4568')
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()

    await wrapper.setProps({ modelValue:false })
    await wrapper.setProps({ modelValue:true })
    expect(staleVerificationSignal?.aborted).toBe(true)
    await wrapper.get('input[name="phone"]').setValue(currentCustomer.phone)
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()
    await wrapper.get('input[name="code"]').setValue('4569')
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()
    expect(useSession().customer.value).toEqual(currentCustomer)

    pendingVerification.resolve(response(200, {
      accessToken:'stale-token', expiresAt:'2026-09-11T12:15:00Z', customer:firstCustomer
    }))
    await flushPromises()

    expect(useSession().customer.value).toEqual(currentCustomer)
  })

  it('displays both legal-kind names from the Core Ops catalogue', async () => {
    const agreementName = 'Условия сервиса из каталога'
    const personalDataName = 'Согласие на данные из каталога'
    const fetch = vi.fn(url => {
      if (url === '/api/v1/legal/ops') return Promise.resolve(response(200, {
        ...legalOps,
        kinds:legalOps.kinds.map(item => ({ ...item,
          name:item.value === 2 ? agreementName : item.value === 1 ? personalDataName : item.name
        }))
      }))
      const standard = standardResponse(url)
      if (standard) return Promise.resolve(standard)
      if (url === '/api/v1/auth/phone/resolve') {
        return Promise.resolve(response(200, { nextStep:2, requiredDocumentKinds:[2, 1] }))
      }
      throw new Error('Unexpected request')
    })
    vi.stubGlobal('fetch', fetch)
    const wrapper = mountView()
    await wrapper.get('input[name="phone"]').setValue('+79991234567')
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()

    expect(wrapper.findAll('.consent-registration small').map(item => item.text())).toEqual([
      agreementName + ' · версия 1', personalDataName + ' · версия 1'
    ])
    expect(wrapper.findAll('.consent-document-link').map(item => item.text())).toEqual([
      `Открыть ${agreementName.toLowerCase()}`,
      `Открыть ${personalDataName.toLowerCase()}`
    ])
  })

  it('uses the Core Ops agreement name in the login consent text and link', async () => {
    const agreementName = 'Условия сервиса из каталога'
    const fetch = vi.fn(url => {
      if (url === '/api/v1/legal/ops') return Promise.resolve(response(200, {
        ...legalOps,
        kinds:legalOps.kinds.map(item => ({ ...item, name:item.value === 2 ? agreementName : item.name }))
      }))
      const standard = standardResponse(url)
      if (standard) return Promise.resolve(standard)
      if (url === '/api/v1/auth/phone/resolve') {
        return Promise.resolve(response(200, { nextStep:1, requiredDocumentKinds:[2] }))
      }
      throw new Error('Unexpected request')
    })
    vi.stubGlobal('fetch', fetch)
    const wrapper = mountView()
    await wrapper.get('input[name="phone"]').setValue('+79991234567')
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain(
      `Чтобы продолжить вход для +79991234567, примите актуальное ${agreementName.toLowerCase()}.`
    )
    expect(wrapper.get('.consent-document-link').text()).toBe(`Открыть ${agreementName.toLowerCase()}`)
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
        documentId:documentIds[1], contentHash:'1'.repeat(64), decision:'grant', categories:[]
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
    { title:'unknown legal kind', nextStep:2, required:[2, 99] },
    { title:'agreement with the wrong document', nextStep:1, required:[1] },
    { title:'agreement with multiple documents', nextStep:1, required:[2, 1] },
    { title:'registration without personal-data consent', nextStep:2, required:[2] },
    { title:'registration with an unrelated document', nextStep:2, required:[1, 4] },
    { title:'code flow with documents', nextStep:0, required:[2] },
    { title:'registration without documents', nextStep:2, required:[] }
  ])('fails closed on $title', async scenario => {
    const fetch = vi.fn(url => {
      const standard = standardResponse(url)
      if (standard) return Promise.resolve(standard)
      if (url === '/api/v1/auth/phone/resolve') {
        return Promise.resolve(response(200, {
          nextStep:scenario.nextStep,
          requiredDocumentKinds:scenario.required
        }))
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)
    const wrapper = mountView()

    await wrapper.get('input[name="phone"]').setValue('+79991234567')
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('input[name="phone"]').exists()).toBe(true)
    expect(wrapper.find('.form-error').exists()).toBe(true)
  })

  it.each([
    {
      title:'network',
      legalResponse:() => Promise.reject(new TypeError('private network failure'))
    },
    {
      title:'protocol',
      legalResponse:() => Promise.resolve(response(200, {
        serverNow:'2026-09-11T12:00:00Z', nextChangeAt:null, document:{ id:'bad' }
      }))
    },
    {
      title:'server',
      legalResponse:() => Promise.resolve(problemResponse(503, 'service-unavailable', {
        detail:'Внутренняя ошибка Core.'
      }))
    }
  ])('presents a $title legal-document failure as authentication service unavailability', async scenario => {
    const fetch = vi.fn(url => {
      if (url === '/api/v1/legal/current/2') return scenario.legalResponse()
      const standard = standardResponse(url)
      if (standard) return Promise.resolve(standard)
      if (url === '/api/v1/auth/phone/resolve') {
        return Promise.resolve(response(200, { nextStep:1, requiredDocumentKinds:[2] }))
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)
    const wrapper = mountView()

    await wrapper.get('input[name="phone"]').setValue('+79991234567')
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('.form-error').text()).toContain('Сервис недоступен. Пожалуйста, повторите позже.')
    expect(wrapper.get('.form-error').text()).not.toContain('неподдерживаемом формате')
    expect(wrapper.get('input[name="phone"]').element.value).toBe('+79991234567')
  })

  it.each([
    { title:'agreement', nextStep:1, required:[2], missingKind:2 },
    { title:'personal-data consent', nextStep:2, required:[1], missingKind:1 }
  ])('rejects a missing current $title document', async scenario => {
    const fetch = vi.fn(url => {
      if (url === `/api/v1/legal/current/${scenario.missingKind}`) {
        return Promise.resolve(response(200, {
          serverNow:'2026-09-11T12:00:00Z', nextChangeAt:null, document:null
        }))
      }
      const standard = standardResponse(url)
      if (standard) return Promise.resolve(standard)
      if (url === '/api/v1/auth/phone/resolve') {
        return Promise.resolve(response(200, {
          nextStep:scenario.nextStep,
          requiredDocumentKinds:scenario.required
        }))
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)
    const wrapper = mountView()

    await wrapper.get('input[name="phone"]').setValue('+79991234567')
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('input[name="phone"]').exists()).toBe(true)
    expect(wrapper.get('.form-error').text()).toContain('Нет действующих документов')
  })

  it('rejects an onboarding receipt for the direct code flow', async () => {
    const fetch = vi.fn(url => {
      const standard = standardResponse(url)
      if (standard) return Promise.resolve(standard)
      if (url === '/api/v1/auth/phone/resolve') {
        return Promise.resolve(response(200, { nextStep:0, requiredDocumentKinds:[] }))
      }
      if (url === '/api/v1/auth/code/request') {
        return Promise.resolve(response(202, {
          onboardingToken:'unexpected-onboarding-receipt-at-least-32-characters'
        }))
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)
    const wrapper = mountView()

    await wrapper.get('input[name="phone"]').setValue('+79991234567')
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('input[name="phone"]').exists()).toBe(true)
    expect(wrapper.find('.form-error').exists()).toBe(true)
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

  it('presents a failed requirements request and preserves selections and its retry key', async () => {
    let requests = 0
    const requestBodies = []
    const fetch = vi.fn((url, options) => {
      const standard = standardResponse(url)
      if (standard) return Promise.resolve(standard)
      if (url === '/api/v1/auth/phone/resolve') {
        return Promise.resolve(response(200, { nextStep:2, requiredDocumentKinds:[2, 1] }))
      }
      if (url === '/api/v1/auth/code/request') {
        requests++
        requestBodies.push(JSON.parse(options.body))
        return Promise.resolve(requests === 1
          ? problemResponse(400, 'validation-failed', { detail:'Повторите отправку кода.', errors:{
            personalDataConsent:['Проверьте согласие.'],
            'personalDataConsent.ContentHash':['Проверьте версию документа.', 'Проверьте согласие.'],
            'PersonalDataConsent.Decision':['Подтвердите решение.'],
            'personalDataConsent.Categories[0]':['Проверьте категории.'],
            personalDataConsentOther:['Не относится к согласию.']
          } })
          : response(202, { onboardingToken:'synthetic-onboarding-receipt-at-least-32-characters' }))
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)
    const wrapper = mountView()
    await wrapper.get('input[name="phone"]').setValue('+79991234567')
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()
    for (const checkbox of wrapper.findAll('input[type="checkbox"]')) await checkbox.setValue(true)

    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('.form-error').text()).toContain('Повторите отправку кода')
    expect(wrapper.get('#authentication-personal-error').text()).toBe(
      'Проверьте согласие. Проверьте версию документа. Подтвердите решение. Проверьте категории.'
    )
    expect(wrapper.get('#authentication-personal-data').attributes('aria-invalid')).toBe('true')
    expect(wrapper.get('#authentication-personal-data').attributes('aria-describedby')).toContain('authentication-personal-error')
    expect(wrapper.find('#authentication-terms-error').exists()).toBe(false)
    expect(wrapper.findAll('input[type="checkbox"]').every(item => item.element.checked)).toBe(true)

    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()
    expect(requestBodies[1].personalDataConsent.idempotencyKey)
      .toBe(requestBodies[0].personalDataConsent.idempotencyKey)
    expect(wrapper.find('input[name="code"]').exists()).toBe(true)
  })

  it('re-resolves when requirements become a direct code flow during code request', async () => {
    let resolves = 0
    const requestBodies = []
    const fetch = vi.fn((url, options) => {
      const standard = standardResponse(url)
      if (standard) return Promise.resolve(standard)
      if (url === '/api/v1/auth/phone/resolve') {
        resolves++
        return Promise.resolve(response(200, resolves === 1
          ? { nextStep:2, requiredDocumentKinds:[2, 1] }
          : { nextStep:0, requiredDocumentKinds:[] }))
      }
      if (url === '/api/v1/auth/code/request') {
        requestBodies.push(JSON.parse(options.body))
        return Promise.resolve(requestBodies.length === 1
          ? problemResponse(400, 'invalid-auth-request')
          : response(202, { onboardingToken:null }))
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)
    const wrapper = mountView()

    await wrapper.get('input[name="phone"]').setValue('+79991234567')
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()
    for (const checkbox of wrapper.findAll('input[type="checkbox"]')) await checkbox.setValue(true)
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()

    expect(resolves).toBe(2)
    expect(requestBodies).toHaveLength(2)
    expect(requestBodies[0]).toMatchObject({ termsAccepted:true, personalDataConsent:{ decision:'grant' } })
    expect(requestBodies[1]).toEqual({ phone:'+79991234567' })
    expect(wrapper.get('h2').text()).toBe('Введите код')
    expect(wrapper.find('input[name="code"]').exists()).toBe(true)
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

  it('re-resolves the retained phone when an automatic code request reports changed requirements', async () => {
    let resolves = 0
    let requests = 0
    const fetch = vi.fn(url => {
      const standard = standardResponse(url)
      if (standard) return Promise.resolve(standard)
      if (url === '/api/v1/auth/phone/resolve') {
        resolves++
        return Promise.resolve(response(200, { nextStep:0, requiredDocumentKinds:[] }))
      }
      if (url === '/api/v1/auth/code/request') {
        requests++
        return Promise.resolve(requests === 1
          ? problemResponse(409, 'authentication-requirements-changed')
          : response(202, { onboardingToken:null }))
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)
    const wrapper = mountView()

    await wrapper.get('input[name="phone"]').setValue('+79991234567')
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('input[name="code"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('+79991234567')
    expect(resolves).toBe(2)
    expect(requests).toBe(2)
  })

  it('reloads requirements and clears confirmations when the consent version changes during code request', async () => {
    let resolves = 0
    let documentReads = 0
    const fetch = vi.fn(url => {
      if (url.startsWith('/api/v1/legal/current/')) {
        documentReads++
        return Promise.resolve(standardResponse(url))
      }
      const standard = standardResponse(url)
      if (standard) return Promise.resolve(standard)
      if (url === '/api/v1/auth/phone/resolve') {
        resolves++
        return Promise.resolve(response(200, { nextStep:2, requiredDocumentKinds:[2, 1] }))
      }
      if (url === '/api/v1/auth/code/request') {
        return Promise.resolve(problemResponse(409, 'consent-version-changed'))
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)
    const wrapper = mountView()

    await wrapper.get('input[name="phone"]').setValue('+79991234567')
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()
    for (const checkbox of wrapper.findAll('input[type="checkbox"]')) await checkbox.setValue(true)
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('+79991234567')
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(2)
    expect(wrapper.findAll('input[type="checkbox"]').every(item => !item.element.checked)).toBe(true)
    expect(wrapper.find('input[name="code"]').exists()).toBe(false)
    expect(resolves).toBe(2)
    expect(documentReads).toBe(4)
  })

  it('reloads requirements and clears the receipt when onboarding consent expires during verification', async () => {
    let resolves = 0
    let documentReads = 0
    const fetch = vi.fn(url => {
      if (url.startsWith('/api/v1/legal/current/')) {
        documentReads++
        return Promise.resolve(standardResponse(url))
      }
      const standard = standardResponse(url)
      if (standard) return Promise.resolve(standard)
      if (url === '/api/v1/auth/phone/resolve') {
        resolves++
        return Promise.resolve(response(200, { nextStep:2, requiredDocumentKinds:[2, 1] }))
      }
      if (url === '/api/v1/auth/code/request') {
        return Promise.resolve(response(202, { onboardingToken:'synthetic-onboarding-receipt-at-least-32-characters' }))
      }
      if (url === '/api/v1/auth/code/verify') {
        return Promise.resolve(problemResponse(400, 'onboarding-consent-expired'))
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)
    const wrapper = mountView()

    await wrapper.get('input[name="phone"]').setValue('+79991234567')
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()
    for (const checkbox of wrapper.findAll('input[type="checkbox"]')) await checkbox.setValue(true)
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()
    await wrapper.get('input[name="code"]').setValue('4567')
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('+79991234567')
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(2)
    expect(wrapper.findAll('input[type="checkbox"]').every(item => !item.element.checked)).toBe(true)
    expect(wrapper.find('input[name="code"]').exists()).toBe(false)
    expect(resolves).toBe(2)
    expect(documentReads).toBe(4)
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
      if (url === '/api/v1/auth/code/verify') {
        return Promise.resolve(problemResponse(409, 'authentication-requirements-changed', { code:'changed_identifier' }))
      }
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

  it('returns to the retained phone when requirements restart cannot be resolved', async () => {
    let resolves = 0
    const fetch = vi.fn(url => {
      const standard = standardResponse(url)
      if (standard) return Promise.resolve(standard)
      if (url === '/api/v1/auth/phone/resolve') {
        resolves++
        return Promise.resolve(resolves === 1
          ? response(200, { nextStep:0, requiredDocumentKinds:[] })
          : problemResponse(503, 'service-unavailable'))
      }
      if (url === '/api/v1/auth/code/request') return Promise.resolve(response(202, { onboardingToken:null }))
      if (url === '/api/v1/auth/code/verify') {
        return Promise.resolve(problemResponse(409, 'authentication-requirements-changed', { code:'changed_identifier' }))
      }
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

    expect(wrapper.get('input[name="phone"]').element.value).toBe('+79991234567')
    expect(wrapper.find('input[name="code"]').exists()).toBe(false)
    expect(wrapper.get('.form-error').text()).toContain('Сервис недоступен')
  })

  it('presents a legal-document protocol failure during requirements restart as service unavailability', async () => {
    let resolves = 0
    const fetch = vi.fn(url => {
      if (url === '/api/v1/legal/current/2') {
        return Promise.resolve(response(200, {
          serverNow:'2026-09-11T12:00:00Z', nextChangeAt:null, document:{ id:'bad' }
        }))
      }
      const standard = standardResponse(url)
      if (standard) return Promise.resolve(standard)
      if (url === '/api/v1/auth/phone/resolve') {
        resolves++
        return Promise.resolve(response(200, resolves === 1
          ? { nextStep:0, requiredDocumentKinds:[] }
          : { nextStep:1, requiredDocumentKinds:[2] }))
      }
      if (url === '/api/v1/auth/code/request') return Promise.resolve(response(202, { onboardingToken:null }))
      if (url === '/api/v1/auth/code/verify') {
        return Promise.resolve(problemResponse(409, 'authentication-requirements-changed'))
      }
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

    expect(wrapper.get('input[name="phone"]').element.value).toBe('+79991234567')
    expect(wrapper.get('.form-error').text()).toContain('Сервис недоступен. Пожалуйста, повторите позже.')
    expect(wrapper.get('.form-error').text()).not.toContain('неподдерживаемом формате')
  })

  it('retains the requirements when Core omits the required onboarding receipt', async () => {
    const fetch = vi.fn(url => {
      const standard = standardResponse(url)
      if (standard) return Promise.resolve(standard)
      if (url === '/api/v1/auth/phone/resolve') {
        return Promise.resolve(response(200, { nextStep:2, requiredDocumentKinds:[2, 1] }))
      }
      if (url === '/api/v1/auth/code/request') return Promise.resolve(response(202, { onboardingToken:null }))
      throw new Error('Unexpected request')
    })
    vi.stubGlobal('fetch', fetch)
    const wrapper = mountView()
    await wrapper.get('input[name="phone"]').setValue('+79991234567')
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()
    for (const checkbox of wrapper.findAll('input[type="checkbox"]')) await checkbox.setValue(true)
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('input[name="code"]').exists()).toBe(false)
    expect(wrapper.findAll('input[type="checkbox"]').every(item => item.element.checked)).toBe(true)
    expect(wrapper.get('.form-error').text()).toContain('Сервис недоступен. Пожалуйста, повторите позже.')
  })

  it('keeps code validation and a recoverable verification failure on the current form', async () => {
    const fetch = vi.fn(url => {
      const standard = standardResponse(url)
      if (standard) return Promise.resolve(standard)
      if (url === '/api/v1/auth/phone/resolve') {
        return Promise.resolve(response(200, { nextStep:0, requiredDocumentKinds:[] }))
      }
      if (url === '/api/v1/auth/code/request') return Promise.resolve(response(202, { onboardingToken:null }))
      if (url === '/api/v1/auth/code/verify') return Promise.resolve(problemResponse(400, 'validation-failed', {
        detail:'Повторите подтверждение.', errors:{ code:['Повторите подтверждение.'] }
      }))
      throw new Error('Unexpected request')
    })
    vi.stubGlobal('fetch', fetch)
    const wrapper = mountView()
    await wrapper.get('input[name="phone"]').setValue('+79991234567')
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('.form-error').text()).toContain('Введите код подтверждения')
    expect(wrapper.get('input[name="code"]').attributes('aria-invalid')).toBe('true')
    expect(fetch.mock.calls.some(([url]) => url === '/api/v1/auth/code/verify')).toBe(false)

    await wrapper.get('input[name="code"]').setValue('4567')
    await wrapper.get('.auth-form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('input[name="code"]').element.value).toBe('4567')
    expect(wrapper.get('.form-error').text()).toContain('Повторите подтверждение.')
    expect(wrapper.get('input[name="code"]').attributes('aria-invalid')).toBe('true')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('keeps the code step, clears a wrong code, and does not offer change or resend controls', async () => {
    const fetch = vi.fn(url => {
      const standard = standardResponse(url)
      if (standard) return Promise.resolve(standard)
      if (url === '/api/v1/auth/phone/resolve') return Promise.resolve(response(200, { nextStep:0, requiredDocumentKinds:[] }))
      if (url === '/api/v1/auth/code/request') return Promise.resolve(response(202, { onboardingToken:null }))
      if (url === '/api/v1/auth/code/verify') return Promise.resolve(problemResponse(401, 'invalid-code', {
        title:'Некорректный код подтверждения', detail:'Неверный код', code:'changed_identifier'
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
