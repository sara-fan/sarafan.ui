// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { createRouter, createWebHistory } from 'vue-router'

import ConsentsView from './views/ConsentsView.vue'
import HomeView from './views/HomeView.vue'
import LegalDocumentView from './views/LegalDocumentView.vue'
import NotFoundView from './views/NotFoundView.vue'
import OrderDetailsView from './views/OrderDetailsView.vue'
import OrdersView from './views/OrdersView.vue'
import PendingView from './views/PendingView.vue'
import ProfileView from './views/ProfileView.vue'
import ProductView from './views/ProductView.vue'

export const ACCESS = Object.freeze({
  PUBLIC: 'public',
  LIMITED: 'limited',
  CUSTOMER: 'customer'
})

export const routes = [
  { path: '/', name: 'home', component: HomeView, meta: { access: ACCESS.PUBLIC, navigationSection: 'home' } },
  { path: '/product', name: 'product', component: ProductView, meta: { access: ACCESS.PUBLIC, navigationSection: 'product' } },
  { path: '/orders', name: 'orders', component: OrdersView, meta: { access: ACCESS.CUSTOMER, navigationSection: 'orders' } },
  { path: '/orders/:orderNumber', name: 'order-details', component: OrderDetailsView, meta: { access: ACCESS.CUSTOMER, navigationSection: 'orders' } },
  { path: '/orders/:orderNumber/checkout', name: 'checkout', component: PendingView, props: { title: 'Оформление заказа', copy: 'Оформление заказа будет подключено отдельной задачей MVP.' }, meta: { access: ACCESS.CUSTOMER, navigationSection: 'orders' } },
  { path: '/orders/:orderNumber/payment', name: 'payment', component: PendingView, props: { title: 'Оплата', copy: 'Демонстрационная оплата будет подключена отдельной задачей MVP.' }, meta: { access: ACCESS.CUSTOMER, navigationSection: 'orders' } },
  { path: '/profile', name: 'profile', component: ProfileView, meta: { access: ACCESS.CUSTOMER, navigationSection: 'profile' } },
  { path: '/legal/:documentRef', name: 'legal-document', component: LegalDocumentView, meta: { access: ACCESS.LIMITED, navigationSection: 'home' } },
  { path: '/consents/cookies', redirect: '/consents' },
  { path: '/consents/personal-data', name: 'personal-consents', component: ConsentsView, props: { section: 'personal' }, meta: { access: ACCESS.LIMITED, navigationSection: 'home' } },
  { path: '/consents', name: 'consents', component: ConsentsView, meta: { access: ACCESS.LIMITED, navigationSection: 'home' } },
  { path: '/:pathMatch(.*)*', name: 'not-found', component: NotFoundView, meta: { access: ACCESS.PUBLIC } }
]

export function createAppRouter(history = createWebHistory(import.meta.env.BASE_URL)) {
  return createRouter({ history, routes })
}

export default createAppRouter()
