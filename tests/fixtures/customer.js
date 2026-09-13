// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

export function customerDto(overrides = {}) {
  const phone = overrides.phone ?? '+79990000001'
  return {
    id:1, phone, state:0, createdAt:'2026-08-01T12:00:00Z', updatedAt:'2026-08-01T12:00:00Z', hasPhoto:false,
    ...overrides,
    profile:{
      phone, lastName:null, firstName:null, patronymic:null, email:null,
      passportSeries:null, passportNumber:null, passportIssueDate:null, passportIssuedBy:null,
      inn:null, postalCode:null, city:null, address:null,
      ...overrides.profile
    }
  }
}
