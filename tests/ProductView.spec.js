// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ session:{}, consents:{}, drafts:{}, showOrderCreated:vi.fn() }))
vi.mock('../src/stores/session.js', () => ({ useSession:() => h.session }))
vi.mock('../src/stores/consents.js', () => ({ useConsents:() => h.consents }))
vi.mock('../src/stores/productDraft.js', () => ({ useProductDraft:() => h.drafts }))
vi.mock('../src/stores/orderNotices.js', () => ({ showOrderCreated:h.showOrderCreated }))

import { CORE_PROBLEM_TYPES, ProblemError, createInternalProblem } from '../src/errors/problem.js'
import ProductView from '../src/views/ProductView.vue'

const ops = {
  statuses:[{
    value:0,
    name:'На проверке',
    routeAlias:'under_review',
    upperStatusValue:0,
    upperStatusName:'На проверке',
    upperStatusRouteAlias:'under_review',
    isTerminal:false,
    progressPercent:14
  }],
  currencies:[{ value:840, name:'Доллар США', routeAlias:'usd' }]
}

function created(payload = {}) {
  return {
    id:19,
    orderNumber:'12345678-19',
    status:0,
    sourceUrl:'https://shop.example/item',
    productName:null,
    storeName:null,
    imageUrl:null,
    sellerPrice:null,
    dimensions:null,
    characteristics:null,
    quantity:1,
    comment:null,
    appliedExchangeRate:null,
    ...payload
  }
}

function resetDraft(value = {}) {
  h.drafts.draft = ref({
    sourceUrl:'https://shop.example/item',
    quantity:'1',
    comment:'',
    idempotencyKey:null,
    resumeMode:'none',
    boundCustomerId:null,
    ...value
  })
  h.drafts.update = vi.fn(changes => {
    h.drafts.draft.value = { ...h.drafts.draft.value, ...changes }
    return true
  })
  h.drafts.setCanonicalSourceUrl = vi.fn(sourceUrl => {
    h.drafts.draft.value = { ...h.drafts.draft.value, sourceUrl }
    return true
  })
  h.drafts.ensureIdempotencyKey = vi.fn(() => {
    const key = h.drafts.draft.value.idempotencyKey || '11111111-1111-4111-8111-111111111111'
    h.drafts.draft.value = { ...h.drafts.draft.value, idempotencyKey:key }
    return key
  })
  h.drafts.markAuthenticationResume = vi.fn(() => {
    h.drafts.draft.value = { ...h.drafts.draft.value, resumeMode:'authentication', boundCustomerId:null }
  })
  h.drafts.markConsentResume = vi.fn(customerId => {
    h.drafts.draft.value = { ...h.drafts.draft.value, resumeMode:'consent', boundCustomerId:customerId }
  })
  h.drafts.clearResume = vi.fn(() => {
    h.drafts.draft.value = { ...h.drafts.draft.value, resumeMode:'none', boundCustomerId:null }
  })
  h.drafts.clear = vi.fn(() => { h.drafts.draft.value = null })
}

async function mountView() {
  const empty = { template:'<main />' }
  const router = createRouter({
    history:createMemoryHistory(),
    routes:[
      { path:'/', name:'home', component:empty },
      { path:'/product', name:'product', component:ProductView },
      { path:'/consents/personal-data', name:'personal-consents', component:empty },
      { path:'/orders', name:'orders', component:empty }
    ]
  })
  await router.push('/product')
  const wrapper = mount(ProductView, {
    global:{
      plugins:[router],
      stubs:{
        PhoneAuthDialog:{
          name:'PhoneAuthDialog',
          props:['modelValue'],
          emits:['update:modelValue', 'authenticated'],
          template:'<div data-auth-dialog :data-open="modelValue" />'
        }
      }
    }
  })
  await flushPromises()
  return { router, wrapper }
}

