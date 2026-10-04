<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import UiSelectionControl from './ui/UiSelectionControl.vue'
import UiButton from './ui/UiButton.vue'
import { hasDeliveryAddress, formatDeliveryAddress } from '../orders/deliveryAddress.js'
defineProps({ modelValue:{ type:String, required:true }, options:{ type:Array, required:true }, address:{ type:Object, required:true }, savedCourier:{ type:Object, default:null }, disabled:{ type:Boolean, default:false }, errors:{ type:Array, default:() => [] } })
const emit = defineEmits(['update:modelValue', 'refresh'])
</script>
<template>
  <section class="ui-form-section">
    <h2>Доставка</h2>
    <p>Способ и адрес доставки можно изменить до оплаты заказа.</p>
    <div class="ui-form-grid">
      <UiSelectionControl
        v-for="option in options"
        :key="option.routeAlias"
        :model-value="modelValue"
        kind="radio"
        name="delivery"
        :value="option.routeAlias"
        :disabled="disabled"
        :error="errors.length > 0"
        :aria-describedby="errors.length ? 'checkout-delivery-error' : undefined"
        @update:model-value="emit('update:modelValue', $event)"
      >
        {{ option.name }} — {{ option.destinationSource === 'customer-profile' ? (savedCourier?.destination || (hasDeliveryAddress(address) ? formatDeliveryAddress(address) : 'Заполните адрес доставки')) : option.destination }}
      </UiSelectionControl>
    </div>
    <slot />
    <UiButton
      v-if="errors.length"
      :disabled="disabled"
      @click="emit('refresh')"
    >
      Обновить адрес доставки
    </UiButton>
    <p
      v-if="errors.length"
      id="checkout-delivery-error"
      role="alert"
    >
      {{ errors.join(' ') }}
    </p>
  </section>
</template>
