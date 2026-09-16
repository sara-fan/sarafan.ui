// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { flushPromises, mount, shallowMount } from '@vue/test-utils'
import { ref } from 'vue'
import { createMemoryHistory } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AppHeader from '../src/components/AppHeader.vue'
import PublicInfoBlock from '../src/components/PublicInfoBlock.vue'
import SiteFooter from '../src/components/SiteFooter.vue'
import UiAlert from '../src/components/ui/UiAlert.vue'
import UiButton from '../src/components/ui/UiButton.vue'
import UiDialog from '../src/components/ui/UiDialog.vue'
import UiField from '../src/components/ui/UiField.vue'
import UiSelectionControl from '../src/components/ui/UiSelectionControl.vue'
import { SERVICE_UNAVAILABLE_MESSAGE, createInternalProblem } from '../src/errors/problem.js'
import { createSarafanVuetify } from '../src/plugins/vuetify.js'
import { ACCESS, createAppRouter, routes } from '../src/router.js'
import { resetProductDraftForTests, useProductDraft } from '../src/stores/productDraft.js'
import HomeView from '../src/views/HomeView.vue'
import ConsentsView from '../src/views/ConsentsView.vue'
import LegalDocumentView from '../src/views/LegalDocumentView.vue'
import NotFoundView from '../src/views/NotFoundView.vue'
import OrdersView from '../src/views/OrdersView.vue'
import PendingView from '../src/views/PendingView.vue'
import OrderDetailsView from '../src/views/OrderDetailsView.vue'
import { ops } from './fixtures/orders.js'

const h = vi.hoisted(() => ({ store: {}, orderStore: {}, session:{} }))
vi.mock('../src/stores/consents.js', () => ({ useConsents: () => h.store }))
vi.mock('../src/stores/orders.js', async importOriginal => ({
  ...await importOriginal(),
  createOrderStore:() => h.orderStore
}))
vi.mock('../src/stores/session.js', () => ({ useSession:() => h.session }))

async function routerAt(path = '/') {
  const router = createAppRouter(createMemoryHistory())
  await router.push(path)
  return router
}

beforeEach(() => {
  resetProductDraftForTests()
  h.session.customer = ref({ id:7 })
  h.session.orderRequest = vi.fn((_path, _options, _isCurrent, validateResponse) => {
    const value = ops
    validateResponse(value)
    return Promise.resolve(value)
  })
  h.store.ops = ref({
    kinds: [
      { value: 2, name: 'Пользовательское соглашение', routeAlias: 'user-agreement' },
      { value: 4, name: 'Политика обработки персональных данных', routeAlias: 'privacy-policy' }
    ]
  })
  const orderStatuses = new Map([
    [0, { value:0, name:'На проверке', routeAlias:'under_review', upperStatusName:'На проверке', upperStatusRouteAlias:'under_review', isTerminal:false, progressPercent:14 }],
    [100, { value:100, name:'Расчёт готов', routeAlias:'quote_ready', upperStatusName:'Расчёт готов', upperStatusRouteAlias:'quote_ready', isTerminal:false, progressPercent:32 }]
  ])
  h.orderStore.orders = ref([
    { orderNumber:'12345678-2', status:0, sourceUrl:'https://nike.com/item', productName:'Nike Air Max 90 Essential', storeName:'nike.com', imageUrl:null, sellerPrice:null, quantity:1, createdAt:'2026-09-14T10:00:00Z' },
    { orderNumber:'12345678-1', status:100, sourceUrl:'https://cos.com/item', productName:'Mini Quilted Shoulder Bag', storeName:'cos.com', imageUrl:null, sellerPrice:{ amount:85, currency:840 }, quantity:2, createdAt:'2026-09-13T10:00:00Z' }
  ])
  h.orderStore.loading = ref(false)
  h.orderStore.load = vi.fn().mockResolvedValue(true)
  h.orderStore.reset = vi.fn()
  h.orderStore.dispose = vi.fn()
  h.orderStore.statusFor = vi.fn(value => orderStatuses.get(value))
  h.orderStore.progressFor = vi.fn(value => value === 0 ? 14 : 32)
  h.orderStore.currencyFor = vi.fn(() => ({ value:840, name:'Доллар США', routeAlias:'usd' }))
})

