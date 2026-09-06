// Copyright (C) 2026 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of the Sarafan application

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'

import { describe, expect, it } from 'vitest'

async function source(path) {
  return readFile(resolve(process.cwd(), path), 'utf8')
}

describe('runtime logging deployment contract', () => {
  it('loads runtime configuration before the immutable application bundle', async () => {
    const html = await source('index.html')
    expect(html.indexOf('/runtime-config.js')).toBeGreaterThan(0)
    expect(html.indexOf('/runtime-config.js')).toBeLessThan(html.indexOf('/src/main.js'))
  })

  it('uses the Gzhel artwork for browser and installed application icons', async () => {
    const html = await source('index.html')
    expect(html).toContain(
      '<link rel="icon" type="image/png" href="/sarafan-gzhel-icon.png">'
    )
    expect(html).toContain('<link rel="apple-touch-icon" href="/sarafan-gzhel-icon.png">')
  })

  it('generates an exact fail-closed boolean when the container starts', async () => {
    const [dockerfile, entrypoint] = await Promise.all([
      source('Dockerfile'),
      source('docker-entrypoint.d/40-sarafan-runtime-config.sh')
    ])
    expect(dockerfile).toContain('COPY --chmod=755 docker-entrypoint.d/40-sarafan-runtime-config.sh')
    expect(entrypoint).not.toContain('\r')
    expect(entrypoint).toContain('${SARAFAN_UI_LOGGING_ENABLED:-}')
    expect(entrypoint).toContain('true|false)')
    expect(entrypoint).toContain('sarafan_logging_enabled="false"')
  })

  it('serves only the runtime asset without caching', async () => {
    const nginx = await source('config/nginx.conf')
    expect(nginx).toMatch(/location = \/runtime-config\.js[\s\S]*Cache-Control "no-store"/u)
  })
})
