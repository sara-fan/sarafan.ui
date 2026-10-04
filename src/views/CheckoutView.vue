<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import CustomerCostSummary from '../components/CustomerCostSummary.vue'
import OrderItemCard from '../components/OrderItemCard.vue'
import PassportDataFields from '../components/PassportDataFields.vue'
import ConsentRenewalDialog from '../components/ConsentRenewalDialog.vue'
import UiAlert from '../components/ui/UiAlert.vue'
import UiButton from '../components/ui/UiButton.vue'
import UiField from '../components/ui/UiField.vue'
import CheckoutDeliverySelector from '../components/CheckoutDeliverySelector.vue'
import DeliveryAddressFields from '../components/DeliveryAddressFields.vue'
import { deliveryAddress, deliveryAddressFields, hasDeliveryAddress } from '../orders/deliveryAddress.js'
import { CORE_PROBLEM_TYPES, createInternalProblem, normalizeProblem, presentProblem, presentProblemTitle, problemFieldErrors, hasOnlyPresentedFieldErrors } from '../errors/problem.js'
import { isOrderNumber } from '../orderNumber.js'
import { validateCustomerOrder, validateOrderOps } from '../stores/orders.js'
import { useSession } from '../stores/session.js'
import { useConsents } from '../stores/consents.js'
import { isConsentRenewalProblem, useConsentRenewal } from '../useConsentRenewal.js'
import { useValidationFocus, validationFields } from '../validationFocus.js'

