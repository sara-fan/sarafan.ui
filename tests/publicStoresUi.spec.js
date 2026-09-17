// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { createMemoryHistory } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App.vue'
import { createAppRouter } from '../src/router.js'
import { createSarafanVuetify } from '../src/plugins/vuetify.js'

const h = vi.hoisted(() => ({ session:{}, request:vi.fn() }))
vi.mock('../src/stores/session.js', () => ({ useSession:() => h.session }))
vi.mock('../src/stores/consents.js', () => ({ useConsents:() => ({ noticeSuppressed:ref(false) }) }))
vi.mock('../src/stores/publicStores.js', async original => {
  const actual = await original()
  return { ...actual, createPublicStores:() => actual.createPublicStores({ request:h.request }) }
})
const item = (id = 1, name = 'Магазин') => ({ id, name, description:'Описание '.repeat(16), officialUrl:'https://example.com/', logoUrl:`/api/v1/stores/${id}/logo?v=${'a'.repeat(64)}` })
let wrapper, router
async function render(path = '/') {
  router = createAppRouter(createMemoryHistory())
  await router.push(path)
  wrapper = mount(App, { attachTo:document.body, global:{ plugins:[router, createSarafanVuetify()], stubs:{ ConsentCenter:true, PhoneAuthDialog:true, SiteFooter:true } } })
  await flushPromises()
}
beforeEach(() => {
  Object.assign(h.session, { customer:ref(null), restoring:ref(true), restoreProblem:ref(null), restoreSession:vi.fn().mockResolvedValue(), logout:vi.fn().mockResolvedValue() })
  h.request.mockReset().mockResolvedValue({ items:[] })
})
afterEach(() => { wrapper?.unmount(); wrapper = null; vi.restoreAllMocks() })

