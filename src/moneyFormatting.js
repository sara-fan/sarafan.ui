// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

const displayedMoney = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits:2,
  maximumFractionDigits:2
})

export function formatMoneyAmount(value) {
  return displayedMoney.format(value)
}
