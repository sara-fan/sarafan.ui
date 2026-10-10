<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import UiButton from './ui/UiButton.vue'
import PaymentQr from './PaymentQr.vue'
import { isMobileDevice } from '../mobileDevice.js'

defineProps({
  qrUrl: { type:String, required:true },
  identity: { type:String, required:true },
  disabled: { type:Boolean, default:false }
})
const emit = defineEmits(['pay'])
const mobileDevice = isMobileDevice()
const sbpLogoUrl = '/sbp-logo.svg'
</script>

<template>
  <section
    class="payment-method"
    aria-label="Способ оплаты"
    :aria-busy="disabled"
  >
    <UiButton
      v-if="mobileDevice"
      class="bank-payment"
      variant="primary"
      :disabled="disabled"
      @click="emit('pay')"
    >
      <img
        class="bank-payment__logo"
        :src="sbpLogoUrl"
        alt=""
        aria-hidden="true"
        width="30"
        height="35"
      >
      Оплатить через СБП
    </UiButton>
    <p>
      <template v-if="!mobileDevice">
        Отсканируйте QR-код в приложении банка.
      </template>
      Вручную введите указанную сумму, проверьте получателя и подтвердите платёж в банке.
    </p>
    <p>Проверка платежа выполняется оператором</p>
    <PaymentQr
      v-if="!mobileDevice && !disabled"
      :url="qrUrl"
      :identity="identity"
    />
    <p
      v-else-if="!mobileDevice"
      role="status"
    >
      Обновляем платёжные данные…
    </p>
  </section>
</template>

<style scoped>
.bank-payment__logo { flex:none; box-sizing:content-box; padding:var(--sarafan-space-4); border-radius:var(--sarafan-radius-5); background:var(--sarafan-paper); }
</style>
