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
import ConsentRenewalDialog from '../src/components/ConsentRenewalDialog.vue'
import { problemResponse, response } from './fixtures/http.js'
import { customerDto } from './fixtures/customer.js'

const consent = vi.hoisted(() => ({
  missingKinds: vi.fn(),
  acquireNoticeSuppression: () => () => {},
  current: vi.fn(),
  grant: vi.fn(),
  kindName: () => 'Согласие на обработку персональных данных',
  ops: { value: { kinds: [{ value:1, routeAlias: 'personal-data-consent' }] } }
}))
vi.mock('../src/stores/consents.js', () => ({ useConsents: () => consent }))

const originalUrl = globalThis.URL
let mountedWrapper
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
  mountedWrapper = mount(ProfileView, { attachTo:document.body, global: { plugins: [createSarafanVuetify(), router] } })
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
    consent.missingKinds.mockReset().mockResolvedValue([])
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

  it.each(['field', 'mixed', 'service', 'hidden'])('keeps the correct presentation owner for a %s photo problem', async scenario => {
    const customer = customerDto({ id:15, phone:'+79990000015', state:0, hasPhoto:false, profile:{} })
    vi.stubGlobal('fetch', vi.fn(url => Promise.resolve(opsResponse(url) || sessionResponse(customer))))
    await useSession().verifyCode({ phone:customer.phone, code:'1111' })
    const wrapper = mountView()
    await flushPromises()
    if (scenario !== 'hidden') await startEditing(wrapper)
    wrapper.vm.$.setupState.problem = createInternalProblem(scenario === 'service' ? 'serviceUnavailable' : 'invalidInput', {
      errors:{ photo:['Проверьте фото'], ...(scenario === 'mixed' ? { other:['Другая ошибка'] } : {}) }
    })
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(scenario !== 'field')
    expect(wrapper.find('#profile-photo-error').exists()).toBe(['field', 'mixed'].includes(scenario))
  })

  it('loads, saves, replaces, removes, and presents customer profile data', async () => {
    const customer = customerDto({
      id: 12,
      phone: '+79991234567',
      state: 0,
      hasPhoto: true,
      profile: { lastName: 'Старая', firstName: null, passportIssueDate:'2010-02-03' }
    })
    const updated = customerDto({
      ...customer,
      state: 1,
      profile: { ...customer.profile, lastName: 'Новая', firstName: 'Мария', passportIssueDate:'2020-01-02' }
    })
    const photo = new globalThis.Blob(['photo'], { type: 'image/png' })
    const fetch = vi.fn((url, options = {}) => {
      const standard = opsResponse(url)
      if (standard) return Promise.resolve(standard)
      if (url === '/api/v1/auth/code/verify') return Promise.resolve(sessionResponse(customer))
      if ((url === '/api/v1/customers/me' || url === '/api/v1/customers/me/profile') && options.method === 'PUT')
        return Promise.resolve(response(200, { ...updated, hasPhoto:options.body instanceof globalThis.FormData
          ? options.body.get('removePhoto') !== 'true' : customer.hasPhoto }))
      if (url === '/api/v1/customers/me/photo' && options.method === 'PUT') return Promise.resolve(response(204))
      if (url === '/api/v1/customers/me/photo' && options.method === 'DELETE') return Promise.resolve(response(204))
      if (url === '/api/v1/customers/me/photo') return Promise.resolve(response(200, photo))
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)
    await useSession().verifyCode({ phone: customer.phone, code: '1111' })

    const wrapper = mountView()
    await vi.waitFor(() => expect(wrapper.find('.profile-avatar img').exists()).toBe(true))
    expect(wrapper.text()).toContain('Старая')
    expect(wrapper.text()).toContain('03.02.2010')
    expect(wrapper.text()).not.toContain('2010-02-03')
    expect(wrapper.find('.profile-privacy').exists()).toBe(false)
    expect(wrapper.findAll('.profile-account-panel')).toHaveLength(1)
    expect(wrapper.findAll('.ui-form-panel')).toHaveLength(1)
    expect(wrapper.findAll('.ui-form-section')).toHaveLength(3)
    expect(wrapper.findAll('.ui-data-grid dd')).toHaveLength(11)
    expect(wrapper.findAll('.ui-data-grid .ui-form-grid__wide')).toHaveLength(2)
    expect(wrapper.findAll('.ui-form-section')[0].findAll('dt').map(item => item.text())).toEqual([
      'Имя', 'Отчество', 'Фамилия'
    ])
    expect(wrapper.findAll('.ui-form-section')[2].findAll('dt').map(item => item.text())).toEqual([
      'Индекс', 'Регион, населённый пункт', 'Адрес'
    ])
    expect(wrapper.get('.profile-account-panel__email-value strong').text()).toBe('—')
    expect(wrapper.text()).toContain('Регион, населённый пункт')
    expect(wrapper.findAll('button').find(item => item.text() === 'Редактировать').classes()).toContain('ui-button--primary')
    await startEditing(wrapper)
    expect(wrapper.findAll('.profile-account-panel')).toHaveLength(1)
    expect(wrapper.findAll('.ui-form-panel')).toHaveLength(1)
    expect(wrapper.get('form').classes()).toContain('profile-layout')
    expect(wrapper.get('form').attributes('id')).toBe('profile-edit-form')
    expect(wrapper.get('input[name="passportIssueDate"]').element.value).toBe('03.02.2010')
    expect(wrapper.find('.profile-form-actions').exists()).toBe(false)
    expect(wrapper.findAll('form .ui-form-grid__wide')).toHaveLength(2)
    expect(wrapper.findAll('button').find(item => item.text() === 'Сохранить').attributes()).toMatchObject({ type: 'submit', form: 'profile-edit-form' })
    expect(wrapper.findAll('button').find(item => item.text() === 'Заменить фото').classes()).toContain('ui-button--primary')
    expect(wrapper.get('.photo-remove').classes()).toContain('ui-button--danger')
    const photoInputElement = wrapper.get('input[type="file"]').element
    const photoInputClick = vi.spyOn(photoInputElement, 'click')
    await wrapper.findAll('button').find(item => item.text() === 'Заменить фото').trigger('click')
    expect(photoInputClick).toHaveBeenCalledTimes(1)

    const values = [
      'maria@example.test', 'Мария', 'Ивановна', 'Новая', '770123456789',
      '45 00', '123456', '2020-01-02', 'ОВД', '101000', 'Москва', 'Тверская, 1'
    ]
    const inputs = wrapper.findAll('form .ui-field__control')
    expect(inputs).toHaveLength(values.length)
    for (const [index, input] of inputs.entries()) await input.setValue(values[index])
    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => expect(wrapper.text()).toContain('Профиль сохранён'))
    expect(wrapper.text()).toContain('02.01.2020')
    const updateCall = fetch.mock.calls.find(([url]) => url === '/api/v1/customers/me')
    expect(JSON.parse(updateCall[1].body)).toMatchObject({
      lastName: 'Новая',
      firstName: 'Мария',
      inn: '770123456789',
      passportSeries: '45 00',
      passportNumber: '123456',
      passportIssueDate: '2020-01-02',
      passportIssuedBy: 'ОВД'
    })

    await startEditing(wrapper)
    const fileInput = wrapper.get('input[type="file"]').element
    await setFile(fileInput, new globalThis.File(['png'], 'profile.png', { type: 'image/png' }))
    expect(fetch.mock.calls.some(([, options]) => options.method === 'PUT' && options.body instanceof globalThis.FormData)).toBe(false)
    await wrapper.get('form').trigger('submit'); await flushPromises()
    const photoSave = fetch.mock.calls.find(([, options]) => options.method === 'PUT' && options.body instanceof globalThis.FormData)
    expect(photoSave[0]).toBe('/api/v1/customers/me/profile')
    expect(photoSave[1].body.get('photo')).toBeInstanceOf(globalThis.File)
    await startEditing(wrapper)
    await wrapper.get('.photo-remove').trigger('click')
    expect(fetch.mock.calls.some(([, options]) => options.method === 'DELETE')).toBe(false)
    await wrapper.findAll('button').find(item => item.text() === 'Отмена').trigger('click')
    expect(useSession().customer.value.hasPhoto).toBe(true)
    await startEditing(wrapper)
    await wrapper.get('.photo-remove').trigger('click')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(useSession().customer.value.hasPhoto).toBe(false)
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalled()
    expect(wrapper.findAll('button').some(item => item.text() === 'Выйти')).toBe(false)
  })

  it.each(['profile', 'photo'])('preserves the %s draft through document reading, cancellation and renewal', async action => {
    const customer = customerDto({ id:19, profile:{ firstName:'Мария' }, hasPhoto:false })
    const fetch = vi.fn((url, options) => Promise.resolve(opsResponse(url) || (
      url === '/api/v1/customers/me/photo' ? response(200, new globalThis.Blob(['photo'])) :
      (url === '/api/v1/customers/me' || url === '/api/v1/customers/me/profile') ? response(200, { ...customer, hasPhoto:options.body instanceof globalThis.FormData,
        profile:{ ...customer.profile, ...(options.body instanceof globalThis.FormData ? Object.fromEntries(options.body) : JSON.parse(options.body)) } }) :
      sessionResponse(customer))))
    vi.stubGlobal('fetch', fetch)
    await useSession().verifyCode({ phone:customer.phone, code:'1111' })
    const wrapper = mountView()
    await flushPromises()
    await startEditing(wrapper)
    await wrapper.get('input[name="firstName"]').setValue('Черновик')
    consent.current.mockResolvedValue({ document:{ id:'pd', kind:1, title:'Согласие', contentHash:'a'.repeat(64), displayVersion:'1', effectiveAt:'2026-09-01T00:00:00Z', html:'<p>Документ</p>' } })
    consent.grant.mockResolvedValue()
    consent.missingKinds.mockResolvedValue([1])
    const file = new globalThis.File(['png'], 'photo.png', { type:'image/png' })
    if (action === 'photo') await setFile(wrapper.get('input[type="file"]').element, file)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    const flow = wrapper.findComponent(ConsentRenewalDialog).props('flow')
    expect(flow.state.open).toBe(true)
    expect(wrapper.get('input[name="firstName"]').element.value).toBe('Черновик')
    flow.state.reading = flow.state.documents[0].document
    await flushPromises()
    expect(wrapper.get('input[name="firstName"]').element.value).toBe('Черновик')
    flow.cancel()
    await flushPromises()
    expect(fetch.mock.calls.filter(([url]) => url === '/api/v1/customers/me' || url === '/api/v1/customers/me/profile')).toHaveLength(0)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    flow.state.documents[0].accepted = true
    consent.missingKinds.mockResolvedValue([])
    await flow.confirm()
    await flushPromises()
    const writes = fetch.mock.calls.filter(([url, options]) => (url === '/api/v1/customers/me' || url === '/api/v1/customers/me/profile') && options.method === 'PUT')
    expect(writes).toHaveLength(1)
    if (action === 'profile') expect(JSON.parse(writes[0][1].body).firstName).toBe('Черновик')
    else expect(writes[0][1].body.get('photo')).toBe(file)
    expect(fetch.mock.calls.filter(([url]) => url === '/api/v1/auth/code/verify')).toHaveLength(1)
  })

  it('recovers a server-side consent rejection without changing the submitted profile draft', async () => {
    const customer = customerDto({ id:20 })
    let writes = 0
    const fetch = vi.fn((url, options) => {
      if (url === '/api/v1/customers/me') {
        writes++
        return Promise.resolve(writes === 1
          ? problemResponse(409, 'personal-data-consent-required', { title:'Требуется согласие', detail:'Подтвердите документ' })
          : response(200, { ...customer, profile:{ ...customer.profile, ...JSON.parse(options.body) } }))
      }
      return Promise.resolve(opsResponse(url) || sessionResponse(customer))
    })
    vi.stubGlobal('fetch', fetch)
    await useSession().verifyCode({ phone:customer.phone, code:'1111' })
    const wrapper = mountView()
    await flushPromises()
    await startEditing(wrapper)
    await wrapper.get('input[name="firstName"]').setValue('Черновик')
    consent.missingKinds.mockResolvedValueOnce([]).mockResolvedValue([1])
    consent.current.mockResolvedValue({ document:{ id:'pd', kind:1, title:'Согласие', contentHash:'a'.repeat(64), html:'<p>Текст</p>' } })
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    const flow = wrapper.findComponent(ConsentRenewalDialog).props('flow')
    expect(flow.state.open).toBe(true)
    flow.state.documents[0].accepted = true
    consent.missingKinds.mockResolvedValue([])
    await flow.confirm()
    await flushPromises()
    expect(writes).toBe(2)
    expect(fetch.mock.calls.filter(([url]) => url === '/api/v1/customers/me').map(([, options]) => JSON.parse(options.body).firstName)).toEqual(['Черновик', 'Черновик'])
  })

  it('retains editable data when current personal-data consent is required', async () => {
    const customer = customerDto({ id: 13, phone: '+79991234567', state:0, hasPhoto: false, profile: { firstName: 'Мария' } })
    const fetch = vi.fn(url => Promise.resolve(opsResponse(url) || sessionResponse(customer)))
    vi.stubGlobal('fetch', fetch)
    await useSession().verifyCode({ phone: customer.phone, code: '4567' })
    const wrapper = mountView()
    await startEditing(wrapper)
    consent.missingKinds.mockRejectedValue(createInternalProblem('invalidInput', { detail: 'Требуется актуальное согласие' }))
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('Требуется актуальное согласие')
    expect(wrapper.findAll('form .ui-field__control')[1].element.value).toBe('Мария')
    await setFile(wrapper.get('input[type="file"]').element, new globalThis.File(['png'], 'photo.png', { type: 'image/png' }))
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(consent.missingKinds).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls.filter(([url]) => url === '/api/v1/auth/code/verify')).toHaveLength(1)
  })

  it('presents a consent service failure once while keeping the profile form mounted', async () => {
    const customer = customerDto({ id:18, phone:'+79990000018', state:0, hasPhoto:false, profile:{ firstName:'Мария' } })
    vi.stubGlobal('fetch', vi.fn(url => Promise.resolve(opsResponse(url) || sessionResponse(customer))))
    await useSession().verifyCode({ phone:customer.phone, code:'0018' })
    const wrapper = mountView()
    await startEditing(wrapper)
    consent.missingKinds.mockRejectedValue(createInternalProblem('protocolError'))

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    const alert = wrapper.get('.ui-alert')
    const message = 'Сервис временно недоступен. Пожалуйста, повторите позже'
    expect(alert.text()).toBe(message)
    expect(alert.find('strong').exists()).toBe(false)
    expect(wrapper.text().split(message)).toHaveLength(2)
    expect(wrapper.find('form').exists()).toBe(true)
  })

  it('does not present an abandoned profile save as successful for a new identity', async () => {
    const original = customerDto({ id:16 })
    const replacement = customerDto({ id:17, profile:{ firstName:'Новая' } })
    const pending = deferred()
    let verifications = 0
    vi.stubGlobal('fetch', vi.fn(url => {
      const standard = opsResponse(url)
      if (standard) return Promise.resolve(standard)
      if (url === '/api/v1/auth/code/verify') return Promise.resolve(sessionResponse(verifications++ ? replacement : original))
      if (url === '/api/v1/customers/me') return pending.promise
      if (url === '/api/v1/auth/logout') return Promise.resolve(response(204))
      throw new Error('Unexpected request')
    }))
    const session = useSession()
    await session.verifyCode({ phone:original.phone, code:'1111' })
    const wrapper = mountView()
    await startEditing(wrapper)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await session.logout()
    await session.verifyCode({ phone:replacement.phone, code:'1111' })
    pending.resolve(response(200, original))
    await flushPromises()

    expect(wrapper.text()).toContain('Новая')
    expect(wrapper.text()).not.toContain('Профиль сохранён')
    expect(session.customer.value).toEqual(replacement)
  })

  it('ignores a photo response that arrives after unmount', async () => {
    const customer = customerDto({ id: 14, phone: '+79990000014', state:0, hasPhoto: true, profile: {} })
    const pendingPhoto = deferred()
    vi.stubGlobal('fetch', vi.fn(url => {
      const standard = opsResponse(url)
      if (standard) return Promise.resolve(standard)
      if (url === '/api/v1/auth/code/verify') return Promise.resolve(sessionResponse(customer))
      if (url === '/api/v1/customers/me/photo') return pendingPhoto.promise
      throw new Error(`Unexpected request: ${url}`)
    }))
    await useSession().verifyCode({ phone: customer.phone, code: '1111' })
    const wrapper = mountView()
    wrapper.unmount()
    mountedWrapper = null
    pendingPhoto.resolve(response(200, new globalThis.Blob(['stale'])))
    await flushPromises()
    expect(globalThis.URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('retains the photo and text draft through repeated failed saves and focuses the photo action', async () => {
    const customer = customerDto({ id:15, hasPhoto:false, profile:{} })
    const fetch = vi.fn((url, options = {}) => {
      const standard = opsResponse(url)
      if (standard) return Promise.resolve(standard)
      if (url === '/api/v1/auth/code/verify') return Promise.resolve(sessionResponse(customer))
      if (url === '/api/v1/customers/me/profile' && options.method === 'PUT')
        return Promise.resolve(problemResponse(400, 'invalid-photo-content', { detail:'Фото не загружено' }))
      throw new Error('Unexpected request: ' + url)
    })
    vi.stubGlobal('fetch', fetch)
    await useSession().verifyCode({ phone:customer.phone, code:'1111' })
    const wrapper = mountView(); await flushPromises(); await startEditing(wrapper)
    await wrapper.get('input[name="firstName"]').setValue('Черновик')
    const file = new globalThis.File(['png'], 'valid.png', { type:'image/png' })
    await setFile(wrapper.get('input[type="file"]').element, file)
    expect(fetch.mock.calls.some(([url]) => url === '/api/v1/customers/me/profile')).toBe(false)
    for (let attempt = 0; attempt < 2; attempt++) {
      await wrapper.get('form').trigger('submit'); await flushPromises()
      expect(wrapper.get('#profile-photo-error').text()).toBe('Фото не загружено')
      expect(document.activeElement).toBe(wrapper.get('[data-validation-field="photo"]').element)
      expect(wrapper.get('input[name="firstName"]').element.value).toBe('Черновик')
      expect(useSession().customer.value.hasPhoto).toBe(false)
    }
    const writes = fetch.mock.calls.filter(([url]) => url === '/api/v1/customers/me/profile')
    expect(writes).toHaveLength(2)
    expect(writes.every(([, options]) => options.body.get('photo') === file && options.body.get('firstName') === 'Черновик')).toBe(true)
  })

  it('replaces or removes a newly selected photo locally and clears it on identity change', async () => {
    const original = customerDto({ id:21, hasPhoto:false })
    const replacement = customerDto({ id:22, hasPhoto:false })
    let verifications = 0
    const fetch = vi.fn(url => Promise.resolve(opsResponse(url) || sessionResponse(verifications++ ? replacement : original)))
    vi.stubGlobal('fetch', fetch)
    const session = useSession()
    await session.verifyCode({ phone:original.phone, code:'1111' })
    const wrapper = mountView(); await flushPromises(); await startEditing(wrapper)
    const file = new globalThis.File(['png'], 'photo.png', { type:'image/png' })
    const input = wrapper.get('input[type="file"]').element
    await setFile(input, file)
    await setFile(input, file)
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledTimes(1)
    await wrapper.get('.photo-remove').trigger('click')
    expect(wrapper.find('.photo-remove').exists()).toBe(false)
    expect(session.customer.value.hasPhoto).toBe(false)
    await setFile(input, file)
    await session.verifyCode({ phone:replacement.phone, code:'1111' })
    await flushPromises()
    expect(wrapper.find('form').exists()).toBe(false)
    expect(wrapper.find('.profile-avatar img').exists()).toBe(false)
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledTimes(3)
    expect(fetch.mock.calls.some(([url]) => url === '/api/v1/customers/me/profile' || url.endsWith('/photo'))).toBe(false)
  })

  it('validates selected files locally and discards photo drafts on cancel and unmount', async () => {
    const customer = customerDto({ id:15, hasPhoto:true, profile:{} })
    vi.stubGlobal('fetch', vi.fn(url => Promise.resolve(opsResponse(url) || (url.endsWith('/photo')
      ? response(200, new globalThis.Blob(['saved'])) : sessionResponse(customer)))))
    await useSession().verifyCode({ phone:customer.phone, code:'1111' })
    const wrapper = mountView(); await flushPromises(); await startEditing(wrapper)
    const input = wrapper.get('input[type="file"]').element
    await setFile(input, null)
    for (const file of [new globalThis.File(['bad'], 'bad.txt', { type:'text/plain' }),
      new globalThis.File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', { type:'image/png' })]) {
      await setFile(input, file)
      expect(wrapper.get('#profile-photo-error').text()).toContain('Выберите JPEG')
      expect(document.activeElement).toBe(wrapper.get('[data-validation-field="photo"]').element)
    }
    const selected = new globalThis.File(['png'], 'new.png', { type:'image/png' })
    await setFile(input, selected)
    expect(wrapper.find('#profile-photo-error').exists()).toBe(false)
    await wrapper.findAll('button').find(button => button.text() === 'Отмена').trigger('click')
    expect(useSession().customer.value.hasPhoto).toBe(true)
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalled()
    await startEditing(wrapper)
    await setFile(wrapper.get('input[type="file"]').element, selected)
    const revoked = globalThis.URL.revokeObjectURL.mock.calls.length
    wrapper.unmount(); mountedWrapper = null
    expect(globalThis.URL.revokeObjectURL.mock.calls.length).toBeGreaterThan(revoked)
  })

})
