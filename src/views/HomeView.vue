<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { ref } from 'vue'
import { useRouter } from 'vue-router'

import PublicInfoBlock from '../components/PublicInfoBlock.vue'
import UiButton from '../components/ui/UiButton.vue'
import UiField from '../components/ui/UiField.vue'

const router = useRouter()
const sourceUrl = ref('')

function begin() {
  router.push({ name: 'product', state: { sourceUrl: sourceUrl.value } })
}
</script>

<template>
  <main class="home-view">
    <section
      class="home-hero"
      aria-labelledby="home-title"
    >
      <div class="home-hero__copy">
        <p class="page-kicker">
          ПОКУПКИ ИЗ США
        </p>
        <h1 id="home-title">
          Закажите товар — остальное сделаем мы
        </h1>
        <p class="home-hero__lead">
          Вставьте ссылку на товар из американского интернет-магазина и получите предварительный расчёт.
        </p>
      </div>
      <form
        class="product-entry"
        @submit.prevent="begin"
      >
        <UiField
          v-model="sourceUrl"
          label="Ссылка на товар"
          type="url"
          placeholder="https://store.com/product"
          autocomplete="url"
          required
        />
        <UiButton
          type="submit"
          variant="primary"
        >
          Рассчитать стоимость
        </UiButton>
      </form>
      <p class="product-entry__note">
        До расчёта нам не нужны ваши контактные данные.
      </p>
    </section>

    <section
      class="home-steps"
      aria-labelledby="steps-title"
    >
      <p class="page-kicker">
        КАК ЭТО РАБОТАЕТ
      </p>
      <h2 id="steps-title">
        Три понятных шага
      </h2>
      <ol>
        <li><span>1</span><div><strong>Отправьте ссылку</strong><p>На товар из интернет-магазина США.</p></div></li>
        <li><span>2</span><div><strong>Подтвердите расчёт</strong><p>Покажем стоимость товара, выкупа и доставки.</p></div></li>
        <li><span>3</span><div><strong>Получите заказ</strong><p>Организуем оплату, логистику и выдачу в России.</p></div></li>
      </ol>
    </section>

    <PublicInfoBlock />
  </main>
</template>
