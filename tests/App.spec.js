// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { createMemoryHistory } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import App from '../src/App.vue'
import AppHeader from '../src/components/AppHeader.vue'
import { createInternalProblem } from '../src/errors/problem.js'
import { createSarafanVuetify } from '../src/plugins/vuetify.js'
import { createAppRouter } from '../src/router.js'

const h = vi.hoisted(() => ({ session: {}, consents: {}, orders:{} }))
vi.mock('../src/stores/session.js', () => ({ useSession: () => h.session }))
vi.mock('../src/stores/consents.js', () => ({ useConsents: () => h.consents }))
vi.mock('../src/stores/orders.js', () => ({ createOrderStore: () => h.orders }))

const legalKinds = [
  { value: 2, name: 'Пользовательское соглашение', routeAlias: 'user-agreement' },
  { value: 4, name: 'Политика обработки персональных данных', routeAlias: 'privacy-policy' }
]

async function mountApp(path = '/') {
  const router = createAppRouter(createMemoryHistory())
  await router.push(path)
  const wrapper = mount(App, {
    global: {
      plugins: [createSarafanVuetify(), router],
      stubs: {
        ConsentCenter: {
          name: 'ConsentCenter',
          template: '<section class="consent-notice-stub" />'
        },
        PhoneAuthDialog: {
          name: 'PhoneAuthDialog',
          props: ['modelValue'],
          emits: ['update:modelValue'],
          template: '<section v-if="modelValue" class="phone-auth-stub">Вход</section>'
        }
      }
    }
  })
  return { router, wrapper }
}