describe('router and page shells', () => {
  it('declares public, limited, customer, detail, and fallback routes', async () => {
    expect(new Set(routes.filter(route => !route.redirect).map(route => route.meta.access))).toEqual(new Set(Object.values(ACCESS)))
    const detail = routes.find(route => route.name === 'order-details')
    expect(routes.find(route => route.name === 'orders').component).toBe(OrdersView)
    expect(detail.component).toBe(OrderDetailsView)
    const router = await routerAt('/does-not-exist')
    expect(router.currentRoute.value.name).toBe('not-found')
    expect(createAppRouter().hasRoute('home')).toBe(true)
    expect(routes.find(route => route.name === 'consents').component).toBe(ConsentsView)
    expect(routes.find(route => route.name === 'legal-document').component).toBe(LegalDocumentView)
    expect(routes.find(route => route.path === '/consents/cookies').redirect).toBe('/consents')
    await router.push('/consents/cookies')
    expect(router.currentRoute.value.name).toBe('consents')
    expect(routes.find(route => route.name === 'personal-consents').props).toEqual({ section:'personal' })
  })

  it('renders the consent and legal route wrappers without dialog overlays', async () => {
    const consent = shallowMount(ConsentsView, {
      props:{ section:'auto' },
      global:{ stubs:{ ConsentCenter:true } }
    })
    const initialCenter = consent.getComponent({ name:'ConsentCenter' })
    expect(initialCenter.props()).toMatchObject({ mode:'consents', section:'auto' })
    const initialUid = initialCenter.vm.$.uid
    await consent.setProps({ section:'personal' })
    const replacementCenter = consent.getComponent({ name:'ConsentCenter' })
    expect(replacementCenter.props()).toMatchObject({ mode:'consents', section:'personal' })
    expect(replacementCenter.vm.$.uid).not.toBe(initialUid)

    const legal = shallowMount(LegalDocumentView, { global:{ stubs:{ ConsentCenter:true } } })
    expect(legal.getComponent({ name:'ConsentCenter' }).props('mode')).toBe('legal')
  })

  it('submits a protocol-free product address without putting it in router state', async () => {
    const router = await routerAt()
    const wrapper = mount(HomeView, { global: { plugins: [router] } })
    await wrapper.get('input[inputmode="url"]').setValue('store.example.com/item')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('product')
    expect(router.currentRoute.value.query).toEqual({})
    expect(router.options.history.state.sourceUrl).toBeUndefined()
    expect(useProductDraft().draft.value.sourceUrl).toBe('https://store.example.com/item')
    expect(h.session.orderRequest).toHaveBeenCalledWith(
      '/api/v1/orders/ops', {}, expect.any(Function), expect.any(Function)
    )
    expect(wrapper.findComponent(PublicInfoBlock).exists()).toBe(true)
  })

  it('keeps empty and invalid product addresses on Home with exact SCN-03 copy', async () => {
    const router = await routerAt()
    const wrapper = mount(HomeView, { global:{ plugins:[router] } })
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[role="alert"]').text()).toBe('Вставьте ссылку на товар')
    expect(router.currentRoute.value.name).toBe('home')

    await wrapper.get('input[inputmode="url"]').setValue('javascript:alert(1)')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[role="alert"]').text()).toBe('Проверьте ссылку на товар и попробуйте ещё раз')
    expect(router.currentRoute.value.name).toBe('home')

    await wrapper.get('input[inputmode="url"]').setValue('xxxx')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[role="alert"]').text()).toBe('Проверьте ссылку на товар и попробуйте ещё раз')
    expect(router.currentRoute.value.name).toBe('home')

    await wrapper.get('input[inputmode="url"]').setValue('shop.invalid/item')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('Проверьте ссылку на товар и попробуйте ещё раз')
    expect(router.currentRoute.value.name).toBe('home')

    await wrapper.get('input[inputmode="url"]').setValue('store.example.com/item')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(h.session.orderRequest).toHaveBeenCalledOnce()
    expect(router.currentRoute.value.name).toBe('product')
  })

  it('keeps an order Ops failure recoverable on Home', async () => {
    h.session.orderRequest.mockRejectedValueOnce(createInternalProblem('serviceUnavailable'))
    const router = await routerAt()
    const wrapper = mount(HomeView, { global:{ plugins:[router] } })
    await wrapper.get('input[inputmode="url"]').setValue('store.example.com/item')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    const alert = wrapper.get('.home-hero > .ui-alert')
    expect(alert.text()).toBe(SERVICE_UNAVAILABLE_MESSAGE)
    expect(alert.find('strong').exists()).toBe(false)
    expect(wrapper.find('.product-entry .ui-alert').exists()).toBe(false)
    expect(router.currentRoute.value.name).toBe('home')

    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('product')
  })

  it('prevents concurrent Ops requests and discards completion after Home unmounts', async () => {
    let complete
    h.session.orderRequest.mockImplementationOnce((_path, _options, isCurrent, validateResponse) => new Promise(resolve => {
      complete = value => {
        if (isCurrent()) validateResponse(value)
        resolve(value)
      }
    }))
    const router = await routerAt()
    const wrapper = mount(HomeView, { global:{ plugins:[router] } })
    await wrapper.get('input[inputmode="url"]').setValue('store.example.com/item')
    await wrapper.get('form').trigger('submit')
    await wrapper.get('form').trigger('submit')
    expect(h.session.orderRequest).toHaveBeenCalledOnce()
    wrapper.unmount()
    complete({})
    await flushPromises()
    expect(useProductDraft().draft.value).toBeNull()
  })

  it('navigates home from pending and not-found views', async () => {
    const router = await routerAt('/product')
    const pending = mount(PendingView, {
      props: { title: 'Товар', copy: 'Скоро' },
      global: { plugins: [router] }
    })
    await pending.get('button').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('home')

    await router.push('/missing')
    const missing = mount(NotFoundView, { global: { plugins: [router] } })
    await missing.get('button').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('home')
  })

  it('renders persisted order cards and opens order details from the whole card', async () => {
    const router = await routerAt('/orders')
    const wrapper = mount(OrdersView, { global: { plugins: [router] } })
    await flushPromises()

    expect(wrapper.findAll('.order-card')).toHaveLength(2)
    expect(wrapper.text()).toContain('Nike Air Max 90 Essential')
    expect(wrapper.text()).toContain('Mini Quilted Shoulder Bag')
    expect(wrapper.text()).toContain('На проверке')
    expect(wrapper.text()).toContain('Расчёт готов')
    expect(wrapper.text()).toContain('Цена продавца')
    expect(wrapper.findAll('.order-card__price small')).toHaveLength(1)
    expect(wrapper.findAll('[role="progressbar"]')).toHaveLength(2)
    expect(h.orderStore.load).toHaveBeenCalledOnce()

    await wrapper.findAll('.order-card')[0].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value).toMatchObject({ name: 'order-details', params: { orderNumber: '12345678-2' } })
  })
})

