<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { computed } from 'vue'
import { formatMoneyAmount } from '../moneyFormatting.js'
import { priceCents } from '../orderProduct.js'
import OrderItemFields from './OrderItemFields.vue'
import UiField from './ui/UiField.vue'

const props = defineProps({ order:{ type:Object, required:true }, ops:{ type:Object, required:true }, showMetadata:{ type:Boolean, default:false } })
const product = computed(() => props.order.product)
const display = value => value?.trim() || 'Не указано'
function sellerPrice(value, quantity = 1) {
  if (!value) return 'Не указано'
  const currency = props.ops.currencies.find(item => item.value === value.currency)
  const cents = priceCents(value.amount) * BigInt(quantity)
  return `${formatMoneyAmount(Number(cents) / 100)} ${currency.symbol}`
}
const totalPrice = computed(() => product.value.sellerPrice ? sellerPrice(product.value.sellerPrice, product.value.quantity) : '')
const reviewItem = computed(() => ({
  productName:display(product.value.productName), storeName:display(product.value.storeName),
  sellerPrice:sellerPrice(product.value.sellerPrice), quantity:product.value.quantity,
  color:display(product.value.color), size:display(product.value.size), comment:display(product.value.comment)
}))
</script>

<template>
  <section
    class="order-review-card"
    aria-labelledby="order-product-title"
  >
    <div class="order-review-card__heading">
      <div>
        <p
          v-if="order.showReviewFields"
          class="page-kicker"
        >
          НА ПРОВЕРКЕ
        </p>
        <h2 id="order-product-title">
          Товар
        </h2>
      </div>
    </div>
    <p
      v-if="order.showReviewFields"
      class="order-review-card__notice"
    >
      Проверим данные в течение двух часов.
    </p>
    <OrderItemFields
      :source-url="order.sourceUrl"
      :item="reviewItem"
      :total-price="totalPrice"
      readonly
    />
    <div
      v-if="showMetadata && (order.characteristics || order.dimensions)"
      class="order-item-fields"
    >
      <UiField
        v-for="(value, key) in order.characteristics"
        :key="key"
        :model-value="value"
        :label="key"
        readonly
      />
      <UiField
        v-if="order.dimensions"
        :model-value="`${order.dimensions.lengthCm} × ${order.dimensions.widthCm} × ${order.dimensions.heightCm}`"
        label="Габариты, см"
        readonly
      />
    </div>
  </section>
</template>
