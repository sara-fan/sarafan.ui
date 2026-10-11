// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import { validateOrderStages } from '../src/orderStages.js'
import { validatePricing } from '../src/orders/customerPricing.js'
import CustomerCostSummary from '../src/components/CustomerCostSummary.vue'
import OrderStageHistory from '../src/components/OrderStageHistory.vue'
import OrderRecipient from '../src/components/OrderRecipient.vue'
import OrderProductImage from '../src/components/OrderProductImage.vue'
import OrderItemCard from '../src/components/OrderItemCard.vue'
import { completeOrder, forecastPricing, ops } from './fixtures/orders.js'

const start = '2026-09-15T10:00:00Z', end = '2026-09-15T12:00:00Z'
const stages = [{ status:300, at:start }, { status:350, at:end }]
it.each([undefined, null, {}, [null], [{ status:-1, at:start }], [{ status:300.1, at:start }],
  [{ status:300, at:'2026-02-30T10:00:00Z' }], [{ status:300, at:'2026-09-15T09:59:59Z' }],
  [{ status:300, at:'2026-09-15T12:00:01Z' }], [stages[0], stages[0]], [stages[1], stages[0]]])(
  'rejects malformed or invented stage evidence %j', value => {
    expect(() => validateOrderStages(value, start, end)).toThrow()
  })
it('retains only public dated evidence and accepts no-history orders', () => {
  expect(validateOrderStages([], start, end)).toEqual([])
  expect(validateOrderStages(stages.map(stage => ({ ...stage, actorName:'private', reason:'private' })), start, end)).toEqual(stages)
})
it.each([undefined, null, 1, 'true'])('requires boolean main payment evidence %s', value => {
  expect(() => validatePricing({ ...forecastPricing, mainPaymentPaid:value })).toThrow()
})
it.each([null, 0, 100])('marks a confirmed main payment and only its known delivery %s', domesticDeliveryRub => {
  const wrapper = mount(CustomerCostSummary, { props:{ pricing:{ ...forecastPricing, mainPaymentPaid:true, domesticDeliveryRub }, ops, deliverySelected:true } })
  expect(wrapper.find('[aria-label="Основной платёж подтверждён"]').exists()).toBe(true)
  expect(wrapper.find('[aria-label="Доставка по России оплачена"]').exists()).toBe(domesticDeliveryRub !== null)
  expect(wrapper.find('[aria-label="Таможенная пошлина оплачена"]').exists()).toBe(false)
  wrapper.unmount()
})
it.each([null, 0, 120])('shows saved customs before confirmation only in cancelled history %s', customsRub => {
  for (const historical of [true, false]) {
    const wrapper = mount(CustomerCostSummary, { props:{ pricing:{ ...forecastPricing, customsRub }, ops, historical } })
    const text = wrapper.findAll('dd')[1].text()
    expect(text).toBe(!historical ? 'Проверяем, потребуются ли таможенные платежи' : customsRub === null
      ? 'Расчёт не проводился' : customsRub === 0 ? 'Не ожидаются' : 'Предварительно 120,00 ₽')
    wrapper.unmount()
  }
})
it.each([0, 300, 350, 400, 999])('shows actual history only for fulfilment and completion %s', status => {
  const wrapper = mount(OrderStageHistory, { props:{ order:completeOrder({ status, stages }), ops } })
  expect(wrapper.find('section').exists()).toBe([300, 350, 400].includes(status))
  if ([300, 350, 400].includes(status)) {
    expect(wrapper.findAll('time').map(item => item.attributes('datetime'))).toEqual([start, end])
    expect(wrapper.text()).toContain('Текущий этап: ' + (status === 300 ? 'Оплачен' : status === 350 ? 'Доставляется' : 'Получен'))
    expect(wrapper.findAll('li')).toHaveLength(2)
    expect(wrapper.findAll('li')[1].text()).toContain('Доставляется')
  }
  wrapper.unmount()
})
it.each([null, 'Иванович'])('renders only recipient snapshot names, phone and email %s', patronymic => {
  const wrapper = mount(OrderRecipient, { props:{ profile:{ firstName:'Иван', lastName:'Иванов', patronymic, phone:'+79991234567', email:patronymic ? 'saved@example.test' : null,
    passportNumber:'secret-passport', inn:'secret-inn' } } })
  const values = wrapper.findAll('input').map(item => item.element.value)
  expect(values).toEqual(['Иванов Иван' + (patronymic ? ' Иванович' : ''), '+79991234567', patronymic ? 'saved@example.test' : 'Не указан'])
  expect(wrapper.html()).not.toContain('secret-')
  wrapper.unmount()
})
it('shares image failure, fallback and replacement behavior', async () => {
  const wrapper = mount(OrderProductImage)
  expect(wrapper.find('img').exists()).toBe(false)
  await wrapper.setProps({ src:'https://example.test/one.png', alt:'Saved product' })
  expect(wrapper.get('img').attributes('alt')).toBe('Saved product')
  await wrapper.get('img').trigger('error')
  expect(wrapper.find('img').exists()).toBe(false)
  await wrapper.setProps({ src:'https://example.test/two.png' })
  expect(wrapper.get('img').attributes('src')).toContain('two.png')
  wrapper.unmount()
})
it('renders saved product image and characteristics together in details', () => {
  const wrapper = mount(OrderItemCard, { props:{ order:completeOrder({ imageUrl:'https://example.test/saved.png', characteristics:{ Материал:'Сталь' } }), ops, showMetadata:true } })
  expect(wrapper.get('img').attributes('src')).toContain('saved.png')
  expect(wrapper.findAll('input').some(item => item.element.value === 'Сталь')).toBe(true)
  wrapper.unmount()
})
