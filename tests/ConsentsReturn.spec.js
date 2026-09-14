// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ session:{}, drafts:{} }))
vi.mock('../src/stores/session.js', () => ({ useSession:() => h.session }))
vi.mock('../src/stores/productDraft.js', () => ({ useProductDraft:() => h.drafts }))

import ConsentsView from '../src/views/ConsentsView.vue'

async function mountView(query = { returnTo:'product-submit' }) {
  const empty = { template:'<main />' }
  const router = createRouter({
    history:createMemoryHistory(),
    routes:[
      { path:'/product', name:'product', component:empty },
      { path:'/consents/personal-data', name:'personal-consents', component:ConsentsView, props:{ section:'personal' } }
    ]
  })
  await router.push({ name:'personal-consents', query })
  const wrapper = mount(ConsentsView, {
    props:{ section:'personal' },
    global:{
      plugins:[router],
      stubs:{
        ConsentCenter:{
          name:'ConsentCenter',
          emits:['personal-consent-granted'],
          template:'<div />'
        }
      }
    }
  })
  return { router, wrapper }
}

describe('personal-consent product return', () => {
  beforeEach(() => {
    h.session.customer = ref({ id:7 })
    h.drafts.draft = ref({ resumeMode:'consent', boundCustomerId:7 })
  })

  it('returns to the product after the intended customer grants consent', async () => {
    const { router, wrapper } = await mountView()
    wrapper.getComponent({ name:'ConsentCenter' }).vm.$emit('personal-consent-granted')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('product')
    expect(router.currentRoute.value.query).toEqual({})
  })

  it.each([
    [{}, { resumeMode:'consent', boundCustomerId:7 }, 7],
    [{ returnTo:'product-submit' }, { resumeMode:'none', boundCustomerId:null }, 7],
    [{ returnTo:'product-submit' }, { resumeMode:'consent', boundCustomerId:8 }, 7]
  ])('does not return for an unrelated grant %#', async (query, draft, customerId) => {
    h.drafts.draft.value = draft
    h.session.customer.value = { id:customerId }
    const { router, wrapper } = await mountView(query)
    wrapper.getComponent({ name:'ConsentCenter' }).vm.$emit('personal-consent-granted')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('personal-consents')
  })
})
