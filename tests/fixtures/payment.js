// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { completeOrder, forecastPricing } from './orders.js'
import { customerDto } from './customer.js'
export function payment(overrides = {}) {
  return {
    order:completeOrder({ status:100, checkout:{ profile:customerDto({ profile:{ firstName:'Иван', lastName:'Иванов' } }).profile,
      delivery:{ routeAlias:'courier', name:'Курьер', destination:'123456, Москва, Адрес' } },
      pricing:{ ...forecastPricing, state:100, totalRub:1000, domesticDeliveryRub:100, customsRub:120,
        calculatedAt:'2026-09-15T10:00:00Z', validUntil:'2026-09-15T11:00:00Z' } }),
    mainPaymentRub:1100, canPay:true,
    paymentInformation:{ bundleId:1, qrUrl:'/api/v1/payment-information/current/qr?v=' + 'a'.repeat(64), information:{
      recipientType:0, recipientName:'Получатель', inn:'0012345678', kpp:'001234567', settlementAccount:'00000000000000000001',
      bankName:'Банк', bik:'001234567', correspondentAccount:'00000000000000000002',
      paymentLink:'https://bank.example/Pay/Ab%2Fc?Token=AbC+%2B&x=1'
    } }, ...overrides
  }
}
