// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { defineComponent, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { createAppRouter } from '../src/router.js'
import { createSarafanVuetify } from '../src/plugins/vuetify.js'
import { resetConsentsForTests, useConsents } from '../src/stores/consents.js'
import { createInternalProblem } from '../src/errors/problem.js'
import ConsentCenter from '../src/components/ConsentCenter.vue'
import ProfileView from '../src/views/ProfileView.vue'

const h = vi.hoisted(() => ({ session:{} }))
vi.mock('../src/stores/session.js', () => ({ useSession:() => h.session }))
let wrapper
afterEach(() => { wrapper?.unmount(); resetConsentsForTests() })

it('keeps one foreground outage owner with the shell notice and profile mounted', async () => {
  h.session.customer = ref({ id:7, phone:'+79990000007', hasPhoto:false, profile:{} })
  h.session.consentRequest = vi.fn().mockRejectedValue(createInternalProblem('networkUnavailable'))
  h.session.getPhoto = vi.fn()
  h.session.updateProfile = vi.fn()
  h.session.isCurrentIdentityInvalidation = () => false
  resetConsentsForTests()
  const store = useConsents()
  const router = createAppRouter(createMemoryHistory())
  await router.push('/profile')
  wrapper = mount(defineComponent({
    components:{ ProfileView, ConsentCenter },
    setup:() => ({ noticeSuppressed:store.noticeSuppressed }),
    template:'<ProfileView /><ConsentCenter :notice-suppressed="noticeSuppressed" />'
  }), { global:{ plugins:[router, createSarafanVuetify()] } })
  await flushPromises()
  expect(wrapper.findAll('[role="alert"], .consent-recovery-notice')).toHaveLength(1)
  await wrapper.findAll('button').find(button => button.text() === 'Редактировать').trigger('click')
  await wrapper.get('input[name="firstName"]').setValue('Черновик')
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  expect(store.noticeSuppressed.value).toBe(true)
  expect(wrapper.findAll('[role="alert"], .consent-recovery-notice')).toHaveLength(1)
  expect(wrapper.findComponent(ProfileView).get('[role="alert"]').text()).toContain('Проверьте подключение')
  expect(wrapper.get('input[name="firstName"]').element.value).toBe('Черновик')
  expect(h.session.updateProfile).not.toHaveBeenCalled()
  await wrapper.findComponent(ProfileView).findAll('button').find(button => button.text() === 'Отмена').trigger('click')
  expect(store.noticeSuppressed.value).toBe(false)
  expect(wrapper.findAll('[role="alert"], .consent-recovery-notice')).toHaveLength(1)
  wrapper.unmount()
  expect(store.noticeSuppressed.value).toBe(false)
})