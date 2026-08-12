import assert from 'node:assert/strict'
import test from 'node:test'

import { scanText } from './check-privacy.mjs'

test('accepts sanitized public source', () => {
  assert.deepEqual(scanText('src/example.ts', 'const title = "FigureIt"\n'), [])
})

test('detects absolute home paths without returning the secret text', () => {
  const localPath = ['/', 'Users', '/', 'private-person', '/figure.tikz'].join('')
  const findings = scanText('dist/app.js', `open(${JSON.stringify(localPath)})`)

  assert.equal(findings.length, 1)
  assert.equal(findings[0].rule, 'absolute-home-path')
  assert.equal(JSON.stringify(findings).includes('private-person'), false)
})

test('detects credentials without returning their value', () => {
  const secret = ['sk', '-ant-', 'synthetic-secret-value'].join('')
  const findings = scanText('src/config.ts', `const token = '${secret}'`)

  assert.equal(findings.length, 1)
  assert.equal(findings[0].rule, 'credential')
  assert.equal(JSON.stringify(findings).includes(secret), false)
})
