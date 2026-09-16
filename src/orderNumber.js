// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

export function isOrderNumber(value) {
  return typeof value === 'string' && Boolean(value.trim()) && value.length <= 64
    && !/^(?:ops|preview|\.{1,2})$/iu.test(value)
}

export function isOrderDetailPath(path) {
  if (!/^\/api\/v1\/orders\/(?:[\w.!~*'()-]|%[0-9a-f]{2})+$/iu.test(path)) return false
  try {
    return isOrderNumber(decodeURIComponent(path.slice('/api/v1/orders/'.length)))
  } catch {
    return false
  }
}
