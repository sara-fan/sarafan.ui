<script setup>
// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { useRoute, useRouter } from 'vue-router'

import ConsentCenter from '../components/ConsentCenter.vue'
import { useProductDraft } from '../stores/productDraft.js'
import { useSession } from '../stores/session.js'

defineProps({
  section: {
    type: String,
    default: 'auto',
    validator: value => ['auto', 'personal'].includes(value)
  }
})

const route = useRoute()
const router = useRouter()
const session = useSession()
const productDraft = useProductDraft()

async function personalConsentGranted() {
  const draft = productDraft.draft.value
  if (route.query.returnTo !== 'product-submit' || draft?.resumeMode !== 'consent'
    || draft.boundCustomerId !== session.customer.value?.id) return
  await router.replace({ name:'product' })
}
</script>

<template>
  <ConsentCenter
    :key="section"
    mode="consents"
    :section="section"
    @personal-consent-granted="personalConsentGranted"
  />
</template>
