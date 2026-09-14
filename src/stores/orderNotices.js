// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

let createdOrderNumber = ''

export function showOrderCreated(orderNumber) {
  createdOrderNumber = orderNumber
}

export function consumeOrderCreated() {
  const value = createdOrderNumber
  createdOrderNumber = ''
  return value
}

export function resetOrderNoticesForTests() {
  createdOrderNumber = ''
}
