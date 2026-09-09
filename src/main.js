// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { createApp } from 'vue'
import 'vuetify/styles'
import '@fontsource-variable/inter'

import App from './App.vue'
import { installErrorBoundaries } from './observability/boundaries.js'
import { EVENTS } from './observability/catalogue.js'
import { uiLogger } from './observability/logger.js'
import { createSarafanVuetify } from './plugins/vuetify.js'
import router from './router.js'
import './ui.css'
import './consent-ui.css'
import './styles.css'

const app = createApp(App)
installErrorBoundaries(app)
uiLogger.log(EVENTS.applicationStarted)
app.use(createSarafanVuetify()).use(router).mount('#app')
