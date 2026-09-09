<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { RouterLink } from 'vue-router'

const placeholderOrders = Object.freeze([
  {
    id: 'SRF-000123',
    title: 'Nike Air Max 90 Essential',
    domain: 'nike.com · 1 товар',
    status: 'Проверяем заказ',
    tone: 'review',
    progress: 46,
    progressLabel: 'На проверке',
    priceLabel: 'Ожидаемая стоимость',
    price: '€ 129,90',
    visual: 'shoe'
  },
  {
    id: 'SRF-000119',
    title: 'Mini Quilted Shoulder Bag',
    domain: 'cos.com · 1 товар',
    status: 'Ожидает оплаты',
    tone: 'payment',
    progress: 68,
    progressLabel: 'К оплате',
    priceLabel: 'К оплате',
    price: '$ 85,00',
    visual: 'bag'
  }
])
</script>

<template>
  <main class="page-container orders-view">
    <header class="page-heading orders-heading">
      <div>
        <h1>Мои заказы</h1>
        <p>Следите за проверкой, оплатой и доставкой ваших заказов.</p>
      </div>
    </header>

    <section
      class="orders-panel"
      aria-labelledby="active-orders-title"
    >
      <div class="orders-panel__heading">
        <div>
          <p class="page-kicker">
            В ПУТИ И В РАБОТЕ
          </p>
          <h2 id="active-orders-title">
            Активные заказы
          </h2>
        </div>
        <span class="orders-panel__count">2 заказа</span>
      </div>

      <div class="orders-list">
        <article
          v-for="order in placeholderOrders"
          :key="order.id"
          class="order-card"
        >
          <div
            class="order-card__visual"
            :class="`order-card__visual--${order.visual}`"
            aria-hidden="true"
          >
            <span>{{ order.visual === 'shoe' ? '👟' : '▱' }}</span>
          </div>

          <div class="order-card__summary">
            <div class="order-card__meta">
              <span class="order-card__number">{{ order.id }}</span>
              <span
                class="order-card__status"
                :class="`order-card__status--${order.tone}`"
              >{{ order.status }}</span>
            </div>
            <h3>{{ order.title }}</h3>
            <p class="order-card__domain">
              {{ order.domain }}
            </p>

            <div class="order-card__progress">
              <div class="order-card__progress-labels">
                <span>Заказ оформлен</span>
                <strong>{{ order.progressLabel }}</strong>
                <span>Доставка</span>
              </div>
              <div
                class="order-card__progress-track"
                role="progressbar"
                aria-label="Прогресс заказа"
                aria-valuemin="0"
                aria-valuemax="100"
                :aria-valuenow="order.progress"
              >
                <span :style="{ width: `${order.progress}%` }" />
              </div>
            </div>
          </div>

          <div class="order-card__price">
            <small>{{ order.priceLabel }}</small>
            <strong>{{ order.price }}</strong>
            <RouterLink
              class="order-card__action"
              :to="{ name: 'order-details', params: { orderId: order.id } }"
              :aria-label="`Открыть заказ ${order.id}`"
            >
              <span aria-hidden="true">→</span>
            </RouterLink>
          </div>
        </article>
      </div>
    </section>
  </main>
</template>
