// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import CustomerCostSummary from '../src/components/CustomerCostSummary.vue'
import { forecastPricing, ops } from './fixtures/orders.js'
import { validatePricing } from '../src/orders/customerPricing.js'

it.each([[true, 120, 100, true], [false, 120, 100, false], [true, null, 100, true],
  [true, 0, 100, true], [true, 120, 0, true], [true, 120, 200, true]])(
  'renders paid=%s with customs=%s state=%s as visible=%s', (customsPaid, customsRub, state, visible) => {
    const pricing = { ...forecastPricing, customsPaid, customsRub, state, totalRub:100,
      calculatedAt:forecastPricing.asOf, validUntil:state === 0 ? null : '2099-01-01T00:00:00Z' }
    const wrapper = mount(CustomerCostSummary, { props:{ pricing, ops, historical:true } })
    expect(wrapper.find('[role="img"][aria-label="Таможенная пошлина оплачена"]').exists()).toBe(visible)
    expect(wrapper.findAll('.customer-cost__excluded dd')).toHaveLength(2)
    wrapper.unmount()
  })
it.each([undefined, null, 'true', 1])('rejects malformed paid evidence %s', customsPaid => {
  expect(() => validatePricing({ ...forecastPricing, customsPaid })).toThrow()
})
