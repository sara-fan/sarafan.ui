// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ session:{}, consents:{}, showOrderCreated:vi.fn() }))
vi.mock('../src/stores/session.js', () => ({ useSession:() => h.session }))
vi.mock('../src/stores/consents.js', () => ({ useConsents:() => h.consents }))
vi.mock('../src/stores/orderNotices.js', () => ({ showOrderCreated:h.showOrderCreated }))

import { CORE_PROBLEM_TYPES, ProblemError, createInternalProblem } from '../src/errors/problem.js'
import { resetProductDraftForTests, useProductDraft } from '../src/stores/productDraft.js'
import ProductView from '../src/views/ProductView.vue'
import { completeOrder, ops, product } from './fixtures/orders.js'

const IDEMPOTENCY_KEY = '11111111-1111-4111-8111-111111111111'

function created(payload, overrides = {}) {
  return completeOrder({
    id:19,
    orderNumber:'12345678-19',
    sourceUrl:payload.sourceUrl,
    product:{
      ...payload.product,
      quantity:payload.quantity,
      comment:payload.comment
    },
    ...overrides
  })
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

function startDraft(changes = {}) {
  const drafts = useProductDraft()
  drafts.start('shop.example.com/item')
  if (Object.keys(changes).length) drafts.update(changes)
  return drafts
}

describe('ProductView product review', () => {
  beforeEach(() => {
    globalThis.sessionStorage.clear()
    resetProductDraftForTests()
    vi.restoreAllMocks()
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(IDEMPOTENCY_KEY)
    h.showOrderCreated.mockClear()
    h.session.customer = ref(null)
    h.session.restoring = ref(false)
    h.session.isCurrentIdentityInvalidation = vi.fn().mockReturnValue(false)
    h.session.previewOrder = vi.fn(async (sourceUrl, isCurrent, validate) => {
      const value = { sourceUrl, outcome:'manual_review', product:null }
      if (isCurrent()) validate(value)
      return value
    })
    h.session.orderRequest = vi.fn(async (_path, _options, isCurrent, validate) => {
      if (isCurrent()) validate(ops)
      return ops
    })
    h.session.createOrder = vi.fn(async (payload, _key, isCurrent, validate) => {
      const value = created(payload)
      if (isCurrent()) validate(value)
      return value
    })
    h.consents.hasCurrentPersonalData = vi.fn().mockResolvedValue(true)
    h.consents.acquireNoticeSuppression = vi.fn(() => vi.fn())
    startDraft()
  })

  it('shows loading, canonical source, and the complete manual form', async () => {
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
    resolvePreview({ sourceUrl:'https://shop.example.com/canonical', outcome:'manual_review', product:null })
    await flushPromises()

    expect(wrapper.text()).toContain('Не получилось получить все данные о товаре автоматически')
    expect(wrapper.get('.product-source-field a').attributes('href')).toBe('https://shop.example.com/canonical')
    expect(wrapper.get('input[name="quantity"]').element.value).toBe('1')
    expect(wrapper.findAll('.product-review__fields .ui-field')).toHaveLength(8)
    expect(wrapper.get('.product-review__summary').text()).toContain('Стоимостьуточняется')
  })

  it('prefills recognized values with Russian money formatting without overwriting edits', async () => {
    useProductDraft().update({ productName:'Моё название', comment:'Мой комментарий' })
    h.session.previewOrder.mockImplementation(async (_sourceUrl, isCurrent, validate) => {
      const value = {
        sourceUrl:'https://shop.example.com/canonical',
        outcome:'recognized',
        product:product({ sellerPrice:{ amount:16.5, currency:840 } })
      }
      if (isCurrent()) validate(value)
      return value
    })
    const { wrapper } = await mountView()
    expect(wrapper.text()).toContain('Проверьте распознанные данные')
    expect(wrapper.get('input[name="productName"]').element.value).toBe('Моё название')
    expect(wrapper.get('input[name="sellerPrice"]').element.value).toBe('16,50')
    expect(wrapper.get('textarea[name="comment"]').element.value).toBe('Мой комментарий')
  })

  it('validates quantity and the dynamic total limit before authentication', async () => {
    const { wrapper } = await mountView()
    await wrapper.get('input[name="productName"]').setValue('Товар')
    await wrapper.get('input[name="sellerPrice"]').setValue('300,00')
    await wrapper.get('input[name="quantity"]').setValue('5')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.text()).toContain('Такое количество товара может быть признано коммерческой партией и запрещено к ввозу')
    expect(h.session.createOrder).not.toHaveBeenCalled()

    await wrapper.get('input[name="quantity"]').setValue('4')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.text()).toContain(ops.productLimits.valueLimit.exceededMessage)
    expect(wrapper.get('[data-auth-dialog]').attributes('data-open')).toBe('false')
  })

  it('accepts a dot or comma price and submits the full normalized payload after fresh Ops', async () => {
    h.session.customer.value = { id:7 }
    const { router, wrapper } = await mountView()
    await wrapper.get('input[name="storeName"]').setValue(' Amazon ')
    await wrapper.get('input[name="productName"]').setValue(' Термос ')
    await wrapper.get('input[name="sellerPrice"]').setValue('16.5')
    await wrapper.get('input[name="sellerPrice"]').trigger('blur')
    expect(wrapper.get('input[name="sellerPrice"]').element.value).toBe('16,50')
    await wrapper.get('input[name="quantity"]').setValue('2')
    await wrapper.get('input[name="color"]').setValue(' cherry ')
    await wrapper.get('input[name="size"]').setValue(' 1 л ')
    await wrapper.get('textarea[name="comment"]').setValue(' подарок ')
    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('orders'))
    expect(h.session.orderRequest).toHaveBeenCalledTimes(2)
    expect(h.session.createOrder).toHaveBeenCalledWith({
      sourceUrl:'https://shop.example.com/item',
      product:{
        storeName:'Amazon', productName:'Термос', sellerPrice:{ amount:16.5, currency:840 },
        color:'cherry', size:'1 л'
      },
      quantity:2,
      comment:'подарок'
    }, IDEMPOTENCY_KEY, expect.any(Function), expect.any(Function))
    expect(h.showOrderCreated).toHaveBeenCalledWith(7, '12345678-19')
    expect(useProductDraft().draft.value).toBeNull()
  })

  it('blocks creation while the common rate pair is unavailable and retries Ops', async () => {
    const unavailable = {
      ...ops,
      productLimits:{
        ...ops.productLimits,
        valueLimit:{ ...ops.productLimits.valueLimit, available:false, sourceEffectiveDate:null, maximumTotalUsd:null }
      }
    }
    h.session.orderRequest
      .mockImplementationOnce(async (_path, _options, isCurrent, validate) => {
        if (isCurrent()) validate(unavailable)
        return unavailable
      })
      .mockImplementation(async (_path, _options, isCurrent, validate) => {
        if (isCurrent()) validate(ops)
        return ops
      })
    const { wrapper } = await mountView()
    expect(wrapper.text()).toContain('Проверка лимита временно недоступна')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    await wrapper.get('.product-review__summary .ui-alert button').trigger('click')
    await flushPromises()
    expect(wrapper.find('.product-review__summary .ui-alert').exists()).toBe(false)
  })

  it('keeps a failed rate retry recoverable', async () => {
    const unavailable = {
      ...ops,
      productLimits:{
        ...ops.productLimits,
        valueLimit:{ ...ops.productLimits.valueLimit, available:false, sourceEffectiveDate:null, maximumTotalUsd:null }
      }
    }
    h.session.orderRequest
      .mockImplementationOnce(async (_path, _options, isCurrent, validate) => {
        if (isCurrent()) validate(unavailable)
        return unavailable
      })
      .mockRejectedValueOnce(createInternalProblem('networkUnavailable'))
    const { wrapper } = await mountView()
    await wrapper.get('.product-review__summary .ui-alert button').trigger('click')
    await flushPromises()
    expect(wrapper.get('.product-view > [role="alert"]').text()).toContain('Проверьте подключение к интернету')
  })

  it('keeps a preview failure recoverable and retries it', async () => {
    h.session.previewOrder
      .mockRejectedValueOnce(createInternalProblem('networkUnavailable'))
      .mockImplementationOnce(async (sourceUrl, isCurrent, validate) => {
        const value = { sourceUrl, outcome:'manual_review', product:null }
        if (isCurrent()) validate(value)
        return value
      })
    const { wrapper } = await mountView()
    expect(wrapper.get('[role="alert"]').text()).toContain('Проверьте подключение к интернету')
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(wrapper.find('form').exists()).toBe(true)
    expect(h.session.previewOrder).toHaveBeenCalledTimes(2)
  })

  it('preserves the draft and resumes after phone authentication', async () => {
    const { router, wrapper } = await mountView()
    await wrapper.get('input[name="productName"]').setValue('Товар')
    await wrapper.get('input[name="sellerPrice"]').setValue('10,00')
    await wrapper.get('form').trigger('submit')
    expect(useProductDraft().draft.value.resumeMode).toBe('authentication')
    const dialog = wrapper.getComponent({ name:'PhoneAuthDialog' })
    expect(dialog.props('modelValue')).toBe(true)
    h.session.customer.value = { id:7 }
    dialog.vm.$emit('authenticated')
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('orders'))
    expect(h.session.createOrder).toHaveBeenCalledOnce()
  })

  it('clears only automatic resume when authentication is cancelled', async () => {
    const { wrapper } = await mountView()
    await wrapper.get('input[name="productName"]').setValue('Товар')
    await wrapper.get('input[name="sellerPrice"]').setValue('10')
    await wrapper.get('form').trigger('submit')
    wrapper.getComponent({ name:'PhoneAuthDialog' }).vm.$emit('update:modelValue', false)
    await flushPromises()
    expect(useProductDraft().draft.value).toMatchObject({ resumeMode:'none', productName:'Товар' })
  })

  it('routes missing consent and automatically resumes for the bound customer', async () => {
    h.session.customer.value = { id:7 }
    h.consents.hasCurrentPersonalData.mockResolvedValueOnce(false)
    const { router, wrapper } = await mountView()
    await wrapper.get('input[name="productName"]').setValue('Товар')
    await wrapper.get('input[name="sellerPrice"]').setValue('10')
    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('personal-consents'))
    expect(router.currentRoute.value.query).toEqual({ returnTo:'product-submit' })
    expect(useProductDraft().draft.value).toMatchObject({ resumeMode:'consent', boundCustomerId:7 })

    wrapper.unmount()
    await router.push('/product')
    const resumed = mount(ProductView, { global:{ plugins:[router], stubs:{ PhoneAuthDialog:true } } })
    await vi.waitFor(() => expect(h.session.createOrder).toHaveBeenCalledOnce())
    resumed.unmount()
  })

  it('reuses the idempotency key after an ambiguous failure and accepts a corrected replay', async () => {
    h.session.customer.value = { id:7 }
    h.session.createOrder
      .mockRejectedValueOnce(createInternalProblem('networkUnavailable'))
      .mockImplementationOnce(async (payload, _key, isCurrent, validate) => {
        const value = created(payload, { product:product({ productName:'Исправлено сотрудником', quantity:4 }) })
        if (isCurrent()) validate(value)
        return value
      })
    const { router, wrapper } = await mountView()
    await wrapper.get('input[name="productName"]').setValue('Товар')
    await wrapper.get('input[name="sellerPrice"]').setValue('10')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(useProductDraft().draft.value.idempotencyKey).toBe(IDEMPOTENCY_KEY)
    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('orders'))
    expect(h.session.createOrder.mock.calls[0][1]).toBe(IDEMPOTENCY_KEY)
    expect(h.session.createOrder.mock.calls[1][1]).toBe(IDEMPOTENCY_KEY)
  })

  it('invalidates submission when customer identity changes and keeps the form', async () => {
    h.session.customer.value = { id:7 }
    let resolveConsent
    h.consents.hasCurrentPersonalData.mockReturnValue(new Promise(resolve => { resolveConsent = resolve }))
    const { wrapper } = await mountView()
    await wrapper.get('input[name="productName"]').setValue('Товар')
    await wrapper.get('input[name="sellerPrice"]').setValue('10')
    await wrapper.get('form').trigger('submit')
    h.session.customer.value = { id:8 }
    await flushPromises()
    resolveConsent(true)
    await flushPromises()
    expect(wrapper.text()).toContain('Проверьте данные заказа и отправьте его ещё раз')
    expect(h.session.createOrder).not.toHaveBeenCalled()
  })

  it('shows Core field errors under the matching control without a duplicate page alert', async () => {
    h.session.customer.value = { id:7 }
    h.session.createOrder.mockRejectedValueOnce(new ProblemError({
      type:CORE_PROBLEM_TYPES.validationFailed,
      title:'Некорректный запрос',
      status:400,
      detail:'Исправьте указанные поля',
      instance:'urn:sarafan:problem:4bf92f3577b34da6a3ce929d0e0e4736',
      code:'validation_failed',
      errors:{ sellerPrice:['Проверьте цену'] }
    }))
    const { wrapper } = await mountView()
    await wrapper.get('input[name="productName"]').setValue('Товар')
    await wrapper.get('input[name="sellerPrice"]').setValue('10')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('input[name="sellerPrice"]').element.closest('.ui-field').textContent).toContain('Проверьте цену')
    expect(wrapper.find('.product-view > [role="alert"]').exists()).toBe(false)
  })

  it('handles a consent-renewal race reported by Core through the same return flow', async () => {
    h.session.customer.value = { id:7 }
    h.session.createOrder.mockRejectedValueOnce(new ProblemError({
      type:CORE_PROBLEM_TYPES.personalDataConsentRequired,
      title:'Требуется согласие',
      status:403,
      detail:'Подтвердите согласие',
      instance:'urn:sarafan:problem:4bf92f3577b34da6a3ce929d0e0e4736',
      code:'personal_data_consent_required'
    }))
    const { router, wrapper } = await mountView()
    await wrapper.get('input[name="productName"]').setValue('Товар')
    await wrapper.get('input[name="sellerPrice"]').setValue('10')
    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('personal-consents'))
    expect(useProductDraft().draft.value).toMatchObject({ resumeMode:'consent', boundCustomerId:7 })
  })

  it('blocks a submission still bound to another customer', async () => {
    h.session.customer.value = { id:7 }
    h.session.previewOrder.mockImplementation(async (sourceUrl, isCurrent, validate) => {
      const value = { sourceUrl, outcome:'recognized', product:product() }
      if (isCurrent()) validate(value)
      return value
    })
    const { wrapper } = await mountView()
    useProductDraft().markConsentResume(8)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('Проверьте данные заказа и отправьте его ещё раз')
    expect(h.session.createOrder).not.toHaveBeenCalled()
  })

  it.each([
    ['productName'], ['storeName'], ['sellerPrice'], ['quantity'], ['color'], ['size'], ['comment']
  ])('marks %s as touched on blur', async field => {
    const { wrapper } = await mountView()
    await wrapper.get(`[name="${field}"]`).trigger('blur')
    if (field === 'productName' || field === 'sellerPrice') {
      expect(wrapper.get(`[name="${field}"]`).element.closest('.ui-field').classList.contains('ui-field--error')).toBe(true)
    }
  })

  it('resumes an authentication-bound draft for both signed-in and anonymous states', async () => {
    h.session.previewOrder.mockImplementation(async (sourceUrl, isCurrent, validate) => {
      const value = { sourceUrl, outcome:'recognized', product:product() }
      if (isCurrent()) validate(value)
      return value
    })
    useProductDraft().markAuthenticationResume()
    const anonymous = await mountView()
    expect(anonymous.wrapper.getComponent({ name:'PhoneAuthDialog' }).props('modelValue')).toBe(true)
    anonymous.wrapper.unmount()

    resetProductDraftForTests()
    startDraft()
    useProductDraft().markAuthenticationResume()
    h.session.customer.value = { id:7 }
    const signedIn = await mountView()
    await vi.waitFor(() => expect(h.session.createOrder).toHaveBeenCalledOnce())
    signedIn.wrapper.unmount()
  })

  it('prevents concurrent creation submissions', async () => {
    h.session.customer.value = { id:7 }
    let finishConsent
    h.consents.hasCurrentPersonalData.mockReturnValue(new Promise(resolve => { finishConsent = resolve }))
    const { wrapper } = await mountView()
    await wrapper.get('input[name="productName"]').setValue('Товар')
    await wrapper.get('input[name="sellerPrice"]').setValue('10')
    await wrapper.get('form').trigger('submit')
    await wrapper.get('form').trigger('submit')
    expect(h.consents.hasCurrentPersonalData).toHaveBeenCalledOnce()
    finishConsent(true)
    await flushPromises()
  })

  it('clears the draft when the customer chooses another product', async () => {
    const { router, wrapper } = await mountView()
    await wrapper.get('.product-back').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('home')
    expect(useProductDraft().draft.value).toBeNull()
  })

  it('redirects to Home when no restorable draft exists', async () => {
    useProductDraft().clear()
    const { router } = await mountView()
    expect(router.currentRoute.value.name).toBe('home')
    expect(h.session.previewOrder).not.toHaveBeenCalled()
  })
})
