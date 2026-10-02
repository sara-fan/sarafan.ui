// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { defineComponent, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ConsentRenewalDialog from '../src/components/ConsentRenewalDialog.vue'
import { isConsentRenewalProblem, useConsentRenewal } from '../src/useConsentRenewal.js'
import { CORE_PROBLEM_TYPES, ProblemError, createInternalProblem } from '../src/errors/problem.js'

const h = vi.hoisted(() => ({ session:{}, store:{} }))
vi.mock('../src/stores/session.js', () => ({ useSession:() => h.session }))
vi.mock('../src/stores/consents.js', () => ({ useConsents:() => h.store }))
const doc = (kind, version = '1') => ({
  id:`00000000-0000-4000-8000-${String(kind).padStart(11, '0')}${version}`,
  kind, title:kind === 2 ? 'Пользовательское соглашение' : 'Согласие',
  displayVersion:version, contentHash:version.repeat(64), html:'<p>Точный текст документа</p>',
  effectiveAt:'2026-09-01T00:00:00Z'
})
const changed = () => new ProblemError({
  type:CORE_PROBLEM_TYPES.consentVersionChanged, code:'consent_version_changed', status:409,
  title:'Версия изменилась', detail:'Подтвердите новую версию'
})
function deferred() {
  let resolve
  let reject
  const promise = new Promise((accept, decline) => { resolve = accept; reject = decline })
  return { promise, resolve, reject }
}
let wrapper, flow, release
beforeEach(() => {
  h.session.customer = ref({ id:7 })
  release = vi.fn()
  h.store.acquireNoticeSuppression = vi.fn(() => release)
  h.store.missingKinds = vi.fn().mockResolvedValue([1, 2])
  h.store.mine = ref({ serverNow:'2026-10-01T00:00:00Z', nextChangeAt:null })
  h.store.current = vi.fn(async kind => ({ document:doc(kind), serverNow:'2026-10-01T00:00:00Z', nextChangeAt:null }))
  h.store.grant = vi.fn().mockResolvedValue()
  h.store.kindName = kind => doc(kind).title
  wrapper = mount(defineComponent({
    components:{ ConsentRenewalDialog },
    setup() { return { flow:useConsentRenewal() } },
    template:'<ConsentRenewalDialog :flow="flow" />'
  }), {
    attachTo:document.body, global:{ stubs:{ UiDialog:{
      name:'UiDialog', props:['modelValue'], emits:['update:modelValue'],
      template:'<section v-if="modelValue"><slot /><slot name="actions" /></section>'
    } } }
  })
  flow = wrapper.vm.flow
})
afterEach(() => { wrapper.unmount(); vi.useRealTimers(); vi.restoreAllMocks() })

it('recognizes only the protected-write renewal problems', () => {
  for (const type of [CORE_PROBLEM_TYPES.personalDataConsentRequired, CORE_PROBLEM_TYPES.userAgreementRequired, CORE_PROBLEM_TYPES.consentVersionChanged])
    expect(isConsentRenewalProblem(new ProblemError({ type, status:409 }))).toBe(true)
  expect(isConsentRenewalProblem(createInternalProblem('networkUnavailable'))).toBe(false)
})

it('continues immediately when both current versions were accepted at login', async () => {
  h.store.missingKinds.mockResolvedValue([])
  await expect(flow.ensure([1, 2], () => true)).resolves.toBe(true)
  expect(flow.state.open).toBe(false)
  expect(h.store.current).not.toHaveBeenCalled()
  expect(h.store.grant).not.toHaveBeenCalled()
  expect(release).toHaveBeenCalled()
})

it('shows separate unchecked confirmations and reads the exact artifact without navigation', async () => {
  const pending = flow.ensure([1, 2], () => true)
  await flushPromises()
  expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(2)
  expect(wrapper.findAll('input').every(input => !input.element.checked)).toBe(true)
  await flow.confirm()
  expect(h.store.grant).not.toHaveBeenCalled()
  await wrapper.findAll('button').find(button => button.text() === 'Согласие').trigger('click')
  expect(wrapper.text()).toContain('Точный текст документа')
  expect(flow.state.documents[0].accepted).toBe(false)
  await wrapper.findAll('button').find(button => button.text() === 'Вернуться к подтверждению').trigger('click')
  for (const input of wrapper.findAll('input')) await input.setValue(true)
  h.store.missingKinds.mockResolvedValue([])
  await wrapper.findAll('button').find(button => button.text() === 'Подтвердить и продолжить').trigger('click')
  await expect(pending).resolves.toBe(true)
  expect(h.store.grant.mock.calls.map(([document]) => document.kind)).toEqual([1, 2])
  expect(flow.state.open).toBe(false)
})

