<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import UiField from './ui/UiField.vue'

defineProps({
  sourceUrl: { type: String, required: true },
  item: { type: Object, required: true },
  totalPrice: { type: String, default: '' },
  currencySymbol: { type: String, default: '' },
  readonly: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  errorsFor: { type: Function, default: () => [] }
})

const emit = defineEmits(['update:field', 'blur'])
const update = (name, value) => emit('update:field', name, value)
const blur = name => emit('blur', name)
</script>

<template>
  <div class="order-item-fields">
    <div class="order-item-fields__source">
      <UiField
        :model-value="sourceUrl"
        label="Исходная ссылка"
        readonly
      />
      <a
        :href="sourceUrl"
        target="_blank"
        rel="noopener noreferrer"
      >Открыть страницу товара</a>
    </div>
    <UiField
      :model-value="item.productName"
      name="productName"
      label="Название товара, как на сайте"
      :hint="readonly ? '' : 'Необязательно'"
      :readonly="readonly"
      :disabled="disabled"
      :errors="errorsFor('productName')"
      @update:model-value="update('productName', $event)"
      @blur="blur('productName')"
    />
    <UiField
      :model-value="item.storeName"
      name="storeName"
      label="Магазин"
      :hint="readonly ? '' : 'Необязательно'"
      :readonly="readonly"
      :disabled="disabled"
      :errors="errorsFor('storeName')"
      @update:model-value="update('storeName', $event)"
      @blur="blur('storeName')"
    />
    <UiField
      :model-value="item.sellerPrice"
      name="sellerPrice"
      :label="readonly ? 'Цена за единицу' : `Цена за единицу, ${currencySymbol}`"
      inputmode="decimal"
      :hint="readonly ? '' : 'Необязательно'"
      :readonly="readonly"
      :disabled="disabled"
      :errors="errorsFor('sellerPrice')"
      @update:model-value="update('sellerPrice', $event)"
      @blur="blur('sellerPrice')"
    />
    <UiField
      :model-value="item.quantity"
      name="quantity"
      label="Количество"
      inputmode="numeric"
      :required="!readonly"
      :readonly="readonly"
      :disabled="disabled"
      :errors="errorsFor('quantity')"
      @update:model-value="update('quantity', $event)"
      @blur="blur('quantity')"
    />
    <UiField
      :model-value="totalPrice"
      label="Общая цена"
      readonly
    />
    <UiField
      :model-value="item.color"
      name="color"
      label="Цвет, как на сайте"
      :hint="readonly ? '' : 'Необязательно'"
      :readonly="readonly"
      :disabled="disabled"
      :errors="errorsFor('color')"
      @update:model-value="update('color', $event)"
      @blur="blur('color')"
    />
    <UiField
      :model-value="item.size"
      name="size"
      label="Размер"
      :hint="readonly ? '' : 'Необязательно'"
      :readonly="readonly"
      :disabled="disabled"
      :errors="errorsFor('size')"
      @update:model-value="update('size', $event)"
      @blur="blur('size')"
    />
    <div class="order-item-fields__comment">
      <UiField
        :model-value="item.comment"
        name="comment"
        label="Комментарий"
        :hint="readonly ? '' : 'Необязательно'"
        multiline
        :rows="4"
        :readonly="readonly"
        :disabled="disabled"
        :errors="errorsFor('comment')"
        @update:model-value="update('comment', $event)"
        @blur="blur('comment')"
      />
    </div>
  </div>
</template>
