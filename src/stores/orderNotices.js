// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

let createdOrderNotice = null

export function showOrderCreated(customerId, orderNumber) {
  createdOrderNotice = { customerId, orderNumber }
}

export function consumeOrderCreated(customerId) {
  const notice = createdOrderNotice
  createdOrderNotice = null
  return notice && notice.customerId === customerId ? notice.orderNumber : ''
}

export function resetOrderNoticesForTests() {
  createdOrderNotice = null
}