it('cancellation clears pending actions and does not record evidence', async () => {
  const pending = flow.ensure([1], () => true)
  await flushPromises()
  await wrapper.findAll('button').find(button => button.text() === 'Отмена').trigger('click')
  await expect(pending).resolves.toBe(false)
  expect(h.store.grant).not.toHaveBeenCalled()
  expect(flow.state.documents).toEqual([])
})

it('retains confirmations and keys after transport errors and retries once', async () => {
  const pending = flow.ensure([1, 2], () => true)
  await flushPromises()
  flow.state.documents.forEach(row => { row.accepted = true })
  const keys = flow.state.documents.map(row => row.key)
  h.store.grant.mockRejectedValueOnce(createInternalProblem('networkUnavailable'))
  await flow.confirm()
  expect(wrapper.find('[role="alert"]').exists()).toBe(true)
  expect(flow.state.documents.map(row => row.key)).toEqual(keys)
  expect(flow.state.documents.every(row => row.accepted)).toBe(true)
  h.store.missingKinds.mockResolvedValue([])
  await flow.confirm()
  await expect(pending).resolves.toBe(true)
  expect(h.store.grant.mock.calls[0][1]).toBe(h.store.grant.mock.calls[1][1])
})

it('requires a fresh choice only for a changed document version', async () => {
  const pending = flow.ensure([1, 2], () => true)
  await flushPromises()
  flow.state.documents.forEach(row => { row.accepted = true })
  const unchangedKey = flow.state.documents[0].key
  h.store.grant.mockRejectedValueOnce(changed())
  h.store.current.mockImplementation(async kind => ({ document:doc(kind, kind === 2 ? '2' : '1') }))
  await flow.confirm()
  expect(flow.state.documents[0]).toMatchObject({ accepted:true, key:unchangedKey })
  expect(flow.state.documents[1].accepted).toBe(false)
  expect(flow.state.documents[1].document.displayVersion).toBe('2')
  flow.state.documents[1].accepted = true
  h.store.missingKinds.mockResolvedValue([])
  await flow.confirm()
  await expect(pending).resolves.toBe(true)
})

it('refreshes away an already accepted document after partial success', async () => {
  const pending = flow.ensure([1, 2], () => true)
  await flushPromises()
  flow.state.documents.forEach(row => { row.accepted = true })
  h.store.grant.mockResolvedValueOnce().mockRejectedValueOnce(createInternalProblem('networkUnavailable'))
  await flow.confirm()
  h.store.missingKinds.mockResolvedValue([2])
  await flow.retry()
  expect(flow.state.documents).toHaveLength(1)
  expect(flow.state.documents[0].document.kind).toBe(2)
  expect(flow.state.documents[0].accepted).toBe(true)
  h.store.missingKinds.mockResolvedValue([])
  await flow.confirm()
  await expect(pending).resolves.toBe(true)
  expect(h.store.grant.mock.calls.map(([document]) => document.kind)).toEqual([1, 2, 2])
})

it('prevents duplicate confirmations while a grant is pending', async () => {
  const pending = flow.ensure([1, 2], () => true)
  await flushPromises()
  flow.state.documents.forEach(row => { row.accepted = true })
  const grant = deferred()
  h.store.grant.mockReturnValueOnce(grant.promise)
  const first = flow.confirm()
  await flow.confirm()
  await flow.retry()
  expect(h.store.grant).toHaveBeenCalledOnce()
  h.store.missingKinds.mockResolvedValue([])
  grant.resolve()
  await first
  await expect(pending).resolves.toBe(true)
})

it.each(['logout', 'unmount'])('discards late grant failures on %s', async action => {
  const pending = flow.ensure([1, 2], () => true)
  await flushPromises()
  flow.state.documents.forEach(row => { row.accepted = true })
  const grant = deferred()
  h.store.grant.mockReturnValueOnce(grant.promise)
  const confirmation = flow.confirm()
  if (action === 'logout') h.session.customer.value = null
  else wrapper.unmount()
  grant.reject(createInternalProblem('networkUnavailable'))
  await confirmation
  await expect(pending).resolves.toBe(false)
  expect(flow.state.problem).toBeNull()
  expect(h.store.grant).toHaveBeenCalledOnce()
})