describe('ProductView manual fallback', () => {
  beforeEach(() => {
    h.showOrderCreated.mockClear()
    resetDraft()
    h.session.customer = ref(null)
    h.session.restoring = ref(false)
    h.session.previewOrder = vi.fn(async (sourceUrl, isCurrent, validate) => {
      const value = { sourceUrl, outcome:'manual_review' }
      if (isCurrent()) validate(value)
      return value
    })
    h.session.orderRequest = vi.fn(async (_path, _options, isCurrent, validate) => {
      if (isCurrent()) validate(ops)
      return ops
    })
    h.session.createOrder = vi.fn(async (payload, _key, isCurrent, validate) => {
      const value = created({ sourceUrl:payload.sourceUrl, quantity:payload.quantity, comment:payload.comment.trim() || null })
      if (isCurrent()) validate(value)
      return value
    })
    h.consents.hasCurrentPersonalData = vi.fn().mockResolvedValue(true)
  })

  it('shows loading, authoritative canonical URL, and exact manual fallback without quote fields', async () => {
    let resolvePreview
    h.session.previewOrder.mockImplementation((_sourceUrl, isCurrent, validate) => new Promise(resolve => {
      resolvePreview = value => {
        if (isCurrent()) validate(value)
        resolve(value)
      }
    }))
    const mounting = mountView()
    await vi.waitFor(() => expect(resolvePreview).toBeTypeOf('function'))
    const { wrapper } = await mounting
    expect(wrapper.text()).toContain('Проверяем ссылку на товар')
    resolvePreview({ sourceUrl:'https://shop.example/canonical', outcome:'manual_review' })
    await flushPromises()

    expect(wrapper.text()).toContain('Не получилось получить данные о товаре автоматически. Проверим его по ссылке.')
    expect(wrapper.get('.product-source a').attributes('href')).toBe('https://shop.example/canonical')
    expect(wrapper.get('input[type="number"]').element.value).toBe('1')
    expect(wrapper.text()).not.toContain('Цена')
    expect(wrapper.text()).not.toContain('Прогноз')
  })

  it('keeps preview failures recoverable and retries instead of treating them as fallback', async () => {
    h.session.previewOrder
      .mockRejectedValueOnce(createInternalProblem('networkUnavailable'))
      .mockImplementationOnce(async (_sourceUrl, isCurrent, validate) => {
        const value = { sourceUrl:'https://shop.example/item', outcome:'manual_review' }
        if (isCurrent()) validate(value)
        return value
      })
    const { wrapper } = await mountView()
    expect(wrapper.get('[role="alert"]').text()).toContain('Проверьте подключение к интернету')
    expect(wrapper.find('.product-fallback').exists()).toBe(false)
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(wrapper.find('.product-fallback').exists()).toBe(true)
    expect(h.session.previewOrder).toHaveBeenCalledTimes(2)
  })

  it('opens phone-first authentication and cancellation only clears automatic resume', async () => {
    const { wrapper } = await mountView()
    await wrapper.get('form').trigger('submit')
    expect(h.drafts.markAuthenticationResume).toHaveBeenCalledOnce()
    expect(h.drafts.ensureIdempotencyKey).toHaveBeenCalledOnce()
    expect(h.drafts.draft.value.idempotencyKey).toBe('11111111-1111-4111-8111-111111111111')
    const dialog = wrapper.getComponent({ name:'PhoneAuthDialog' })
    expect(dialog.props('modelValue')).toBe(true)
    dialog.vm.$emit('update:modelValue', false)
    await flushPromises()
    expect(h.drafts.clearResume).toHaveBeenCalledOnce()
    expect(h.drafts.clear).not.toHaveBeenCalled()
    expect(h.drafts.draft.value.idempotencyKey).toBe('11111111-1111-4111-8111-111111111111')
  })

  it('continues automatically after phone authentication succeeds', async () => {
    const { router, wrapper } = await mountView()
    await wrapper.get('form').trigger('submit')
    h.session.customer.value = { id:7 }
    wrapper.getComponent({ name:'PhoneAuthDialog' }).vm.$emit('authenticated')
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('orders'))
    expect(h.session.createOrder).toHaveBeenCalledOnce()
  })

  it.each([
    ['abc', '', 'Количество должно быть положительным числом'],
    ['0', '', 'Количество должно быть положительным числом'],
    ['2147483648', '', 'Количество должно быть положительным числом'],
    ['1', 'x'.repeat(2001), 'Комментарий не должен превышать 2000 символов']
  ])('keeps invalid quantity/comment values editable', async (quantity, comment, message) => {
    resetDraft({ quantity, comment })
    h.session.customer.value = { id:7 }
    const { wrapper } = await mountView()
    await wrapper.get('form').trigger('submit')
    expect(wrapper.text()).toContain(message)
    expect(h.consents.hasCurrentPersonalData).not.toHaveBeenCalled()
    expect(h.session.createOrder).not.toHaveBeenCalled()
  })

  it('routes missing consent through the fixed return flow', async () => {
    h.session.customer.value = { id:7 }
    h.consents.hasCurrentPersonalData.mockResolvedValue(false)
    const { router, wrapper } = await mountView()
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(h.drafts.markConsentResume).toHaveBeenCalledWith(7)
    expect(router.currentRoute.value).toMatchObject({
      name:'personal-consents',
      query:{ returnTo:'product-submit' }
    })
    expect(h.session.createOrder).not.toHaveBeenCalled()
  })

  it('automatically resumes a consent-bound draft and opens My Orders after creation', async () => {
    resetDraft({ resumeMode:'consent', boundCustomerId:7 })
    h.session.customer.value = { id:7 }
    const { router } = await mountView()
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('orders'))
    expect(h.session.createOrder).toHaveBeenCalledWith(
      { sourceUrl:'https://shop.example/item', quantity:1, comment:'' },
      '11111111-1111-4111-8111-111111111111',
      expect.any(Function),
      expect.any(Function)
    )
    expect(h.drafts.clear).toHaveBeenCalledOnce()
    expect(h.showOrderCreated).toHaveBeenCalledWith('12345678-19')
  })

  it('handles a consent-renewal race reported by Core through the same return flow', async () => {
    h.session.customer.value = { id:7 }
    h.session.createOrder.mockRejectedValue(new ProblemError({
      type:CORE_PROBLEM_TYPES.personalDataConsentRequired,
      title:'Требуется согласие',
      status:403,
      detail:'Дайте актуальное согласие.',
      instance:'/api/v1/orders',
      code:'personal_data_consent_required'
    }))
    const { router, wrapper } = await mountView()
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(router.currentRoute.value).toMatchObject({
      name:'personal-consents', query:{ returnTo:'product-submit' }
    })
    expect(h.drafts.markConsentResume).toHaveBeenCalledWith(7)
  })

  it('reuses the idempotency key after an ambiguous creation failure', async () => {
    h.session.customer.value = { id:7 }
    h.session.createOrder
      .mockRejectedValueOnce(createInternalProblem('networkUnavailable'))
      .mockImplementationOnce(async (payload, _key, isCurrent, validate) => {
        const value = created({ sourceUrl:payload.sourceUrl, quantity:payload.quantity })
        if (isCurrent()) validate(value)
        return value
      })
    const { router, wrapper } = await mountView()
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('orders'))
    const keys = h.session.createOrder.mock.calls.map(call => call[1])
    expect(keys).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111111'
    ])
  })

  it('drops consent auto-resume after an identity change but retains the draft', async () => {
    resetDraft({ resumeMode:'consent', boundCustomerId:8 })
    h.session.customer.value = { id:7 }
    const { router } = await mountView()
    expect(router.currentRoute.value.name).toBe('product')
    expect(h.drafts.clearResume).toHaveBeenCalled()
    expect(h.drafts.clear).not.toHaveBeenCalled()
    expect(h.session.createOrder).not.toHaveBeenCalled()
  })

  it('blocks a submission still bound to another customer', async () => {
    resetDraft({ resumeMode:'none', boundCustomerId:8 })
    h.session.customer.value = { id:7 }
    const { wrapper } = await mountView()
    await wrapper.get('form').trigger('submit')
    expect(wrapper.text()).toContain('Пользователь изменился')
    expect(h.drafts.clearResume).toHaveBeenCalled()
    expect(h.session.createOrder).not.toHaveBeenCalled()
  })

  it('prevents concurrent creation submissions', async () => {
    let resolveConsent
    h.session.customer.value = { id:7 }
    h.consents.hasCurrentPersonalData.mockReturnValue(new Promise(resolve => { resolveConsent = resolve }))
    const { wrapper } = await mountView()
    await wrapper.get('form').trigger('submit')
    await wrapper.get('form').trigger('submit')
    expect(h.consents.hasCurrentPersonalData).toHaveBeenCalledOnce()
    resolveConsent(true)
    await flushPromises()
    expect(h.session.createOrder).toHaveBeenCalledOnce()
  })

  it('lets the customer abandon the draft and choose another product', async () => {
    const { router, wrapper } = await mountView()
    await wrapper.findAll('.product-actions button')[1].trigger('click')
    await flushPromises()
    expect(h.drafts.clear).toHaveBeenCalledOnce()
    expect(router.currentRoute.value.name).toBe('home')
  })

  it('rejects malformed canonical preview data and ignores a late preview after unmount', async () => {
    h.session.previewOrder.mockImplementationOnce(async (_sourceUrl, isCurrent, validate) => {
      const value = { sourceUrl:'shop.example/item', outcome:'manual_review' }
      if (isCurrent()) validate(value)
      return value
    })
    const malformed = await mountView()
    expect(malformed.wrapper.find('.product-fallback').exists()).toBe(false)
    expect(malformed.wrapper.get('[role="alert"]').text()).toContain('Сервис временно недоступен')
    malformed.wrapper.unmount()

    let resolvePreview
    h.session.previewOrder.mockImplementationOnce((_sourceUrl, isCurrent, validate) => new Promise(resolve => {
      resolvePreview = value => {
        if (isCurrent()) validate(value)
        resolve(value)
      }
    }))
    const late = await mountView()
    late.wrapper.unmount()
    resolvePreview({ sourceUrl:'https://shop.example/item', outcome:'manual_review' })
    await flushPromises()
    expect(h.drafts.setCanonicalSourceUrl).not.toHaveBeenCalled()
  })

  it('redirects to Home when there is no restorable draft', async () => {
    h.drafts.draft.value = null
    const { router } = await mountView()
    expect(router.currentRoute.value.name).toBe('home')
    expect(h.session.previewOrder).not.toHaveBeenCalled()
  })
})