describe('public store journeys', () => {
  it('loads featured stores when the initial home route resolves after shell mounting', async () => {
    h.request.mockResolvedValue({ items:[item()] })
    router = createAppRouter(createMemoryHistory())
    wrapper = mount(App, { global:{ plugins:[router, createSarafanVuetify()], stubs:{ ConsentCenter:true, PhoneAuthDialog:true, SiteFooter:true } } })
    await router.isReady()
    await flushPromises()
    expect(h.request).toHaveBeenCalledWith('/api/v1/stores/featured')
    expect(wrapper.findAll('.featured-stores .store-card')).toHaveLength(1)
  })
  it('keeps purchase entry and hides all store affordances when both lists are empty', async () => {
    await render()
    expect(wrapper.text()).toContain('Рассчитать стоимость')
    expect(wrapper.find('a[href="/stores"]').exists()).toBe(false)
    expect(wrapper.find('.featured-stores').exists()).toBe(false)
    expect(wrapper.find('.store-catalogue-notice').exists()).toBe(false)
    expect(h.session.restoreSession).toHaveBeenCalledOnce()
    const replace = vi.spyOn(router, 'replace')
    await router.push('/stores'); await flushPromises()
    expect(router.currentRoute.value.name).toBe('home')
    expect(replace).toHaveBeenCalledWith({ name:'home' })
  })
  it.each([false,true])('shows public desktop/mobile navigation independently of authentication %s', async authenticated => {
    h.session.customer.value = authenticated ? { id:7 } : null
    h.request.mockImplementation(async path => ({ items:path.includes('featured') ? [] : [item()] }))
    await render()
    expect(wrapper.get('.app-header__desktop-nav a[href="/stores"]').text()).toBe('Магазины')
    expect(wrapper.find('.featured-stores').exists()).toBe(false)
    await wrapper.get('.app-header__menu-button').trigger('click')
    expect(wrapper.get('.app-header__mobile-nav a[href="/stores"]').text()).toBe('Магазины')
    expect(wrapper.find('.app-header__mobile-nav a[href="/orders"]').exists()).toBe(authenticated)
    await wrapper.get('.app-header__mobile-nav a[href="/stores"]').trigger('click'); await flushPromises()
    expect(wrapper.get('h1').text()).toBe('Магазины США')
    expect(wrapper.find('.app-header__mobile-nav').exists()).toBe(false)
  })
  it.each([1,5,6])('renders exactly %s featured records as safe native cards', async count => {
    const items = Array.from({ length:count }, (_,i) => item(i+1, `Магазин ${i}`))
    h.request.mockResolvedValue({ items })
    await render()
    const cards = wrapper.findAll('.featured-stores .store-card')
    expect(cards).toHaveLength(count)
    expect(cards[0].attributes()).toMatchObject({ href:'https://example.com/', target:'_blank', rel:'noopener noreferrer', 'aria-label':'Магазин 0 — открыть сайт в новой вкладке' })
    expect(wrapper.get('.featured-stores h2').text()).toBe('Популярные магазины США')
    expect(wrapper.get('.featured-stores a[href="/stores"]').text()).toBe('Все магазины')
    expect(wrapper.get('.store-card img').attributes('src')).toBe(items[0].logoUrl)
  })
  it('preserves server ordering, query sorting, back/forward, and homepage selection', async () => {
    h.request.mockImplementation(async path => ({ items:path.includes('name-asc') ? [item(2,'Alpha'), item(1,'Альфа')] : [item(1,'Альфа'),item(2,'Alpha')] }))
    await render('/stores?sort=name-asc')
    expect(wrapper.findAll('.store-card h3').map(node => node.text())).toEqual(['Alpha','Альфа'])
    expect(wrapper.get('#store-sort').element.value).toBe('name-asc')
    expect(wrapper.findAll('#store-sort option').map(node => node.text())).toEqual(['Рекомендуемые','По названию: А–Я / A–Z','По названию: Я–А / Z–A'])
    await wrapper.get('#store-sort').setValue('name-desc'); await flushPromises()
    expect(router.currentRoute.value.query.sort).toBe('name-desc')
    expect(wrapper.findAll('.store-card h3').map(node => node.text())).toEqual(['Альфа','Alpha'])
    router.back(); await flushPromises()
    expect(wrapper.get('#store-sort').element.value).toBe('name-asc')
    router.forward(); await flushPromises()
    expect(wrapper.get('#store-sort').element.value).toBe('name-desc')
    await router.push('/'); await flushPromises()
    expect(h.request).toHaveBeenCalledWith('/api/v1/stores/featured')
    expect(wrapper.findAll('.featured-stores h3').map(node => node.text())).toEqual(['Альфа','Alpha'])
  })
  it.each(['/stores?sort=bad','/stores?sort=','/stores?sort=name-asc&sort=name-desc'])('normalizes invalid sort URL %s', async path => {
    h.request.mockResolvedValue({ items:[item()] })
    await render(path)
    expect(router.currentRoute.value.query.sort).toBe('recommended')
    expect(wrapper.get('#store-sort').element.value).toBe('recommended')
    expect(h.request.mock.calls.every(([path]) => path === '/api/v1/stores?sort=recommended')).toBe(true)
  })
  it('keeps failures recoverable in place, without identity changes or duplicate alerts', async () => {
    h.session.customer.value = { id:7 }
    h.request.mockRejectedValue(new Error('private payload'))
    await render('/stores')
    expect(router.currentRoute.value.name).toBe('stores')
    expect(wrapper.findAll('.store-catalogue-notice')).toHaveLength(1)
    expect(wrapper.text()).not.toContain('private payload')
    expect(wrapper.find('a[href="/stores"]').exists()).toBe(false)
    expect(h.session.customer.value).toEqual({ id:7 })
    h.request.mockResolvedValue({ items:[item()] })
    await wrapper.get('.store-catalogue-notice button').trigger('click'); await flushPromises()
    expect(wrapper.find('.store-catalogue-notice').exists()).toBe(false)
    expect(wrapper.findAll('.store-card')).toHaveLength(1)
    h.request.mockRejectedValue(new Error('outage'))
    await router.push('/'); await flushPromises()
    expect(wrapper.findAll('.store-catalogue-notice')).toHaveLength(1)
    expect(wrapper.text()).toContain('Рассчитать стоимость')
    await router.push('/missing'); await flushPromises()
    expect(wrapper.findAll('.store-catalogue-notice')).toHaveLength(1)
  })
  it('waits for confirmed availability and replaces the route when tab revalidation removes the last store', async () => {
    let resolve
    h.request.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    await render('/stores')
    expect(wrapper.text()).toContain('Загрузка магазинов')
    expect(router.currentRoute.value.name).toBe('stores')
    resolve({ items:[item()] }); await flushPromises()
    const replace = vi.spyOn(router, 'replace')
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    const calls = h.request.mock.calls.length
    document.dispatchEvent(new globalThis.Event('visibilitychange')); await flushPromises()
    expect(h.request).toHaveBeenCalledTimes(calls)
    visibility.mockReturnValue('visible')
    h.request.mockResolvedValue({ items:[] })
    document.dispatchEvent(new globalThis.Event('visibilitychange')); await flushPromises()
    expect(router.currentRoute.value.name).toBe('home')
    expect(replace).toHaveBeenCalledWith({ name:'home' })
    expect(wrapper.find('a[href="/stores"]').exists()).toBe(false)
  })
  it('renders merchant text literally and treats malformed payloads as recoverable errors', async () => {
    h.request.mockResolvedValue({ items:[item(1,'<img onerror="alert(1)">')] })
    await render('/stores')
    expect(wrapper.get('.store-card h3').text()).toBe('<img onerror="alert(1)">')
    expect(wrapper.find('.store-card h3 img').exists()).toBe(false)
    h.request.mockResolvedValue({ items:[{ ...item(), officialUrl:'javascript:alert(1)' }] })
    document.dispatchEvent(new globalThis.Event('visibilitychange')); await flushPromises()
    expect(wrapper.find('.store-catalogue-notice').exists()).toBe(true)
    expect(router.currentRoute.value.name).toBe('stores')
  })
})
