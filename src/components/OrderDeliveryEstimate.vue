<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

defineProps({ estimate: { type: Object, default: null } })
</script>

<template>
  <p v-if="estimate">
    Ориентировочный срок получения заказа: {{ estimate.minimumDays }}–{{ estimate.maximumDays }} календарных дней с момента подтверждения оплаты
  </p>
</template>
