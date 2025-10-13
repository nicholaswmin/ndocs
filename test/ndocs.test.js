import { test } from 'node:test'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ndocsPath = resolve(__dirname, '..', 'ndocs.js')

await test('#parseSpec', async t => {
  t.beforeEach(async t => {
    const mod = await import(ndocsPath)
    t.parseSpec = mod.parseSpec
  })

  await t.test('module only', t => {
    t.assert.deepStrictEqual(t.parseSpec('fs'), ['fs'])
  })

  await t.test('module + method', t => {
    t.assert.deepStrictEqual(t.parseSpec('fs.readFile'), ['fs', 'readFile'])
  })
})

await test('#extract', async t => {
  t.beforeEach(async t => {
    const mod = await import(ndocsPath)
    t.extract = mod.extract
    t.data = {
      modules: [{
        name: 'assert',
        stability: 1,
        stabilityText: 'Stability: 1',
        desc: '<p>Hello <b>world</b> & more</p>'
      }]
    }
  })

  await t.test('summary fields only', t => {
    const res = t.extract(t.data)
    t.assert.strictEqual(res.name, 'assert')
    t.assert.strictEqual(res.stability, 1)
    t.assert.match(res.stabilityText, /Stability/)
    t.assert.strictEqual(res.desc, 'Hello world & more')
    t.assert.ok(res.desc.length <= 500)
  })

  await t.test('full passthrough', t => {
    const res = t.extract(t.data, true)
    t.assert.strictEqual(res, t.data)
  })
})

await test('#findMethod', async t => {
  t.beforeEach(async t => {
    const mod = await import(ndocsPath)
    t.findMethod = mod.findMethod
    t.doc = {
      modules: [{
        name: 'assert',
        methods: [
          { name: 'ok', textRaw: 'assert.ok()' },
          { name: 'strictEqual', textRaw: 'assert.strictEqual()' }
        ]
      }]
    }
  })

  await t.test('finds nested method', t => {
    const found = t.findMethod(t.doc, 'strictEqual')
    t.assert.strictEqual(found?.name, 'strictEqual')
  })

  await t.test('returns null when missing', t => {
    const found = t.findMethod(t.doc, 'doesNotExist')
    t.assert.strictEqual(found, null)
  })
})

await test('__internals', async t => {
  t.beforeEach(async t => {
    const mod = await import(ndocsPath)
    t.internals = mod.__internals
    t.originalFetch = globalThis.fetch
  })

  t.afterEach(t => {
    globalThis.fetch = t.originalFetch
  })

  await t.test('url uses latest by default', t => {
    const u = t.internals.url('assert')
    t.assert.strictEqual(u, 'https://nodejs.org/api/assert.json')
  })

  await t.test('fetchWithTimeout passes AbortSignal', async t => {
    const fn = t.mock.fn(() => Promise.resolve({ ok: true }))
    globalThis.fetch = fn

    const p = t.internals.fetchWithTimeout('https://example.com', 5)
    t.assert.ok(p && typeof p.then === 'function')
    await p
    t.assert.strictEqual(fn.mock.calls.length, 1)
    const [, options] = fn.mock.calls[0].arguments
    t.assert.ok(options && options.signal && typeof options.signal.aborted === 'boolean')
  })
})

await test('CLI completion generates zsh script', async t => {
  const { code, stdout } = await new Promise(resolve => {
    const p = spawn(process.execPath, [ndocsPath, 'completion'], {
      env: { ...process.env, NO_COLOR: '1' }
    })
    let stdout = ''
    p.stdout.on('data', d => (stdout += d.toString()))
    p.on('close', code => resolve({ code, stdout }))
  })

  t.assert.strictEqual(code, 0)
  const out = stdout.toLowerCase()
  t.assert.ok(out.includes('compdef'), 'missing compdef')
  t.assert.ok(out.includes('_ndocs'), 'missing _ndocs function')
  t.assert.ok(out.includes('--full'), 'missing flags')
})

await test('CLI --help prints usage and exits 0', async t => {
  const { code, stderr } = await new Promise(resolve => {
    const p = spawn(process.execPath, [ndocsPath, '--help'], {
      env: { ...process.env, NO_COLOR: '1' }
    })
    let stderr = ''
    p.stderr.on('data', d => (stderr += d.toString()))
    p.on('close', code => resolve({ code, stderr }))
  })

  t.assert.strictEqual(code, 0)
  t.assert.match(stderr, /USAGE: ndocs/i)
})

await test('CLI --help honors NO_COLOR (no ANSI)', async t => {
  const { code, stderr } = await new Promise(resolve => {
    const p = spawn(process.execPath, [ndocsPath, '--help'], {
      env: { ...process.env, NO_COLOR: '1' }
    })
    let stderr = ''
    p.stderr.on('data', d => (stderr += d.toString()))
    p.on('close', code => resolve({ code, stderr }))
  })

  t.assert.strictEqual(code, 0)
  t.assert.ok(!/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/.test(stderr), 'should not include ANSI escapes')
})

await test('CLI invalid version prints uniform error', async t => {
  const { code, stderr } = await new Promise(resolve => {
    const p = spawn(process.execPath, [ndocsPath, 'assert', '-n', 'banana'], {
      env: { ...process.env, NO_COLOR: '1' }
    })
    let stderr = ''
    p.stderr.on('data', d => (stderr += d.toString()))
    p.on('close', code => resolve({ code, stderr }))
  })

  t.assert.strictEqual(code, 1)
  t.assert.match(stderr, /\[ndocs\] Invalid Node version: banana/)
})

await test('CLI list returns module names', async t => {
  const { code, stdout } = await new Promise(resolve => {
    const p = spawn(process.execPath, [ndocsPath, 'list'], {
      env: { ...process.env, NO_COLOR: '1' }
    })
    let stdout = ''
    p.stdout.on('data', d => (stdout += d.toString()))
    p.on('close', code => resolve({ code, stdout }))
  })

  t.assert.strictEqual(code, 0)
  const lines = stdout.trim().split('\n')
  t.assert.ok(lines.length > 50, 'should list many modules')
  t.assert.ok(lines.includes('assert'), 'should include assert')
  t.assert.ok(lines.includes('fs'), 'should include fs')
  t.assert.ok(lines.includes('path'), 'should include path')
})

await test('#fetchDoc', async t => {
  t.beforeEach(async t => {
    const mod = await import(ndocsPath)
    t.fetchDoc = mod.fetchDoc
    t.originalFetch = globalThis.fetch
  })

  t.afterEach(t => {
    globalThis.fetch = t.originalFetch
  })

  await t.test('fetches module docs', async t => {
    globalThis.fetch = t.mock.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        modules: [{
          name: 'assert',
          stability: 2,
          stabilityText: 'Stable',
          desc: 'The assert module'
        }]
      })
    }))

    const result = await t.fetchDoc('assert', null, false)
    t.assert.strictEqual(result.name, 'assert')
    t.assert.strictEqual(result.stability, 2)
  })

  await t.test('throws on 404', async t => {
    globalThis.fetch = t.mock.fn(() => Promise.resolve({
      ok: false,
      status: 404
    }))

    await t.assert.rejects(
      () => t.fetchDoc('nonexistent', null, false),
      { message: /Failed: 404/ }
    )
  })

  await t.test('throws when method not found', async t => {
    globalThis.fetch = t.mock.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        modules: [{
          name: 'assert',
          methods: []
        }]
      })
    }))

    await t.assert.rejects(
      () => t.fetchDoc('assert', 'nonexistent', false),
      { message: /Method 'nonexistent' not found/ }
    )
  })
})
