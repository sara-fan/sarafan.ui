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
    expect(validatePricing(confirmed)).not.toBe(confirmed)
    for (const value of [
      null,
      { ...forecastPricing, state:999 },
      { ...forecastPricing, totalRub:-1 },
      { ...forecastPricing, totalRub:0.001 },
      { ...forecastPricing, asOf:'2026-02-30T10:00:00Z' },
      { ...forecastPricing, calculatedAt:'invalid' },
      { ...forecastPricing, validUntil:confirmed.validUntil },
      { ...forecastPricing, domesticDeliveryRub:0 },
      { ...forecastPricing, customsRub:0 },
      { ...confirmed, totalRub:null },
      { ...confirmed, validUntil:null },
      { ...confirmed, customsRub:-1 }
    ]) protocolFailure(value)
  })

  it('validates state metadata and formats currency and Moscow time', () => {
    expect(validatePricingStates(ops.pricingStates)).toEqual(ops.pricingStates)
    expect(validatePricingStates(ops.pricingStates)).not.toBe(ops.pricingStates)
    expect(() => validatePricingStates([])).toThrow()
    expect(() => validatePricingStates([{ ...ops.pricingStates[0] }, ops.pricingStates[0], ops.pricingStates[2]])).toThrow()
    expect(() => validatePricingStates([{ ...ops.pricingStates[0], routeAlias:'invalid-alias' }, ...ops.pricingStates.slice(1)])).toThrow()
    expect(formatRub(null, '₽')).toBe('Стоимость уточняется')
    expect(formatRub(0, '₽')).toBe('0,00 ₽')
    expect(formatMoscow('2026-09-15T10:00:00Z')).toContain('13:00')
  })

  it('expires a confirmed amount at the Core deadline while keeping the saved amount', async () => {
    vi.useFakeTimers()
    const wrapper = mount(CustomerCostSummary, { props:{ pricing:confirmed, ops } })
    expect(wrapper.get('.customer-cost__main > span').text()).toBe('Подтверждённая стоимость')
    expect(wrapper.text()).toContain('Действует до')
    expect(wrapper.text()).toContain('0,00 ₽')
    expect(wrapper.text()).toContain('В разработке')
    await vi.advanceTimersByTimeAsync(5000)
    expect(wrapper.get('.customer-cost__main > span').text()).toBe('Срок подтверждения истёк')
    expect(wrapper.text()).toContain('Срок подтверждения истёк')
    expect(wrapper.text()).toContain('12 000,00 ₽')
    wrapper.unmount()
  })

  it('shows a saved expired amount, masked extras, and an honest unavailable forecast', () => {
    const expired = mount(CustomerCostSummary, { props:{ pricing:{ ...confirmed, state:200 }, ops, compact:true } })
    expect(expired.get('.customer-cost__main > span').text()).toBe('Срок подтверждения истёк')
    expect(expired.text()).toContain('Срок подтверждения истёк')
    expect(expired.text()).toContain('12 000,00 ₽')
    expect(expired.text()).not.toContain('Доставка по России')
    expired.unmount()

    const unavailable = mount(CustomerCostSummary, { props:{ pricing:forecastPricing, ops } })
    expect(unavailable.get('.customer-cost__main > span').text()).toBe('Ориентировочная стоимость')
    expect(unavailable.text()).toContain('Стоимость уточняется')
    expect(unavailable.text()).not.toContain('В разработке')
    unavailable.unmount()

    const loading = mount(CustomerCostSummary, { props:{ pricing:null, ops:null, loading:true } })
    expect(loading.get('.customer-cost__main > span').text()).toBe('Стоимость заказа')
    expect(loading.text()).toContain('Рассчитываем стоимость…')
    loading.unmount()
  })
})