const session = useSession(), consents = useConsents(), renewal = useConsentRenewal()
const route = useRoute(), router = useRouter()
const ops = ref(null), order = ref(null), problem = ref(null), writeProblem = ref(null)
const conflict = ref(false), recovered = ref(false)
const loading = ref(false), busy = ref(false), expired = ref(false), focusRoot = ref(null)
const form = reactive({}), address = ref({}), addressBaseline = ref({}), addressChanged = ref(false)
const recipientFields = { lastName:'Фамилия', firstName:'Имя', patronymic:'Отчество', phone:'Телефон', email:'Email' }
const profileFields = ['lastName', 'firstName', 'patronymic', 'email', 'inn', 'passportSeries', 'passportNumber', 'passportIssueDate', 'passportIssuedBy']
const fieldName = key => profileFields.includes(key) ? 'profile.' + key : deliveryAddressFields.includes(key) ? 'deliveryAddress.' + key : key
const aliases = Object.fromEntries([...profileFields, ...deliveryAddressFields, 'phone'].map(key => [fieldName(key), key]))
const examples = ['Фото товара на складе в США', 'Проверка товара', 'Страхование отправления']
let generation = 0, expiryTimer, formContext = null, disposed = false
let releaseConsentNotice = null
function ownConsentNotice() { releaseConsentNotice ??= consents.acquireNoticeSuppression() }
function releaseConsentNoticeOwnership() { releaseConsentNotice?.(); releaseConsentNotice = null }
function releaseConsentNoticeIfClear() { if (!problem.value && !writeProblem.value) releaseConsentNoticeOwnership() }
const active = computed(() => order.value?.status === 100 && order.value?.pricing.state === 100 && !expired.value)
const savedCourier = computed(() => !addressChanged.value && order.value?.checkout?.delivery.routeAlias === 'courier' ? order.value.checkout.delivery : null)
const keepCourier = computed(() => form.delivery === 'courier' && Boolean(savedCourier.value))
const complete = computed(() => form.firstName?.trim() && form.lastName?.trim() && form.phone?.trim() && form.delivery && (keepCourier.value || form.delivery !== 'courier' || hasDeliveryAddress(address.value)))
const writePageProblem = computed(() => hasOnlyPresentedFieldErrors(writeProblem.value, [...Object.keys(aliases), 'delivery']) ? null : writeProblem.value)
const focusAfter = useValidationFocus(focusRoot, { active:() => active.value, context:() => [session.customer.value?.id, route.params.orderNumber], ready:() => !busy.value })
function fieldErrors(key) { return problemFieldErrors(writeProblem.value, fieldName(key)) }
function capture() {
  const current = generation, id = session.customer.value?.id, number = String(route.params.orderNumber ?? '')
  return () => !disposed && current === generation && id === session.customer.value?.id && number === String(route.params.orderNumber ?? '')
}
async function load(reconcileDelivery = false) {
  if (busy.value || loading.value || conflict.value && reconcileDelivery !== true) return
  ++generation
  renewal.cancel()
  const id = session.customer.value?.id, number = String(route.params.orderNumber ?? '')
  const isCurrent = capture()
  globalThis.clearTimeout(expiryTimer)
  recovered.value = false
  order.value = null; problem.value = null; writeProblem.value = null; expired.value = false; loading.value = false
  const context = JSON.stringify([id, number]), fill = context !== formContext
  if (fill) { for (const key of Object.keys(form)) delete form[key]; formContext = null }
  if (!isOrderNumber(number)) { releaseConsentNoticeOwnership(); problem.value = createInternalProblem('invalidInput'); return }
  if (!id) { releaseConsentNoticeOwnership(); return }
  ownConsentNotice()
  loading.value = true
  try {
    let catalog, value
    await session.orderRequest('/api/v1/orders/ops', {}, isCurrent, data => { catalog = validateOrderOps(data) })
    if (!isCurrent()) return
    if (!catalog.checkoutDeliveries) throw createInternalProblem('protocolError')
    await session.orderRequest('/api/v1/orders/' + encodeURIComponent(number), {}, isCurrent, data => { value = validateCustomerOrder(data, catalog, number) })
    if (!isCurrent()) return
    ops.value = catalog; order.value = value
    if (fill || !addressChanged.value) {
      addressBaseline.value = deliveryAddress(session.customer.value?.profile)
      address.value = deliveryAddress(value.checkout?.delivery.routeAlias === 'courier' ? value.checkout.profile : session.customer.value?.profile)
      addressChanged.value = false
    }
    if (fill) {
      const profile = value.checkout?.profile ?? session.customer.value?.profile ?? {}
      for (const key of [...profileFields, 'phone']) form[key] = profile[key] ?? ''
      form.phone = session.customer.value.phone
      form.delivery = value.checkout?.delivery.routeAlias ?? ''
      formContext = context
    }
    if (!fill && reconcileDelivery === true && value.checkout) form.delivery = value.checkout.delivery.routeAlias
    conflict.value = false
    const remaining = Date.parse(value.pricing.validUntil) - Date.parse(value.pricing.asOf)
    if (value.pricing.state === 100 && remaining > 0) expiryTimer = globalThis.setTimeout(() => { expired.value = true }, Math.min(remaining, 2147483647))
    else expired.value = true
    if (active.value) await renewal.ensure([1, 2], isCurrent)
  } catch (value) { if (isCurrent()) problem.value = normalizeProblem(value, { detail:'Не удалось загрузить оформление заказа' }) }
  finally { if (isCurrent()) { loading.value = false; releaseConsentNoticeIfClear() } }
}
async function saveAction() {
  if (busy.value || conflict.value || !active.value || !complete.value) return
  const isCurrent = capture(), number = order.value.orderNumber
  ownConsentNotice()
  busy.value = true; writeProblem.value = null
  try {
    if (!await renewal.ensure([1, 2], isCurrent) || !isCurrent() || !active.value) return
    const payload = { expectedUpdatedAt:order.value.updatedAt, profile:Object.fromEntries(profileFields.map(key => [key, form[key]?.trim() || null])),
      delivery:form.delivery, ...(form.delivery === 'courier' && !keepCourier.value ? { expectedDeliveryAddress:deliveryAddress(addressBaseline.value), ...(addressChanged.value ? { deliveryAddress:deliveryAddress(address.value) } : {}) } : {}) }
    let saved
    const save = () => session.orderRequest('/api/v1/orders/' + encodeURIComponent(number) + '/checkout', {
      method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(payload)
    }, isCurrent, data => {
      saved = validateCustomerOrder(data, ops.value, number)
      if (!saved.checkout) throw createInternalProblem('protocolError')
    })
    try { await save() }
    catch (value) {
      if (!isConsentRenewalProblem(value)) throw value
      if (!await renewal.ensure([1, 2], isCurrent) || !isCurrent() || !active.value) return
      await save()
    }
    if (!isCurrent()) return
    order.value = saved
    addressChanged.value = false
    if (!active.value) return
    await session.refreshCustomer()
    if (isCurrent() && active.value) await router.push({ name:'payment', params:{ orderNumber:number } })
  } catch (value) {
    if (!isCurrent()) return
    writeProblem.value = normalizeProblem(value, { detail:'Не удалось сохранить оформление заказа' })
    conflict.value = [CORE_PROBLEM_TYPES.orderUpdateConflict, CORE_PROBLEM_TYPES.orderCheckoutUnavailable].includes(writeProblem.value.type)
  } finally { if (isCurrent()) { busy.value = false; releaseConsentNoticeIfClear() } }
}
async function recoverConflict() {
  const expectedGeneration = generation + 1
  await load(true)
  if (!disposed && expectedGeneration === generation && !problem.value && order.value) recovered.value = true
}
async function refreshAddress() {
  if (busy.value) return
  const isCurrent = capture()
  busy.value = true
  try {
    const customer = await session.refreshCustomer()
    if (isCurrent() && customer) { addressBaseline.value = deliveryAddress(customer.profile); address.value = { ...addressBaseline.value }; addressChanged.value = true; if (!conflict.value) writeProblem.value = null }
  } catch (error) { if (isCurrent()) writeProblem.value = normalizeProblem(error) }
  finally { if (isCurrent()) { busy.value = false; releaseConsentNoticeIfClear() } }
}
function editAddress(name, value) { address.value[name] = value; addressChanged.value = true }
function submit() { return focusAfter(saveAction, () => validationFields(writeProblem.value, { aliases })) }
function revisit() { if (globalThis.document.visibilityState === 'visible' && !conflict.value) void load() }
globalThis.document.addEventListener('visibilitychange', revisit)
watch(active, value => { if (!value) renewal.cancel() }, { flush:'sync' })
watch([() => session.customer.value?.id, () => route.params.orderNumber], () => {
  releaseConsentNoticeOwnership(); conflict.value = false
  busy.value = false; loading.value = false; renewal.cancel(); void load()
}, { immediate:true, flush:'sync' })
onBeforeUnmount(() => { releaseConsentNoticeOwnership(); disposed = true; generation++; globalThis.clearTimeout(expiryTimer); globalThis.document.removeEventListener('visibilitychange', revisit) })
</script>