it('discards late status and document loads after identity replacement', async () => {
  const status = deferred()
  h.store.missingKinds.mockReturnValueOnce(status.promise)
  const pending = flow.ensure([1, 2], () => true)
  h.session.customer.value = { id:8 }
  status.resolve([1])
  await expect(pending).resolves.toBe(false)
  expect(h.store.current).not.toHaveBeenCalled()
  const document = deferred()
  h.store.current.mockReturnValueOnce(document.promise)
  const next = flow.ensure([1, 2], () => true)
  await flushPromises()
  h.session.customer.value = { id:9 }
  document.resolve({ document:doc(1) })
  await expect(next).resolves.toBe(false)
  expect(flow.state.open).toBe(false)
})

it.each([null, { ...doc(1), html:'<script>unsafe()</script>' }])('fails closed for an unavailable or unsafe artifact', async document => {
  h.store.current.mockResolvedValue({ document })
  await expect(flow.ensure([1], () => true)).rejects.toBeDefined()
  expect(flow.state.open).toBe(false)
  expect(release).toHaveBeenCalled()
})

it('keeps recovery errors in the dialog and permits a later refresh', async () => {
  const pending = flow.ensure([1, 2], () => true)
  await flushPromises()
  flow.state.documents.forEach(row => { row.accepted = true })
  h.store.grant.mockRejectedValueOnce(changed())
  h.store.current.mockRejectedValueOnce(createInternalProblem('protocolError'))
  await flow.confirm()
  expect(flow.state.problem.code).toBe('ui_protocol_error')
  h.store.missingKinds.mockRejectedValueOnce(createInternalProblem('networkUnavailable'))
  await flow.retry()
  expect(flow.state.problem.code).toBe('ui_network_unavailable')
  h.store.missingKinds.mockResolvedValue([])
  await flow.retry()
  await expect(pending).resolves.toBe(true)
})
it('does not release a newer foreground notice owner when an abandoned load completes', async () => {
  const firstRelease = vi.fn()
  const nextRelease = vi.fn()
  h.store.acquireNoticeSuppression.mockReturnValueOnce(firstRelease).mockReturnValueOnce(nextRelease)
  const firstStatus = deferred()
  h.store.missingKinds.mockReturnValueOnce(firstStatus.promise)
  const abandoned = flow.ensure([1], () => true)
  const active = flow.ensure([1, 2], () => true)
  await flushPromises()
  firstStatus.resolve([1])
  await expect(abandoned).resolves.toBe(false)
  expect(firstRelease).toHaveBeenCalledOnce()
  expect(nextRelease).not.toHaveBeenCalled()
  flow.cancel()
  await expect(active).resolves.toBe(false)
  expect(nextRelease).toHaveBeenCalledOnce()
})
it('handles open notifications and a backdrop close without granting evidence', async () => {
  const pending = flow.ensure([1], () => true)
  await flushPromises()
  const dialog = wrapper.findComponent({ name:'UiDialog' })
  dialog.vm.$emit('update:modelValue', true)
  expect(flow.state.open).toBe(true)
  dialog.vm.$emit('update:modelValue', false)
  await expect(pending).resolves.toBe(false)
  expect(h.store.grant).not.toHaveBeenCalled()
})

it('discards success after cancellation while a grant is pending', async () => {
  const pending = flow.ensure([1, 2], () => true)
  await flushPromises()
  flow.state.documents.forEach(row => { row.accepted = true })
  const grant = deferred()
  h.store.grant.mockReturnValueOnce(grant.promise)
  const confirmation = flow.confirm()
  flow.cancel()
  grant.resolve()
  await confirmation
  await expect(pending).resolves.toBe(false)
  expect(h.store.grant).toHaveBeenCalledOnce()
})

