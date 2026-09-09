// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { flushPromises, mount } from '@vue/test-utils'
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
import { createSarafanVuetify } from '../src/plugins/vuetify.js'
import { ACCESS, createAppRouter, routes } from '../src/router.js'
import HomeView from '../src/views/HomeView.vue'
import NotFoundView from '../src/views/NotFoundView.vue'
import PendingView from '../src/views/PendingView.vue'

const h = vi.hoisted(() => ({ store: {} }))
vi.mock('../src/stores/consents.js', () => ({ useConsents: () => h.store }))

async function routerAt(path = '/') {
  const router = createAppRouter(createMemoryHistory())
  await router.push(path)
  return router
}

beforeEach(() => {
  h.store.ops = ref({
    kinds: [
      { value: 2, name: 'Пользовательское соглашение', routeAlias: 'user-agreement' },
      { value: 4, name: 'Политика обработки персональных данных', routeAlias: 'privacy-policy' }
    ]
  })
})

describe('router and page shells', () => {
  it('declares public, limited, customer, detail, and fallback routes', async () => {
    expect(new Set(routes.map(route => route.meta.access))).toEqual(new Set(Object.values(ACCESS)))
    const detail = routes.find(route => route.name === 'order-details')
    expect(detail.props({ params: { orderId: 'A-17' } })).toEqual({
      title: 'Заказ',
      copy: 'Детали заказа A-17 будут подключены отдельной задачей MVP.'
    })
    const router = await routerAt('/does-not-exist')
    expect(router.currentRoute.value.name).toBe('not-found')
    expect(createAppRouter().hasRoute('home')).toBe(true)
  })

  it('submits the public product URL through Vue Router state', async () => {
    const router = await routerAt()
    const wrapper = mount(HomeView, { global: { plugins: [router] } })
    await wrapper.get('input[type="url"]').setValue('https://store.example/item')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('product')
    expect(router.options.history.state.sourceUrl).toBe('https://store.example/item')
    expect(wrapper.findComponent(PublicInfoBlock).exists()).toBe(true)
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
})

describe('shared application chrome and controls', () => {
  it('renders authenticated navigation, toggles mobile links, and closes them after navigation', async () => {
    const router = await routerAt('/orders')
    const wrapper = mount(AppHeader, { props: { authenticated: true }, global: { plugins: [router] } })
    expect(wrapper.findAll('.global-support')).toHaveLength(1)
    expect(wrapper.findAll('.app-header__desktop-nav a')).toHaveLength(2)
    await wrapper.get('.app-header__menu-button').trigger('click')
    expect(wrapper.get('.app-header__menu-button').attributes('aria-expanded')).toBe('true')
    expect(wrapper.findAll('.app-header__mobile-nav a')).toHaveLength(3)
    await router.push('/profile')
    await flushPromises()
    expect(wrapper.find('.app-header__mobile-nav').exists()).toBe(false)
    await wrapper.setProps({ authenticated: false })
    await wrapper.get('.app-header__login').trigger('click')
    expect(wrapper.emitted('authenticate')).toHaveLength(1)
  })

  it('uses server-provided legal aliases and the required partner attribution', async () => {
    const router = await routerAt()
    const wrapper = mount(SiteFooter, { global: { plugins: [router] } })
    expect(wrapper.findAll('.site-footer__links a')).toHaveLength(4)
    expect(wrapper.get('a[href="/legal/privacy-policy"]').exists()).toBe(true)
    expect(wrapper.get('a[href="https://gtc.express/"]').text()).toBe('Совместно с GTC')
    h.store.ops.value = null
    await flushPromises()
    expect(wrapper.findAll('.site-footer__links a')).toHaveLength(2)
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
