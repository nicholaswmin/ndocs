#!/usr/bin/env node
/*
ndocs - skim node API docs, expand as needed
*/

import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseArgs as args, styleText as style } from 'node:util'
import pkg from './package.json' with { type: 'json' }

process.title = pkg.name

const TIMEOUT = 10_000

const color = (name, text) => style(name, text)

const normalize = v => String(v ?? '').replace(/\s+/g, ' ').trim()
const log = {
  error: msg => console.error(`${color('red', 'x')} ${normalize(msg)}`),
  spin: () => console.warn(color('dim', '...'))
}

const fail = (err, code = 1) =>
  (log.error(err?.message ?? err), process.exit(code))

const { values, positionals } = args({
  args: process.argv.slice(2),
  options: {
    nodev: { type: 'string',  short: 'n', default: 'latest' },
    full : { type: 'boolean', short: 'f', default: false    },
    stats: { type: 'boolean', short: 's', default: false    },
    help:  { type: 'boolean', short: 'h', default: false    }
  },
  allowPositionals: true
})

const usage = () =>
`
${color('cyan', 'Node.js Documentation')}\n` +
color('dim', `
LLM-friendly doc viewer; fetch only what you want.

USAGE
  ndocs <module[.method]> [...]

EXAMPLES
  ndocs list
  ndocs completion
  ndocs assert
  ndocs assert.strictEqual
  ndocs assert.ok assert.fail
  ndocs assert --full
  ndocs assert -n 22
  ndocs assert --stats

OPTIONS
  --nodev/-n    node version (default: latest)
  --full/-f     return all fields
  --stats/-s    show size stats
  --help/-h     show this help

ENV
  NO_COLOR
`.trim())

const base = values.nodev === 'latest'
  ? 'https://nodejs.org/api'
  : `https://nodejs.org/docs/latest-v${values.nodev}.x/api`

const SAFE_MOD = /^[a-z0-9._-]+$/i
const sanitizeModule = m =>
  SAFE_MOD.test(m) ? m : (() => { throw new Error(`invalid module: ${m}`) })()

const url = m => `${base}/${sanitizeModule(m)}.json`

const parse = spec => {
  const [mod, ...rest] = String(spec).split('.')
  return [mod, rest.length ? rest.join('.') : undefined]
}

const fetch = async (u, timeout = TIMEOUT) => {
  const signal = AbortSignal.timeout(timeout)
  const res = await globalThis.fetch(u, { signal })
  if (!res.ok) throw new Error(`failed: ${res.status}`)
  return res
}

const stripHtml = s =>
  s?.replace(/<pre><code[^>]*>/g, '\n```\n')
    .replace(/<\/code><\/pre>/g, '\n```\n')
    .replace(/<p>/g, '\n')
    .replace(/<\/p>/g, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  ?? ''
const uniqSort = xs => [...new Set(xs)].sort()

const extract = (d, full = false) => {
  if (full) return d

  const m = d.modules?.[0] ?? {}
  return {
    name: m.name,
    stability: m.stability,
    stabilityText: m.stabilityText,
    desc: stripHtml(m.desc).slice(0, 500)
  }
}

const list = async () => {
  log.spin()

  const fromJson = () =>
    fetch(`${base}/all.json`)
      .then(r => r.json())
      .then(j => j.modules ?? [])
      .then(ms => ms.map(m => m.name).filter(Boolean))
      .then(uniqSort)

  const fromHtml = () =>
    fetch(`${base}/`)
      .then(r => r.text())
      .then(h => [...h.matchAll(/href="([^"]+)\.html"/g)]
        .map(m => m[1])
        .filter(n => !n.includes('/') && n !== 'index' && n !== 'all'))
      .then(uniqSort)

  return fromJson().catch(fromHtml)
}

const find = (data, name) => {
  if (!name) return null
  const keys = ['methods', 'classes', 'events', 'properties', 'modules']
  const last = name.split('.').pop()

  const match = o =>
    o?.name === name || o?.name === last ||
    o?.textRaw?.includes(name) || o?.textRaw?.includes(last)

  const kids = o => keys.flatMap(k => Array.isArray(o?.[k]) ? o[k] : [])

  const loop = nodes =>
    nodes.length
      ? (match(nodes[0]) ? nodes[0] : loop([...kids(nodes[0]), ...nodes.slice(1)]))
      : null

  return loop([data])
}

const getDoc = (mod, method, full = false) =>
  fetch(url(mod))
    .then(r => r.json())
    .then(d => method
      ? (() => {
          const hit = find(d, method)
          if (!hit) throw new Error(`not found: ${method} in ${mod}`)
          return hit
        })()
      : extract(d, full))

const load = specs =>
  (log.spin(), Promise.all(specs.map(s => {
    const [mod, method] = parse(s)
    return getDoc(mod, method, values.full)
  }))
  .then(xs => console.log(JSON.stringify(xs, null, 2))))

const showStats = specs =>
  Promise.all(specs.map(async s => {
    const [mod] = parse(s)
    log.spin()
    const data = await fetch(url(mod)).then(r => r.json())
    const full = Buffer.byteLength(JSON.stringify(extract(data, true)))
    const summary = Buffer.byteLength(JSON.stringify(extract(data, false)))
    const saved = `${((1 - summary / full) * 100).toFixed(2)}%`
    return { module: mod, full, summary, saved }
  }))
  .then(rows => console.table(rows))

const completion = modules => `
#compdef ndocs

_ndocs() {
  local -a modules
  modules=(${modules.map(m => `'${m}'`).join(' ')})

  _arguments \\
    '(-f --full)'{-f,--full}'[return all fields]' \\
    '(-n --nodev)'{-n,--nodev}'[node version]:version:' \\
    '(-s --stats)'{-s,--stats}'[show size stats]' \\
    '(-h --help)'{-h,--help}'[show help]' \\
    '*:module:->modules'

  case $state in
    modules)
      _values 'modules' $modules
      ;;
  esac
}

_ndocs
`.trim()

export { extract, find, parse, getDoc }
export const internals = { url, fetch, sanitizeModule }

const isCLI = (() => {
  try {
    const argv1 = process.argv[1] || ''
    return realpathSync(argv1) ===
      realpathSync(fileURLToPath(import.meta.url))
  } catch (_) {
    return false
  }
})()

if (isCLI) {
  if (values.nodev !== 'latest' && !/^\d+$/.test(values.nodev))
    fail(`invalid node version: ${values.nodev}`)

  if (values.help || !positionals.length) {
    console.warn(usage())
    process.exit(values.help ? 0 : 1)
  }

  if (positionals[0] === 'list')
    list().then(xs => console.log(xs.join('\n'))).catch(fail)
  else if (positionals[0] === 'completion')
    list().then(xs => console.log(completion(xs))).catch(fail)
  else if (values.stats)
    showStats(positionals).catch(fail)
  else
    load(positionals).catch(fail)
}
