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
afterEach(() => { wrapper?.unmount(); wrapper = null; resetConsentsForTests(); vi.unstubAllGlobals() })

async function failedProfileSave(hasPhoto = false) {
  vi.stubGlobal('URL', { createObjectURL:vi.fn().mockReturnValue('blob:profile-photo'), revokeObjectURL:vi.fn() })
  h.session.customer = ref({ id:7, phone:'+79990000007', hasPhoto, profile:{} })
  h.session.consentRequest = vi.fn().mockRejectedValue(createInternalProblem('networkUnavailable'))
  h.session.getPhoto = vi.fn().mockResolvedValue(new globalThis.Blob(['saved photo'], { type:'image/png' }))
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
  return store
}

async function selectPhoto(type = 'image/png') {
  const input = wrapper.findComponent(ProfileView).get('input[type="file"]')
  Object.defineProperty(input.element, 'files', {
    value:[new globalThis.File(['draft photo'], 'photo.png', { type })], configurable:true
  })
  await input.trigger('change')
  await flushPromises()
}

it('keeps one foreground outage owner with the shell notice and profile mounted', async () => {
  const store = await failedProfileSave()
  await wrapper.findComponent(ProfileView).findAll('button').find(button => button.text() === 'Отмена').trigger('click')
  expect(store.noticeSuppressed.value).toBe(false)
  expect(wrapper.findAll('[role="alert"], .consent-recovery-notice')).toHaveLength(1)
  wrapper.unmount()
  expect(store.noticeSuppressed.value).toBe(false)
})

it.each(['select', 'remove'])('restores the shell consent notice after %s clears a failed save error', async action => {
  const store = await failedProfileSave(true)
  const profile = wrapper.findComponent(ProfileView)
  expect(wrapper.find('.consent-recovery-notice').exists()).toBe(false)
  if (action === 'select') await selectPhoto()
  else await profile.get('.photo-remove').trigger('click')
  await flushPromises()
  expect(store.noticeSuppressed.value).toBe(false)
  expect(profile.find('[role="alert"]').exists()).toBe(false)
  expect(wrapper.findAll('.consent-recovery-notice')).toHaveLength(1)
  expect(profile.get('input[name="firstName"]').element.value).toBe('Черновик')
  expect(h.session.customer.value.hasPhoto).toBe(true)
  expect(h.session.updateProfile).not.toHaveBeenCalled()
})

it('retains foreground ownership when an invalid selection still presents a photo error', async () => {
  const store = await failedProfileSave()
  await selectPhoto('text/plain')
  expect(store.noticeSuppressed.value).toBe(true)
  expect(wrapper.findComponent(ProfileView).get('#profile-photo-error').text()).toContain('Выберите JPEG')
  expect(wrapper.find('.consent-recovery-notice').exists()).toBe(false)
})

it('releases only the profile owner while another foreground flow suppresses the shell notice', async () => {
  const store = await failedProfileSave(true)
  const releaseOtherOwner = store.acquireNoticeSuppression()
  await wrapper.findComponent(ProfileView).get('.photo-remove').trigger('click')
  expect(wrapper.findComponent(ProfileView).find('[role="alert"]').exists()).toBe(false)
  expect(store.noticeSuppressed.value).toBe(true)
  expect(wrapper.find('.consent-recovery-notice').exists()).toBe(false)
  releaseOtherOwner()
  await flushPromises()
  expect(store.noticeSuppressed.value).toBe(false)
  expect(wrapper.find('.consent-recovery-notice').exists()).toBe(true)
})

it('keeps draft actions blocked while consent revalidation for Save is pending', async () => {
  const store = await failedProfileSave(true)
  const profile = wrapper.findComponent(ProfileView)
  let rejectConsent
  h.session.consentRequest.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectConsent = reject }))
  await profile.get('form').trigger('submit')
  await flushPromises()
  const state = profile.vm.$.setupState
  expect(state.busy).toBe(true)
  const previews = globalThis.URL.createObjectURL.mock.calls.length
  state.cancelEditing()
  state.removePhoto()
  await selectPhoto()
  expect(profile.find('form').exists()).toBe(true)
  expect(profile.find('.photo-remove').exists()).toBe(true)
  expect(profile.get('input[name="firstName"]').element.value).toBe('Черновик')
  expect(globalThis.URL.createObjectURL).toHaveBeenCalledTimes(previews)
  expect(store.noticeSuppressed.value).toBe(true)
  rejectConsent(createInternalProblem('networkUnavailable'))
  await flushPromises()
  expect(state.busy).toBe(false)
  expect(store.noticeSuppressed.value).toBe(true)
  expect(profile.get('[role="alert"]').text()).toContain('Проверьте подключение')
})

it('ignores photo callbacks delivered after the edit draft is cancelled', async () => {
  const store = await failedProfileSave(true)
  const profile = wrapper.findComponent(ProfileView)
  const state = profile.vm.$.setupState
  await profile.findAll('button').find(button => button.text() === 'Отмена').trigger('click')
  const previews = globalThis.URL.createObjectURL.mock.calls.length
  state.removePhoto()
  await state.selectPhoto({ target:{ files:[new globalThis.File(['late photo'], 'late.png', { type:'image/png' })], value:'late.png' } })
  await state.selectPhoto({ target:{ files:[], value:'' } })
  expect(globalThis.URL.createObjectURL).toHaveBeenCalledTimes(previews)
  expect(profile.find('form').exists()).toBe(false)
  expect(h.session.customer.value.hasPhoto).toBe(true)
  expect(store.noticeSuppressed.value).toBe(false)
  expect(h.session.updateProfile).not.toHaveBeenCalled()
})
