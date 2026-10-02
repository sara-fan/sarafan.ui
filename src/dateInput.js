// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

export function dateInputDisplay(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value ?? '')
  return match ? `${match[3]}.${match[2]}.${match[1]}` : value ?? ''
}
export function dateInputIso(value) {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/u.exec(value)
  return match ? `${match[3]}-${match[2]}-${match[1]}` : value
}
export function pickerDateIso(value) {
  return `${String(value.getFullYear()).padStart(4, '0')}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}
