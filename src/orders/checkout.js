// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { isIsoDate } from '../api/validation.js'
import { createInternalProblem } from '../errors/problem.js'
const limits = { lastName:100, firstName:100, patronymic:100, email:254, passportSeries:32, passportNumber:32, passportIssuedBy:500, inn:12, postalCode:20, city:150, address:500 }
function invalid() { throw createInternalProblem('protocolError') }
export function validateCheckoutDeliveries(value) {
  if (!Array.isArray(value) || value.length !== 2) invalid()
  const aliases = new Set()
  for (const row of value) {
    if (!row || !['courier', 'pickup'].includes(row.routeAlias) || aliases.has(row.routeAlias)
      || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 500
      || (row.routeAlias === 'courier'
        ? row.destinationSource !== 'customer-profile' || row.destination !== null
        : row.destinationSource !== 'test-pickup' || typeof row.destination !== 'string' || !row.destination.trim() || row.destination.length > 500)) invalid()
    aliases.add(row.routeAlias)
  }
  return value.map(row => ({ ...row }))
}
export function validateCheckout(value, deliveries) {
  const profile = value?.profile
  const delivery = deliveries?.find(row => row.routeAlias === value?.delivery?.routeAlias)
  if (!profile || !delivery || typeof value.delivery.name !== 'string' || !value.delivery.name.trim() || value.delivery.name.length > 500
    || typeof value.delivery.destination !== 'string' || !value.delivery.destination.trim() || value.delivery.destination.length > 674
    || typeof profile.phone !== 'string' || !/^\+7[0-9]{10}$/u.test(profile.phone)
    || typeof profile.firstName !== 'string' || !profile.firstName.trim() || typeof profile.lastName !== 'string' || !profile.lastName.trim()
    || Object.entries(limits).some(([field, max]) => profile[field] !== null && (typeof profile[field] !== 'string' || profile[field].length > max))
    || profile.passportIssueDate !== null && !isIsoDate(profile.passportIssueDate)
) invalid()
  return { profile:{ ...profile }, delivery:{ ...value.delivery } }
}
