// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import CustomerCostSummary from '../src/components/CustomerCostSummary.vue'
import { formatMoscow, formatRub, validatePricing, validatePricingStates } from '../src/orders/customerPricing.js'
import { forecastPricing, ops } from './fixtures/orders.js'

const calculated = { ...forecastPricing, totalRub:12000, calculatedAt:'2026-09-15T10:00:00Z' }
const confirmed = { ...calculated, state:100, validUntil:'2026-09-15T10:00:05Z', customsRub:0 }

function protocolFailure(value) {
  expect(() => validatePricing(value)).toThrow(expect.objectContaining({ code:'ui_protocol_error' }))
}

afterEach(() => vi.useRealTimers())

describe('customer pricing', () => {
  it('requires the complete public state contract and calendar-valid timestamps', () => {
    expect(validatePricing(forecastPricing)).toEqual(forecastPricing)
    expect(validatePricing(calculated)).toEqual(calculated)
    expect(validatePricing(confirmed)).toEqual(confirmed)
    expect(validatePricing({ ...forecastPricing, domesticDeliveryRub:0, customsRub:120 })).toMatchObject({
      domesticDeliveryRub:0, customsRub:120
    })
    expect(validatePricing(confirmed)).not.toBe(confirmed)
    for (const value of [
      null,
      { ...forecastPricing, state:999 },
      { ...forecastPricing, totalRub:-1 },
      { ...forecastPricing, totalRub:0.001 },
      { ...forecastPricing, totalRub:0, calculatedAt:null },
      { ...forecastPricing, asOf:'2026-02-30T10:00:00Z' },
      { ...forecastPricing, calculatedAt:'invalid' },
      { ...forecastPricing, validUntil:confirmed.validUntil },
      { ...forecastPricing, domesticDeliveryRub:-1 },
      { ...forecastPricing, customsRub:0.001 },
      { ...confirmed, totalRub:null },
      { ...confirmed, validUntil:null },
      { ...confirmed, customsRub:-1 }
    ]) protocolFailure(value)
  })

  it('validates state metadata and formats currency and Moscow time', () => {
    expect(validatePricingStates(ops.pricingStates)).toEqual(ops.pricingStates)
    expect(validatePricingStates(ops.pricingStates)).not.toBe(ops.pricingStates)
    expect(() => validatePricingStates([])).toThrow()
    expect(() => validatePricingStates(ops.pricingStates.map(item => item.value === 200
      ? { ...item, value:300 } : item))).toThrow()
    expect(() => validatePricingStates([{ ...ops.pricingStates[0] }, ops.pricingStates[0], ops.pricingStates[2]])).toThrow()
    expect(() => validatePricingStates([{ ...ops.pricingStates[0], routeAlias:'invalid-alias' }, ...ops.pricingStates.slice(1)])).toThrow()
    expect(formatRub(null, '₽')).toBe('Стоимость уточняется')
    expect(formatRub(0, '₽')).toBe('0,00 ₽')
    expect(formatMoscow('2026-09-15T10:00:00Z')).toContain('13:00')
  })

  it('expires a confirmed amount at the Core deadline while keeping the saved amount', async () => {
    vi.useFakeTimers()
    const wrapper = mount(CustomerCostSummary, { props:{ pricing:confirmed, ops } })
    expect(wrapper.get('.customer-cost__headline > span').text()).toBe('Подтверждённая стоимость')
    expect(wrapper.text()).toContain('Действует до')
    expect(wrapper.text()).toContain('Не ожидаются')
    expect(wrapper.text()).not.toContain('В разработке')
    await vi.advanceTimersByTimeAsync(5000)
    expect(wrapper.get('.customer-cost__headline > span').text()).toBe('Срок подтверждения истёк')
    expect(wrapper.text()).toContain('Срок подтверждения истёк')
    expect(wrapper.text()).toContain('12 000,00 ₽')
    wrapper.unmount()
  })

  it('expires immediately at the server deadline and resets when pricing is replaced', async () => {
    vi.useFakeTimers()
    const wrapper = mount(CustomerCostSummary, { props:{ pricing:{ ...confirmed, asOf:confirmed.validUntil }, ops } })
    expect(wrapper.text()).toContain('Срок подтверждения истёк')
    expect(wrapper.text()).not.toContain('Действует до')
    await wrapper.setProps({ pricing:confirmed })
    expect(wrapper.text()).toContain('Действует до')
    await vi.advanceTimersByTimeAsync(1000)
    await wrapper.setProps({ pricing:calculated })
    await vi.advanceTimersByTimeAsync(5000)
    expect(wrapper.text()).toContain('Предварительная стоимость')
    expect(wrapper.text()).not.toContain('Сохранённая стоимость показана для справки')
    wrapper.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('uses the currency fallback when Ops has no RUB metadata', () => {
    const wrapper = mount(CustomerCostSummary, { props:{ pricing:calculated, ops:{ ...ops, currencies:[] } } })
    expect(wrapper.text()).toContain('12 000,00 ₽')
    wrapper.unmount()
  })

  it('shows a saved expired amount, compact extras, and an honest unavailable forecast', () => {
    const expired = mount(CustomerCostSummary, { props:{ pricing:{ ...confirmed, state:200 }, ops, compact:true } })
    expect(expired.get('.customer-cost__headline > span').text()).toBe('Срок подтверждения истёк')
    expect(expired.text().match(/Срок подтверждения истёк/gu)).toHaveLength(1)
    expect(expired.text()).toContain('12 000,00 ₽')
    expect(expired.text()).not.toContain('Доставка по России')
    expired.unmount()

    const unavailable = mount(CustomerCostSummary, { props:{ pricing:forecastPricing, ops } })
    expect(unavailable.get('.customer-cost__headline > span').text()).toBe('Предварительная стоимость')
    expect(unavailable.text()).toContain('Стоимость уточняется')
    expect(unavailable.text()).not.toContain('будет проверена после отправки заявки')
    expect(unavailable.text()).not.toContain('В разработке')
    unavailable.unmount()

    const loading = mount(CustomerCostSummary, { props:{ pricing:null, ops:null, loading:true } })
    expect(loading.get('.customer-cost__headline > span').text()).toBe('Стоимость заказа')
    expect(loading.text()).toContain('Рассчитываем стоимость…')
    loading.unmount()
  })

  it('keeps excluded costs below the total and distinguishes known from unknown amounts', () => {
    const wrapper = mount(CustomerCostSummary, { props:{ pricing:{
      ...forecastPricing, totalRub:5228.31, calculatedAt:forecastPricing.asOf,
      domesticDeliveryRub:null, customsRub:120
    }, ops } })
    const card = wrapper.get('.customer-cost')
    expect([...card.element.children].slice(0, 3).map(child => child.className))
      .toEqual(['customer-cost__main', 'customer-cost__note', 'customer-cost__excluded'])
    expect(wrapper.get('.customer-cost__headline').text()).toContain('Предварительная стоимость5 228,31 ₽')
    const amounts = wrapper.findAll('.customer-cost__excluded dd')
    expect(amounts[0].text()).toBe('Рассчитаем при оформлении заказа')
    expect(amounts[1].text()).toBe('Проверяем, потребуются ли таможенные платежи')
    wrapper.unmount()
  })

  it('uses the same excluded-cost presentation after all amounts are calculated', () => {
    const wrapper = mount(CustomerCostSummary, { props:{ pricing:{
      ...confirmed, domesticDeliveryRub:55, customsRub:120
    }, ops } })
    expect(wrapper.get('.customer-cost__headline > span').text()).toBe('Подтверждённая стоимость')
    expect(wrapper.findAll('.customer-cost__excluded dd').map(amount => amount.text()))
      .toEqual(['Рассчитаем при оформлении заказа', 'Предварительно 120,00 ₽'])
    expect(wrapper.get('.customer-cost__note').element.nextElementSibling)
      .toBe(wrapper.get('.customer-cost__excluded').element)
    wrapper.unmount()
  })
})

it.each([0, 120, null])('keeps extra rows visible and interprets confirmed customs %s', amount => {
  const wrapper = mount(CustomerCostSummary, { props:{ pricing:{ ...confirmed, customsRub:amount }, ops } })
  expect(wrapper.findAll('.customer-cost__excluded dd')).toHaveLength(2)
  expect(wrapper.findAll('.customer-cost__excluded dd')[1].text()).toBe(amount === null
    ? 'Будут рассчитаны позже' : amount === 0 ? 'Не ожидаются' : 'Предварительно 120,00 ₽')
  wrapper.unmount()
})

it('retains cancelled historical unknown wording and published customs context', async () => {
  const wrapper = mount(CustomerCostSummary, { props:{ pricing:forecastPricing, ops, historical:true } })
  expect(wrapper.text()).toContain('Последняя рассчитанная стоимость')
  expect(wrapper.findAll('.customer-cost__excluded dd').map(item => item.text())).toEqual(['Расчёт не проводился', 'Расчёт не проводился'])
  await wrapper.setProps({ pricing:{ ...confirmed, customsRub:120 } })
  expect(wrapper.findAll('.customer-cost__excluded dd')[1].text()).toBe('Предварительно 120,00 ₽')
  wrapper.unmount()
})

it.each([null, 0, 55])('shows separate saved checkout delivery %s without changing the included total', amount => {
  const wrapper = mount(CustomerCostSummary, { props:{ pricing:{ ...confirmed, domesticDeliveryRub:amount }, ops, deliverySelected:true } })
  expect(wrapper.findAll('.customer-cost__excluded dd')[0].text()).toBe(amount === null ? 'Будут рассчитаны позже' : 'Предварительно ' + formatRub(amount, '₽'))
  expect(wrapper.get('.customer-cost__headline strong').text()).toBe(formatRub(confirmed.totalRub, '₽'))
  wrapper.unmount()
})

it.each([false, true])('uses final unknown-price wording in full/compact historical summaries (%s)', async compact => {
  const wrapper = mount(CustomerCostSummary, { props:{ pricing:null, ops, historical:true, compact } })
  expect(wrapper.get('.customer-cost__headline strong').text()).toBe('Расчёт не проводился')
  await wrapper.setProps({ pricing:forecastPricing })
  expect(wrapper.get('.customer-cost__headline strong').text()).toBe('Расчёт не проводился')
  await wrapper.setProps({ pricing:{ ...calculated, totalRub:0 } })
  expect(wrapper.get('.customer-cost__headline strong').text()).toBe('0,00 ₽')
  await wrapper.setProps({ pricing:calculated })
  expect(wrapper.get('.customer-cost__headline strong').text()).toBe('12 000,00 ₽')
  await wrapper.setProps({ historical:false, pricing:forecastPricing })
  expect(wrapper.get('.customer-cost__headline strong').text()).toBe('Стоимость уточняется')
  wrapper.unmount()
})