it('discards late status refreshes after confirmation and recovery are abandoned', async () => {
  const pending = flow.ensure([1, 2], () => true)
  await flushPromises()
  flow.state.documents.forEach(row => { row.accepted = true })
  const refresh = deferred()
  h.store.missingKinds.mockReturnValueOnce(refresh.promise)
  const confirmation = flow.confirm()
  await flushPromises()
  flow.cancel()
  refresh.resolve([])
  await confirmation
  await expect(pending).resolves.toBe(false)
  const next = flow.ensure([1, 2], () => true)
  await flushPromises()
  const retryStatus = deferred()
  h.store.missingKinds.mockReturnValueOnce(retryStatus.promise)
  const retry = flow.retry()
  flow.cancel()
  retryStatus.resolve([])
  await retry
  await expect(next).resolves.toBe(false)
})

it('ignores a stale version recovery error after cancellation', async () => {
  const pending = flow.ensure([1], () => true)
  await flushPromises()
  flow.state.documents.forEach(row => { row.accepted = true })
  h.store.grant.mockRejectedValueOnce(changed())
  const refresh = deferred()
  h.store.missingKinds.mockReturnValueOnce(refresh.promise)
  const confirmation = flow.confirm()
  await flushPromises()
  flow.cancel()
  refresh.reject(createInternalProblem('networkUnavailable'))
  await confirmation
  await expect(pending).resolves.toBe(false)
  expect(flow.state.problem).toBeNull()
})
it('does not resume a protected action before one has been requested', async () => {
  await flow.retry()
  expect(flow.state.open).toBe(false)
  expect(h.store.grant).not.toHaveBeenCalled()
})

it('ignores stale recovery failures without changing a newer dialog', async () => {
  const pending = flow.ensure([1], () => true)
  await flushPromises()
  const recovery = deferred()
  h.store.missingKinds.mockReturnValueOnce(recovery.promise)
  const retry = flow.retry()
  flow.cancel()
  recovery.reject(createInternalProblem('networkUnavailable'))
  await retry
  await expect(pending).resolves.toBe(false)
  expect(flow.state.problem).toBeNull()
})
it('completes once when conflict recovery finds the replacement already accepted elsewhere', async () => {
  const resume = vi.fn()
  const pending = flow.ensure([1, 2], () => true).then(resume)
  await flushPromises()
  flow.state.documents.forEach(row => { row.accepted = true })
  h.store.grant.mockRejectedValueOnce(changed())
  h.store.missingKinds.mockResolvedValue([])
  await flow.confirm()
  await pending
  expect(resume).toHaveBeenCalledExactlyOnceWith(true)
  expect(flow.state.open).toBe(false)
  expect(flow.state.problem).toBeNull()
  expect(release).toHaveBeenCalledOnce()
  await flow.retry()
  expect(resume).toHaveBeenCalledOnce()
})

it.each([
  { kind:1, field:'personalDataConsent.documentId' },
  { kind:1, field:'decision' },
  { kind:2, field:'userAgreement.contentHash' },
  { kind:2, field:'DocumentId' }
])('associates $field with the rejected kind $kind and focuses it on each attempt', async ({ kind, field }) => {
  const pending = flow.ensure([1, 2], () => true)
  await flushPromises()
  flow.state.documents.forEach(row => { row.accepted = true })
  h.store.grant.mockImplementation(async document => {
    if (document.kind === kind) throw createInternalProblem('invalidInput', { errors:{ [field]:['Проверьте подтверждение'] } })
  })
  await flushPromises()
  const name = kind === 2 ? 'userAgreement' : 'personalDataConsent'
  const confirm = wrapper.findAll('button').find(button => button.text() === 'Подтвердить и продолжить')
  for (let attempt = 0; attempt < 2; attempt++) {
    confirm.element.focus()
    await confirm.trigger('click')
    await flushPromises()
    const checkbox = wrapper.get('input[name="' + name + '"]')
    expect(checkbox.attributes('aria-invalid')).toBe('true')
    expect(checkbox.attributes('aria-describedby')).toBe(name + '-renewal-error')
    expect(wrapper.get('#' + name + '-renewal-error').text()).toBe('Проверьте подтверждение')
    expect(document.activeElement).toBe(checkbox.element)
    expect(wrapper.findAll('input[aria-invalid="true"]')).toHaveLength(1)
  }
  flow.cancel()
  await pending
})

