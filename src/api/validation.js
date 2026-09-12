// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

const RFC3339_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/u
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u

function validCalendarDate(year, month, day) {
  if (year < 1 || month < 1 || month > 12 || day < 1) return false
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day <= days[month - 1]
}

export function isIsoDate(value) {
  if (typeof value !== 'string') return false
  const match = ISO_DATE_PATTERN.exec(value)
  return Boolean(match && validCalendarDate(Number(match[1]), Number(match[2]), Number(match[3])))
}

export function isRfc3339DateTime(value) {
  if (typeof value !== 'string') return false
  const match = RFC3339_PATTERN.exec(value)
  if (!match || !validCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]))) return false
  const [, , , , hour, minute, second, offsetHour, offsetMinute] = match
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return false
  if (offsetHour !== undefined
    && (Number(offsetHour) > 14 || Number(offsetMinute) > 59
      || Number(offsetHour) === 14 && Number(offsetMinute) !== 0)) return false
  return Number.isFinite(Date.parse(value))
}