describe('shared application chrome and controls', () => {
  it('renders authenticated navigation, toggles mobile links, and closes them after navigation', async () => {
    const router = await routerAt('/orders')
    const wrapper = mount(AppHeader, { props: { authenticated: true }, global: { plugins: [router] } })
    expect(wrapper.findAll('.global-support')).toHaveLength(1)
    expect(wrapper.findAll('.app-header__desktop-nav a')).toHaveLength(2)
    expect(wrapper.get('.app-header__nav-action').text()).toBe('Выйти')
    expect(wrapper.get('.brand-lockup__partner').attributes()).toMatchObject({ href: 'https://gtc.express/', target: '_blank', rel: 'noopener noreferrer' })
    await wrapper.get('.app-header__menu-button').trigger('click')
    expect(wrapper.get('.app-header__menu-button').attributes('aria-expanded')).toBe('true')
    expect(wrapper.findAll('.app-header__mobile-nav a')).toHaveLength(3)
    await wrapper.get('.app-header__mobile-nav button').trigger('click')
    expect(wrapper.emitted('logout')).toHaveLength(1)
    await router.push('/profile')
    await flushPromises()
    expect(wrapper.find('.app-header__mobile-nav').exists()).toBe(false)
    await wrapper.setProps({ authenticated: false })
    const actions = wrapper.get('.app-header__actions').element.children
    expect(actions[0].classList.contains('app-header__login')).toBe(true)
    expect(actions[1].classList.contains('global-support')).toBe(true)
    await wrapper.get('.app-header__login').trigger('click')
    expect(wrapper.emitted('authenticate')).toHaveLength(1)
  })

  it('uses server-provided legal aliases, gates the consent shortcut, and shows partner attribution', async () => {
    const router = await routerAt()
    const wrapper = mount(SiteFooter, {
      props: { authenticated: true },
      global: { plugins: [router] }
    })
    expect(wrapper.findAll('.site-footer__links a')).toHaveLength(3)
    expect(wrapper.get('a[href="/legal/privacy-policy"]').exists()).toBe(true)
    expect(wrapper.get('a[href="/consents"]').text()).toBe('Согласия')
    expect(wrapper.get('a[href="https://gtc.express/"]').text()).toBe('Совместно с GTC')
    expect(wrapper.get('.brand-lockup__partner').attributes('target')).toBe('_blank')
    h.store.ops.value = null
    await flushPromises()
    expect(wrapper.findAll('.site-footer__links a')).toHaveLength(1)
    await wrapper.setProps({ authenticated: false })
    expect(wrapper.find('a[href="/consents"]').exists()).toBe(false)
    expect(wrapper.findAll('.site-footer__links a')).toHaveLength(0)
  })

  it('covers button, alert, field, selection, and dialog states', async () => {
    const button = mount(UiButton, {
      props: { variant: 'danger', loading: true, block: true, type: 'submit' },
      slots: { default: 'Удалить' },
      attrs: { 'data-test': 'action' }
    })
    expect(button.get('button').attributes()).toMatchObject({ type: 'submit', disabled: '', 'aria-busy': 'true', 'data-test': 'action' })
    expect(button.get('.ui-button__spinner').exists()).toBe(true)

    const alert = mount(UiAlert, { props: { tone: 'success', title: 'Готово' }, slots: { default: 'Сохранено' } })
    expect(alert.get('[role="status"]').text()).toContain('Готово')
    await alert.setProps({ tone: 'info', title: '' })
    expect(alert.get('[role="status"]').classes()).toContain('ui-alert--info')

    const field = mount(UiField, {
      props: { modelValue: '', label: 'Комментарий', hint: 'Необязательно', multiline: true, rows: 2 }
    })
    expect(field.get('textarea').attributes('aria-describedby')).toContain('-hint')
    await field.get('textarea').setValue('Текст')
    expect(field.emitted('update:modelValue')).toContainEqual(['Текст'])
    await field.setProps({ errors: ['Ошибка', 'Повторите'], disabled: true, readonly: true })
    expect(field.get('textarea').attributes('aria-invalid')).toBe('true')
    expect(field.get('[role="alert"]').text()).toBe('Ошибка Повторите')
    await field.setProps({ multiline: false, errors: 'Ошибка' })
    expect(field.get('input').exists()).toBe(true)

    const selection = mount(UiSelectionControl, { props: { modelValue: false }, slots: { default: 'Выбрать' } })
    await selection.get('input').setValue(true)
    expect(selection.emitted('update:modelValue')).toContainEqual([true])
    await selection.setProps({ kind: 'radio', modelValue: 'a', value: 'b', error: true })
    await selection.get('input').trigger('change')
    expect(selection.emitted('update:modelValue')).toContainEqual(['b'])
    await selection.setProps({ modelValue: 'b', disabled: true })
    expect(selection.get('input').element.checked).toBe(true)

    const dialog = mount(UiDialog, {
      props: { modelValue: true, title: 'Диалог', persistent: true },
      slots: { default: 'Текст', actions: '<button>Закрыть</button>' },
      global: {
        plugins: [createSarafanVuetify()],
        stubs: { VDialog: { props: ['modelValue'], emits: ['update:modelValue'], template: '<section @click="$emit(\'update:modelValue\', false)"><slot /></section>' } }
      }
    })
    expect(dialog.text()).toContain('Диалог')
    await dialog.get('section').trigger('click')
    expect(dialog.emitted('update:modelValue')).toContainEqual([false])
  })
})
