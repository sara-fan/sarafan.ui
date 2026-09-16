// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

export const statuses = [
  { value:0, name:'На проверке', routeAlias:'under_review', upperStatusValue:0, upperStatusName:'На проверке', upperStatusRouteAlias:'under_review', isTerminal:false, progressPercent:14 },
  { value:100, name:'Расчёт готов', routeAlias:'quote_ready', upperStatusValue:100, upperStatusName:'Расчёт готов', upperStatusRouteAlias:'quote_ready', isTerminal:false, progressPercent:32 },
  { value:200, name:'Расчёт истёк', routeAlias:'quote_expired', upperStatusValue:200, upperStatusName:'Расчёт истёк', upperStatusRouteAlias:'quote_expired', isTerminal:false, progressPercent:32 },
  { value:300, name:'Оплачен', routeAlias:'paid', upperStatusValue:300, upperStatusName:'Выполняется', upperStatusRouteAlias:'in_progress', isTerminal:false, progressPercent:48 },
  { value:400, name:'Получен', routeAlias:'received', upperStatusValue:400, upperStatusName:'Завершён', upperStatusRouteAlias:'completed', isTerminal:true, progressPercent:100 },
  { value:500, name:'Отменён', routeAlias:'cancelled', upperStatusValue:500, upperStatusName:'Отменён', upperStatusRouteAlias:'cancelled', isTerminal:true, progressPercent:100 }
]

export const currencies = [
  { value:643, name:'RUB', routeAlias:'rub' },
  { value:840, name:'USD', routeAlias:'usd' },
  { value:978, name:'EUR', routeAlias:'eur' }
]

export const productSourceUrl = {
  maximumLength:2048,
  topLevelDomainListVersion:'2026091400',
  topLevelDomains:['COM', 'XN--P1AI']
}

export const productLimits = {
  minimumQuantity:1,
  maximumQuantity:4,
  defaultQuantity:1,
  storeNameMaximumLength:200,
  productNameMaximumLength:500,
  colorMaximumLength:200,
  sizeMaximumLength:200,
  commentMaximumLength:2000,
  sellerPriceCurrency:840,
  maximumUnitPrice:99999999.99,
  priceDecimalPlaces:2,
  valueLimit:{
    maximumAmount:900,
    currency:978,
    available:true,
    sourceEffectiveDate:'2026-09-15',
    maximumTotalUsd:1125,
    exceededMessage:'Максимальная стоимость заказа при экспресс-перевозке 900 евро с учётом резерва 10% на изменение курса'
  }
}

export const ops = { statuses, currencies, productSourceUrl, productLimits }

export function product(overrides = {}) {
  return {
    productName:'Товар',
    storeName:'Магазин',
    sellerPrice:{ amount:12.34, currency:840 },
    quantity:2,
    color:'синий',
    size:'M',
    comment:'Комментарий',
    ...overrides
  }
}

export function completeOrder(overrides = {}) {
  const { product:productOverrides, ...orderOverrides } = overrides
  const currentProduct = product(productOverrides)
  return {
    id:3,
    orderNumber:'12345678-3',
    status:0,
    sourceUrl:'https://shop.example.com/item',
    productName:currentProduct.productName,
    storeName:currentProduct.storeName,
    imageUrl:null,
    sellerPrice:currentProduct.sellerPrice,
    dimensions:null,
    characteristics:null,
    quantity:currentProduct.quantity,
    comment:currentProduct.comment,
    appliedExchangeRate:null,
    createdAt:'2026-09-15T10:00:00Z',
    showReviewFields:true,
    ...orderOverrides,
    product:currentProduct
  }
}
