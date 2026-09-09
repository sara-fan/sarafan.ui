// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { createRouter, createWebHistory } from 'vue-router'

import HomeView from './views/HomeView.vue'
import NotFoundView from './views/NotFoundView.vue'
import PendingView from './views/PendingView.vue'
import ProfileView from './views/ProfileView.vue'

export const ACCESS = Object.freeze({
  PUBLIC: 'public',
  LIMITED: 'limited',
  CUSTOMER: 'customer'
})

export const routes = [
  { path: '/', name: 'home', component: HomeView, meta: { access: ACCESS.PUBLIC, navigationSection: 'home' } },
  { path: '/product', name: 'product', component: PendingView, props: { title: 'Товар', copy: 'Распознавание товара и прогноз стоимости появятся в следующем этапе MVP.' }, meta: { access: ACCESS.PUBLIC, navigationSection: 'product' } },
  { path: '/orders', name: 'orders', component: PendingView, props: { title: 'Мои заказы', copy: 'Список заказов будет подключён отдельной задачей MVP.' }, meta: { access: ACCESS.CUSTOMER, navigationSection: 'orders' } },
  { path: '/orders/:orderId', name: 'order-details', component: PendingView, props: route => ({ title: 'Заказ', copy: `Детали заказа ${route.params.orderId} будут подключены отдельной задачей MVP.` }), meta: { access: ACCESS.CUSTOMER, navigationSection: 'orders' } },
  { path: '/orders/:orderId/checkout', name: 'checkout', component: PendingView, props: { title: 'Оформление заказа', copy: 'Оформление заказа будет подключено отдельной задачей MVP.' }, meta: { access: ACCESS.CUSTOMER, navigationSection: 'orders' } },
  { path: '/orders/:orderId/payment', name: 'payment', component: PendingView, props: { title: 'Оплата', copy: 'Демонстрационная оплата будет подключена отдельной задачей MVP.' }, meta: { access: ACCESS.CUSTOMER, navigationSection: 'orders' } },
  { path: '/profile', name: 'profile', component: ProfileView, meta: { access: ACCESS.CUSTOMER, navigationSection: 'profile' } },
  { path: '/legal/:documentRef', name: 'legal-document', component: HomeView, meta: { access: ACCESS.LIMITED, navigationSection: 'home', overlay: true } },
  { path: '/consents', name: 'consents', component: HomeView, meta: { access: ACCESS.LIMITED, navigationSection: 'home', overlay: true } },
  { path: '/:pathMatch(.*)*', name: 'not-found', component: NotFoundView, meta: { access: ACCESS.PUBLIC } }
]

export function createAppRouter(history = createWebHistory(import.meta.env.BASE_URL)) {
  return createRouter({ history, routes })
}

export default createAppRouter()