it('keeps unassociated errors in the alert and does not invent a rejected checkbox', async () => {
  const pending = flow.ensure([1], () => true)
  await flushPromises()
  flow.state.documents.forEach(row => { row.accepted = true })
  h.store.grant.mockRejectedValueOnce(createInternalProblem('invalidInput', { detail:'Ошибка запроса', errors:{ unrelated:['Ошибка запроса'] } }))
  await flushPromises()
  const confirm = wrapper.findAll('button').find(button => button.text() === 'Подтвердить и продолжить')
  confirm.element.focus()
  await confirm.trigger('click')
  await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('Ошибка запроса')
  expect(wrapper.find('input[aria-invalid="true"]').exists()).toBe(false)
  expect(document.activeElement).toBe(confirm.element)
  flow.cancel()
  await pending
})

function boundaryAfter(delay) {
  return { serverNow:'2026-10-01T00:00:00Z', nextChangeAt:new Date(Date.parse('2026-10-01T00:00:00Z') + delay).toISOString() }
}

it('refreshes at the earliest document boundary and clears only changed choices while reading', async () => {
  vi.useFakeTimers()
  h.store.current.mockImplementation(async kind => ({ document:doc(kind), ...boundaryAfter(kind === 1 ? 2000 : 1000) }))
  const pending = flow.ensure([1, 2], () => true)
  await flushPromises()
  flow.state.documents.forEach(row => { row.accepted = true })
  const original = flow.state.documents[0]
  flow.state.reading = flow.state.documents[1].document
  h.store.current.mockImplementation(async kind => ({ document:doc(kind, kind === 1 ? '1' : '2'), serverNow:'2026-10-01T00:00:01Z', nextChangeAt:null }))
  await vi.advanceTimersByTimeAsync(1000)
  await flushPromises()
  expect(h.store.missingKinds).toHaveBeenCalledTimes(2)
  expect(flow.state.documents[0]).toMatchObject({ accepted:true, key:original.key })
  expect(flow.state.documents[1]).toMatchObject({ accepted:false, document:{ displayVersion:'2' } })
  expect(flow.state.reading).toBeNull()
  expect(h.store.grant).not.toHaveBeenCalled()
  flow.cancel()
  await pending
})

it('uses status boundaries to add a kind that was previously current', async () => {
  vi.useFakeTimers()
  h.store.missingKinds.mockResolvedValue([1])
  h.store.mine.value = boundaryAfter(1000)
  const pending = flow.ensure([1, 2], () => true)
  await flushPromises()
  flow.state.documents[0].accepted = true
  const originalKey = flow.state.documents[0].key
  h.store.missingKinds.mockResolvedValue([1, 2])
  h.store.mine.value = { serverNow:'2026-10-01T00:00:01Z', nextChangeAt:null }
  await vi.advanceTimersByTimeAsync(1000)
  await flushPromises()
  expect(flow.state.documents.map(row => row.document.kind)).toEqual([1, 2])
  expect(flow.state.documents[0]).toMatchObject({ accepted:true, key:originalKey })
  expect(flow.state.documents[1].accepted).toBe(false)
  flow.cancel()
  await pending
})

it('waits for a pending grant at a boundary and refreshes before granting another old artifact', async () => {
  vi.useFakeTimers()
  h.store.current.mockImplementation(async kind => ({ document:doc(kind), ...boundaryAfter(1000) }))
  const pending = flow.ensure([1, 2], () => true)
  await flushPromises()
  flow.state.documents.forEach(row => { row.accepted = true })
  const grant = deferred()
  h.store.grant.mockReturnValueOnce(grant.promise)
  const confirmation = flow.confirm()
  await vi.advanceTimersByTimeAsync(1000)
  expect(h.store.missingKinds).toHaveBeenCalledOnce()
  h.store.current.mockImplementation(async kind => ({ document:doc(kind, '2'), serverNow:'2026-10-01T00:00:01Z', nextChangeAt:null }))
  grant.resolve()
  await confirmation
  expect(h.store.grant).toHaveBeenCalledOnce()
  expect(flow.state.documents.every(row => !row.accepted)).toBe(true)
  expect(flow.state.busy).toBe(false)
  flow.cancel()
  await pending
})

it('recovers at a due boundary after a pending grant fails', async () => {
  vi.useFakeTimers()
  h.store.current.mockImplementation(async kind => ({ document:doc(kind), ...boundaryAfter(1000) }))
  const pending = flow.ensure([1], () => true)
  await flushPromises()
  flow.state.documents.forEach(row => { row.accepted = true })
  const grant = deferred()
  h.store.grant.mockReturnValueOnce(grant.promise)
  const confirmation = flow.confirm()
  await vi.advanceTimersByTimeAsync(1000)
  h.store.current.mockResolvedValue({ document:doc(1, '2'), serverNow:'2026-10-01T00:00:01Z', nextChangeAt:null })
  grant.reject(createInternalProblem('networkUnavailable'))
  await confirmation
  await flushPromises()
  expect(flow.state.documents[0]).toMatchObject({ accepted:false, document:{ displayVersion:'2' } })
  expect(flow.state.busy).toBe(false)
  flow.cancel()
  await pending
})