describe('App routing and privacy gates', () => {
  beforeEach(() => {
    Object.assign(h.session, {
      customer: ref(null),
      logout: vi.fn().mockResolvedValue(),
      restoreProblem: ref(null),
      restoring: ref(false),
      restoreSession: vi.fn().mockResolvedValue()
    })
    Object.assign(h.consents, {
      ops: ref({ kinds: legalKinds })
    })
    Object.assign(h.orders, {
      orders:ref([{ id:17, orderNumber:'12345678-1', status:0, productName:'Nike Air Max 90 Essential', storeName:'nike.com', imageUrl:null, sellerPrice:null, quantity:1, createdAt:'2026-09-14T10:00:00Z' }]),
      loading:ref(false),
      load:vi.fn().mockResolvedValue(true),
      reset:vi.fn(),
      dispose:vi.fn(),
      statusFor:vi.fn(() => ({ name:'На проверке', routeAlias:'under_review', upperStatusName:'На проверке', upperStatusRouteAlias:'under_review', isTerminal:false, progressPercent:14 })),
      progressFor:vi.fn(() => 14),
      currencyFor:vi.fn()
    })
  })

  it('renders the public home route without waiting for session restoration', async () => {
    h.session.restoring.value = true
    const { wrapper } = await mountApp()
    await flushPromises()
    expect(wrapper.text()).toContain('Закажите товар — остальное сделаем мы')
    expect(wrapper.find('.route-gate').exists()).toBe(false)
    expect(wrapper.findAll('.site-footer')).toHaveLength(1)
    expect(h.session.restoreSession).toHaveBeenCalledOnce()
    expect(wrapper.get('.app-header__login').attributes('disabled')).toBeUndefined()
    wrapper.findComponent(AppHeader).vm.$emit('authenticate')
    await flushPromises()
    expect(wrapper.find('.phone-auth-stub').exists()).toBe(true)
  })

  it('restores the session without legacy consent gating', async () => {
    const order = []
    h.session.restoreSession.mockImplementation(async () => { order.push('session') })
    await mountApp()
    await flushPromises()
    expect(order).toEqual(['session'])
    expect(h.consents).not.toHaveProperty('serviceAllowed')
    expect(h.consents).not.toHaveProperty('loadCookies')
  })

  it('does not mount a protected route until its session is restored', async () => {
    h.session.restoring.value = true
    const { wrapper } = await mountApp('/orders')
    await flushPromises()
    expect(wrapper.text()).toContain('Восстанавливаем сессию')
    expect(wrapper.text()).not.toContain('Nike Air Max 90 Essential')
    expect(wrapper.findAll('.site-footer')).toHaveLength(1)

    h.session.restoring.value = true
    await flushPromises()
    expect(wrapper.text()).toContain('Восстанавливаем сессию')
    expect(wrapper.text()).not.toContain('Nike Air Max 90 Essential')

    h.session.restoring.value = false
    h.session.restoreProblem.value = createInternalProblem('sessionRestoreUnavailable')
    await flushPromises()
    expect(wrapper.text()).toContain('Не удалось открыть раздел')
    await wrapper.findAll('button').find(item => item.text() === 'Повторить').trigger('click')
    expect(h.session.restoreSession).toHaveBeenCalled()

    h.session.restoreProblem.value = null
    h.session.customer.value = { id: 7, phone: '+79990000007', hasPhoto: false, profile: {} }
    await flushPromises()
    expect(wrapper.text()).toContain('Nike Air Max 90 Essential')
  })

  it('redirects an unauthenticated protected bookmark to the public home route', async () => {
    const { router, wrapper } = await mountApp('/profile')
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('home'))
    expect(wrapper.text()).toContain('Закажите товар — остальное сделаем мы')
  })

  it('returns home from a protected restore failure and closes authentication via v-model', async () => {
    h.session.restoreProblem.value = createInternalProblem('sessionRestoreUnavailable')
    const { router, wrapper } = await mountApp('/orders')
    await flushPromises()
    await wrapper.findAll('button').find(item => item.text() === 'На главную').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('home')
    await wrapper.get('.app-header__login').trigger('click')
    expect(wrapper.find('.phone-auth-stub').exists()).toBe(true)
    wrapper.findComponent({ name: 'PhoneAuthDialog' }).vm.$emit('update:modelValue', false)
    await flushPromises()
    expect(wrapper.find('.phone-auth-stub').exists()).toBe(false)
  })

  it('keeps recoverable restore failures non-blocking on public routes', async () => {
    h.session.restoreProblem.value = createInternalProblem('sessionRestoreUnavailable')
    const { router, wrapper } = await mountApp()
    await flushPromises()
    expect(wrapper.text()).toContain('Закажите товар — остальное сделаем мы')
    expect(wrapper.text()).toContain('Не удалось восстановить сеанс')
    await wrapper.findAll('button').find(item => item.text() === 'Повторить').trigger('click')
    expect(h.session.restoreSession).toHaveBeenCalled()
    await router.push('/legal/privacy-policy')
    await flushPromises()
    expect(wrapper.find('.session-notice').exists()).toBe(false)
  })

  it('keeps public and customer route content independent of the notice controller', async () => {
    const { router, wrapper } = await mountApp()
    await flushPromises()
    expect(wrapper.text()).toContain('Закажите товар — остальное сделаем мы')
    const productLink = wrapper.get('input')
    await productLink.setValue('https://shop.example/product')
    expect(wrapper.find('.consent-notice-stub').exists()).toBe(true)
    expect(wrapper.get('.app-route-content').attributes('style') || '').not.toContain('display: none')
    expect(productLink.element.value).toBe('https://shop.example/product')

    h.session.customer.value = { id:7, phone:'+79990000007', hasPhoto:false, profile:{} }
    await router.push('/orders')
    await flushPromises()
    expect(wrapper.text()).toContain('Nike Air Max 90 Essential')
    expect(wrapper.find('.consent-notice-stub').exists()).toBe(true)
    expect(wrapper.get('.app-route-content').attributes('style') || '').not.toContain('display: none')

    await router.push('/consents/cookies'); await flushPromises()
    expect(router.currentRoute.value.name).toBe('consents')
    for (const [path, name] of [
      ['/consents', 'consents'],
      ['/consents/personal-data', 'personal-consents'],
      ['/legal/cookie-consent', 'legal-document']
    ]) {
      await router.push(path); await flushPromises()
      expect(router.currentRoute.value.name).toBe(name)
    }
    await router.push('/'); await flushPromises()
    expect(wrapper.text()).toContain('Закажите товар — остальное сделаем мы')
  })

  it('opens reusable phone authentication and exposes one inert Support entry', async () => {
    const { wrapper } = await mountApp()
    await flushPromises()
    expect(wrapper.findAll('.global-support')).toHaveLength(1)
    expect(wrapper.find('.phone-auth-stub').exists()).toBe(false)
    await wrapper.get('.app-header__login').trigger('click')
    expect(wrapper.find('.phone-auth-stub').exists()).toBe(true)
    expect(wrapper.findAll('a[href="https://gtc.express/"]')).toHaveLength(2)
    expect(wrapper.findAll('a[href="https://gtc.express/"]').every(link => link.text() === 'Совместно с GTC')).toBe(true)
  })

  it('logs out from the shared header and returns home even when server logout fails', async () => {
    h.session.customer.value = { id: 8, phone: '+79990000008', hasPhoto: false, profile: {} }
    h.session.logout.mockRejectedValueOnce(createInternalProblem('invalidInput'))
    const { router, wrapper } = await mountApp('/profile')
    await flushPromises()

    expect(wrapper.find('.profile-privacy').exists()).toBe(false)
    expect(wrapper.findAll('.app-header__nav-action')).toHaveLength(1)
    await wrapper.get('.app-header__nav-action').trigger('click')
    await flushPromises()

    expect(h.session.logout).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.name).toBe('home')
  })
})