<template>
  <main class="page-container ui-page checkout-view">
    <header class="page-heading order-details-heading">
      <div>
        <h1>Оформление заказа</h1>
        <p v-if="order">
          Заказ {{ order.orderNumber }}
        </p>
      </div>
      <div
        v-if="order"
        class="order-details-heading__actions"
      >
        <UiButton
          v-if="active && !problem"
          variant="primary"
          type="submit"
          form="checkout-edit-form"
          :loading="busy"
          :disabled="loading || busy || conflict || !complete"
        >
          Оплатить заказ
        </UiButton>
        <UiButton @click="router.push({ name:'order-details', params:{ orderNumber:order.orderNumber } })">
          Вернуться к заказу
        </UiButton>
      </div>
    </header>
    <UiAlert
      v-if="problem"
      :title="presentProblemTitle(problem)"
    >
      <p>{{ presentProblem(problem) }}</p><UiButton @click="conflict ? recoverConflict() : load()">
        Повторить
      </UiButton>
    </UiAlert>
    <p
      v-else-if="loading"
      role="status"
    >
      Загружаем заказ…
    </p>
    <UiAlert
      v-else-if="order && !active"
      tone="info"
    >
      Оформление доступно только для действующего расчёта.
    </UiAlert>
    <form
      v-else-if="active"
      id="checkout-edit-form"
      ref="focusRoot"
      class="ui-form-stack checkout-form"
      novalidate
      @submit.prevent="submit"
    >
      <UiAlert
        v-if="writePageProblem"
        :title="presentProblemTitle(writePageProblem)"
      >
        {{ presentProblem(writePageProblem) }}
        <UiButton
          v-if="conflict"
          :disabled="busy"
          @click="recoverConflict"
        >
          Обновить данные заказа
        </UiButton>
      </UiAlert>
      <UiAlert
        v-if="recovered"
        tone="info"
      >
        Заказ обновлён. Введённые данные сохранены в форме. Проверьте выбранную доставку и повторите действие.
      </UiAlert>
      <p v-if="order.estimatedDelivery">
        Ориентировочная доставка: {{ order.estimatedDelivery.minimumDays }}–{{ order.estimatedDelivery.maximumDays }} дней
      </p>
      <CustomerCostSummary
        :pricing="order.pricing"
        :ops="ops"
        :delivery-selected="Boolean(form.delivery)"
      />
      <OrderItemCard
        :order="order"
        :ops="ops"
        show-metadata
      />
      <div class="ui-form-panel">
        <section class="ui-form-section">
          <h2>Получатель</h2>
          <div class="ui-form-grid">
            <UiField
              v-for="(label, key) in recipientFields"
              :key="key"
              v-model="form[key]"
              :name="key"
              :label="label"
              :errors="fieldErrors(key)"
              :disabled="busy"
              :readonly="key === 'phone'"
              :required="['lastName', 'firstName', 'phone'].includes(key)"
              :type="key === 'phone' ? 'tel' : key === 'email' ? 'email' : 'text'"
            />
          </div>
        </section>
        <section class="ui-form-section">
          <div class="ui-form-section__heading">
            <h2>Паспортные данные</h2>
            <p>Нужны для таможенного оформления</p>
          </div>
          <PassportDataFields
            :passport="form"
            :disabled="busy"
            :errors-for="fieldErrors"
            @update:field="(name, value) => form[name] = value"
          />
        </section>
        <CheckoutDeliverySelector
          v-model="form.delivery"
          :options="ops.checkoutDeliveries"
          :address="address"
          :saved-courier="savedCourier"
          :disabled="busy"
          :errors="fieldErrors('delivery')"
          @refresh="refreshAddress"
        >
          <template v-if="form.delivery === 'courier'">
            <p>Адрес сохраняется в профиле вместе с оформлением заказа.</p>
            <DeliveryAddressFields
              :address="address"
              required
              :disabled="busy"
              :errors-for="fieldErrors"
              @update:field="editAddress"
            />
          </template>
        </CheckoutDeliverySelector>
        <section class="ui-form-section">
          <h2>Дополнительные услуги</h2><p
            v-for="example in examples"
            :key="example"
          >
            {{ example }} — В разработке
          </p>
        </section>
      </div>
    </form>
    <ConsentRenewalDialog :flow="renewal" />
  </main>
</template>
