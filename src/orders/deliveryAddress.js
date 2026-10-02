// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

export const deliveryAddressFields = ['postalCode', 'city', 'address']
export function deliveryAddress(profile) { return Object.fromEntries(deliveryAddressFields.map(key => [key, profile?.[key]?.trim() || ''])) }
export function hasDeliveryAddress(profile) { return deliveryAddressFields.every(key => Boolean(profile?.[key]?.trim())) }
export function formatDeliveryAddress(profile) { return deliveryAddressFields.map(key => profile?.[key]?.trim()).filter(Boolean).join(', ') }
