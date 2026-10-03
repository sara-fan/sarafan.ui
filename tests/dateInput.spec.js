// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VDatePicker, VMenu } from 'vuetify/components'
import DateInput from '../src/components/ui/UiDateInput.vue'
import { dateInputDisplay, dateInputIso, pickerDateIso } from '../src/dateInput.js'
import { createSarafanVuetify } from '../src/plugins/vuetify.js'

let wrapper
function render(props = {}) {
  wrapper = mount(DateInput, { attachTo:document.body, props:{ modelValue:'2010-02-03', label:'Дата выдачи', ...props },
    attrs:{ id:'issue-date', name:'passportIssueDate', 'aria-describedby':'date-error' }, global:{ plugins:[createSarafanVuetify()] } })
}
const state = () => wrapper.vm.$.setupState
afterEach(() => { wrapper?.unmount(); wrapper = null; vi.restoreAllMocks() })

describe('Russian date input', () => {
  it('formats ISO calendar dates and preserves invalid drafts without interpreting month-first dates', () => {
    expect(dateInputDisplay('2010-02-03')).toBe('03.02.2010')
    expect(dateInputDisplay(null)).toBe('')
    expect(dateInputDisplay('bad')).toBe('bad')
    expect(dateInputIso('03.02.2010')).toBe('2010-02-03')
    expect(dateInputIso('03/02/2010')).toBe('03/02/2010')
    expect(pickerDateIso(new Date(2026, 8, 3))).toBe('2026-09-03')
  })
  it('displays and enters Russian dates in an English browser while emitting ISO dates', async () => {
    vi.spyOn(globalThis.navigator, 'language', 'get').mockReturnValue('en-US')
    render()
    const input = wrapper.get('input')
    expect(input.element.value).toBe('03.02.2010')
    expect(input.attributes()).toMatchObject({ type:'text', lang:'ru', placeholder:'дд.мм.гггг', name:'passportIssueDate', 'aria-describedby':'date-error' })
    await input.setValue('29.02.2024')
    expect(wrapper.emitted('update:modelValue').at(-1)).toEqual(['2024-02-29'])
    await input.setValue('2026-10-03')
    expect(input.element.value).toBe('03.10.2026')
    expect(wrapper.emitted('update:modelValue').at(-1)).toEqual(['2026-10-03'])
    await input.setValue('')
    expect(wrapper.emitted('update:modelValue').at(-1)).toEqual([''])
  })
  it('retains invalid edits for form validation and suppresses incomplete filter requests', async () => {
    render()
    await wrapper.get('input').setValue('31.02.2026')
    expect(wrapper.emitted('update:modelValue').at(-1)).toEqual(['2026-02-31'])
    await wrapper.setProps({ allowInvalid:false, modelValue:'2026-09-01' })
    const count = wrapper.emitted('update:modelValue').length
    await wrapper.get('input').setValue('03.')
    expect(wrapper.get('input').element.value).toBe('03.')
    expect(wrapper.emitted('update:modelValue')).toHaveLength(count)
    await wrapper.get('input').setValue('31.02.2026')
    expect(wrapper.emitted('update:modelValue')).toHaveLength(count)
    await wrapper.get('input').setValue('03.10.2026')
    expect(wrapper.emitted('update:modelValue').at(-1)).toEqual(['2026-10-03'])
    await wrapper.setProps({ modelValue:'2026-10-04' })
    expect(wrapper.get('input').element.value).toBe('04.10.2026')
  })
  it('opens a Russian calendar, preserves calendar dates, respects bounds and restores field focus', async () => {
    render({ min:'2010-02-01', max:'2010-02-28' })
    await wrapper.get('button[aria-label="Открыть календарь: Дата выдачи"]').trigger('click')
    await flushPromises()
    expect(state().menu).toBe(true)
    const picker = wrapper.getComponent(VDatePicker)
    expect(picker.text()).toMatch(/февр/iu)
    expect(picker.text()).not.toContain('February')
    picker.vm.$emit('update:modelValue', new Date(2010, 0, 31)); await flushPromises()
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    picker.vm.$emit('update:modelValue', new Date(2010, 2, 1)); await flushPromises()
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    await state().select(new Date('bad'))
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    picker.vm.$emit('update:modelValue', new Date(2010, 1, 4)); await flushPromises()
    expect(wrapper.emitted('update:modelValue').at(-1)).toEqual(['2010-02-04'])
    expect(state().menu).toBe(false)
    expect(document.activeElement).toBe(wrapper.get('input').element)
    await state().select(null)
    expect(wrapper.emitted('update:modelValue').at(-1)).toEqual([''])
  })
  it('restores the field after calendar dismissal without changing its value', async () => {
    render()
    await wrapper.get('button[aria-label="Открыть календарь: Дата выдачи"]').trigger('click'); await flushPromises()
    expect(document.querySelector('[role="dialog"]').getAttribute('aria-label')).toBe('Календарь: Дата выдачи')
    wrapper.getComponent(VMenu).vm.$emit('update:modelValue', false); await flushPromises()
    expect(document.activeElement).toBe(wrapper.get('input').element)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
  it('preserves focus when an outside interaction dismisses the calendar', async () => {
    render()
    const nextField = document.createElement('input')
    document.body.append(nextField)
    try {
      state().openCalendar(); await flushPromises()
      nextField.focus()
      wrapper.getComponent(VMenu).vm.$emit('update:modelValue', false); await flushPromises()
      expect(document.activeElement).toBe(nextField)
      expect(wrapper.emitted('update:modelValue')).toBeUndefined()
      state().openCalendar(); await flushPromises()
      document.querySelector('[role="dialog"] button').focus()
      wrapper.getComponent(VMenu).vm.$emit('update:modelValue', false); await flushPromises()
      expect(document.activeElement).toBe(wrapper.get('input').element)
    } finally { nextField.remove() }
  })
  it.each(['disabled', 'readonly'])('closes the calendar and blocks stale events while %s', async flag => {
    render()
    state().openCalendar(); await flushPromises()
    await wrapper.setProps({ [flag]:true })
    await wrapper.get('input').trigger('keydown', { key:'ArrowDown' }); await flushPromises()
    expect(state().menu).toBe(false)
    state().change('03.10.2026'); state().openCalendar(); await state().select(new Date(2026, 9, 3))
    expect(state().menu).toBe(false)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
  it('keeps invalid model values out of the calendar and handles external resets', async () => {
    render({ modelValue:'bad' })
    expect(state().pickerValue).toBe(null)
    await wrapper.setProps({ modelValue:'' })
    expect(state().pickerValue).toBe(null)
    expect(wrapper.get('input').element.value).toBe('')
  })

})