it('presents boundary refresh failures and permits explicit recovery', async () => {
  vi.useFakeTimers()
  h.store.current.mockImplementation(async kind => ({ document:doc(kind), ...boundaryAfter(1000) }))
  const pending = flow.ensure([1], () => true)
  await flushPromises()
  h.store.missingKinds.mockRejectedValueOnce(createInternalProblem('networkUnavailable'))
  await vi.advanceTimersByTimeAsync(1000)
  await flushPromises()
  expect(flow.state.problem.code).toBe('ui_network_unavailable')
  expect(flow.state.open).toBe(true)
  h.store.missingKinds.mockResolvedValue([])
  await flow.retry()
  await expect(pending).resolves.toBe(true)
})

it.each(['cancel', 'logout', 'unmount'])('cancels the boundary timer on %s', async action => {
  vi.useFakeTimers()
  h.store.current.mockImplementation(async kind => ({ document:doc(kind), ...boundaryAfter(1000) }))
  const pending = flow.ensure([1], () => true)
  await flushPromises()
  if (action === 'cancel') flow.cancel()
  else if (action === 'logout') h.session.customer.value = null
  else wrapper.unmount()
  await vi.advanceTimersByTimeAsync(1000)
  expect(h.store.missingKinds).toHaveBeenCalledOnce()
  await expect(pending).resolves.toBe(false)
})

it('chunks boundaries beyond the browser timer limit without refreshing early', async () => {
  vi.useFakeTimers()
  h.store.current.mockImplementation(async kind => ({ document:doc(kind), ...boundaryAfter(2147484647) }))
  const pending = flow.ensure([1], () => true)
  await flushPromises()
  await vi.advanceTimersByTimeAsync(2147483647)
  expect(h.store.missingKinds).toHaveBeenCalledOnce()
  h.store.current.mockResolvedValue({ document:doc(1, '2'), serverNow:'2026-11-01T00:00:00Z', nextChangeAt:null })
  await vi.advanceTimersByTimeAsync(1000)
  expect(h.store.missingKinds).toHaveBeenCalledTimes(2)
  flow.cancel()
  await pending
})

it('does not let an abandoned grant clear the replacement flow boundary timer', async () => {
  vi.useFakeTimers()
  const first = flow.ensure([1], () => true)
  await flushPromises()
  flow.state.documents.forEach(row => { row.accepted = true })
  const grant = deferred()
  h.store.grant.mockReturnValueOnce(grant.promise)
  const confirmation = flow.confirm()
  h.store.current.mockImplementation(async kind => ({ document:doc(kind), ...boundaryAfter(1000) }))
  const next = flow.ensure([2], () => true)
  await flushPromises()
  grant.resolve()
  await confirmation
  await expect(first).resolves.toBe(false)
  h.store.current.mockResolvedValue({ document:doc(2, '2'), serverNow:'2026-10-01T00:00:01Z', nextChangeAt:null })
  await vi.advanceTimersByTimeAsync(1000)
  expect(flow.state.documents[0].document.displayVersion).toBe('2')
  flow.cancel()
  await next
})

it('keeps status reload errors in the dialog without marking a successful grant as invalid', async () => {
  const pending = flow.ensure([1], () => true)
  await flushPromises()
  flow.state.documents.forEach(row => { row.accepted = true })
  await flushPromises()
  h.store.missingKinds.mockRejectedValueOnce(createInternalProblem('networkUnavailable'))
  const confirm = wrapper.findAll('button').find(button => button.text() === 'Подтвердить и продолжить')
  confirm.element.focus()
  await confirm.trigger('click')
  await flushPromises()
  expect(flow.state.problemKind).toBeNull()
  expect(wrapper.find('[role="alert"]').exists()).toBe(true)
  expect(wrapper.find('input[aria-invalid="true"]').exists()).toBe(false)
  expect(document.activeElement).toBe(confirm.element)
  flow.cancel()
  await pending
})
