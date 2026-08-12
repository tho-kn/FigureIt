import assert from 'node:assert/strict'
import test from 'node:test'
import { tectonicRelease } from './fetch-tectonic.mjs'
import { releaseAssetNames } from './collect-release.mjs'
import { releaseVersion } from './bundle.mjs'
import { pickLlhttpLibrary } from './tauri.mjs'

test('selects pinned platform tools without guessing unsupported targets', () => {
  assert.equal(tectonicRelease('linux', 'x64').target, 'x86_64-unknown-linux-gnu')
  assert.equal(tectonicRelease('win32', 'x64').extension, 'zip')
  assert.throws(() => tectonicRelease('android', 'arm64'))
  assert.equal(pickLlhttpLibrary(['libllhttp.9.3.dylib', 'libllhttp.9.4.1.dylib']), 'libllhttp.9.4.1.dylib')
})

test('validates release versions and gives every platform stable public asset names', () => {
  assert.equal(releaseVersion('1.2.3-beta.1'), '1.2.3-beta.1')
  assert.throws(() => releaseVersion('v1.2.3'))
  assert.deepEqual(releaseAssetNames('macos-arm64', '1.2.3'), ['FigureIt-1.2.3-macos-arm64.tar.gz'])
  assert.deepEqual(releaseAssetNames('linux-x64', '1.2.3'), ['FigureIt-1.2.3-linux-x64.deb', 'FigureIt-1.2.3-linux-x64.AppImage'])
  assert.deepEqual(releaseAssetNames('android-arm64', '1.2.3'), ['FigureIt-1.2.3-android-arm64-preview.apk'])
  assert.throws(() => releaseAssetNames('unknown', '1.2.3'))
})
