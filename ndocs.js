#!/usr/bin/env node

/*
ndocs - skim node API docs, expand as needed

DEV:
  npm link      # link globally in dev
  npm unlink    # unlink globally
*/

import { parseArgs, styleText as style } from 'node:util'
import { fileURLToPath } from 'node:url'
import pkg from './package.json' with { type: 'json' }

process.title = pkg.name

// Honor NO_COLOR per https://no-color.org
const COLORS_ENABLED = !('NO_COLOR' in process.env)
const color = (name, text) => COLORS_ENABLED ? style(name, text) : String(text)

// Uniform logging and errors
const PREFIX = `[${pkg.name}]`
const normalize = v => String(v ?? '').replace(/\s+/g, ' ').trim()
const logInfo = msg => console.warn(color('cyan', asLoading(normalize(msg))))
const logError = msg => console.error(color('red', `${PREFIX} ${normalize(msg)}`))
const fail = (err, code = 1) => {
  const msg = err && err.message ? err.message : err
  logError(msg)
  process.exit(code)
}

const { values, positionals } = parseArgs({
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
${color('cyan', 'ndocs - skim node docs, expand as needed')}\n\n` +
   color('dim', `
USAGE: ndocs <module[.method]> [...]

EXAMPLES:
  ndocs list                        # list all available modules
  ndocs completion                  # generate zsh completion script
  ndocs assert                      # concise "assert" module docs
  ndocs assert.strictEqual          # specific method only
  ndocs assert.ok assert.fail       # multiple methods
  ndocs assert --full               # full docs of same module
  ndocs assert -n 22                # docs for Node v22
  ndocs assert --stats              # size comparison

OPTIONS:
  --nodev/-n    # node version (default: latest)
  --full/-f     # return all fields
  --stats/-s    # show size stats
  --help/-h     # show this help

ENV:
  NO_COLOR      # No ANSI output

.`.trim())

const base = values.nodev === 'latest'
  ? 'https://nodejs.org/api'
  : `https://nodejs.org/docs/latest-v${values.nodev}.x/api`

const url = module => `${base}/${module}.json`

const asLoading = text => `${String(text).replace(/\s+/g, ' ').trim()}...`
const spinner = (text = 'loading') => logInfo(text)

const parseSpec = spec => spec.includes('.') ? spec.split('.') : [spec]

const fetchWithTimeout = (url, timeout = 10000) => {
  const ctrl = new AbortController()
  const id = setTimeout(() => ctrl.abort(), timeout)

  return globalThis.fetch(url, { signal: ctrl.signal })
    .finally(() => clearTimeout(id))
}

const extract = (data, full = false) => {
  if (full) return data

  const module = data.modules?.[0] || {}
  return {
    name: module.name,
    stability: module.stability,
    stabilityText: module.stabilityText,
    desc: module.desc?.replace(/<[^>]*>/g, '').slice(0, 500)
  }
}

const list = async () => {
  const ver = values.nodev === 'latest' ? '' : ` v${values.nodev}`
  spinner(`fetching modules:${ver}`)

  // Prefer JSON index (all.json) for stability; fallback to HTML scrape
  const baseApi = values.nodev === 'latest'
    ? 'https://nodejs.org/api'
    : `https://nodejs.org/docs/latest-v${values.nodev}.x/api`

  // Try JSON first
  try {
    const resJson = await fetchWithTimeout(`${baseApi}/all.json`)
    if (resJson.ok) {
      const json = await resJson.json()
      const names = (json.modules || []).map(m => m.name).filter(Boolean)
      if (names.length) return [...new Set(names)].sort()
    }
  } catch (_) {
    // ignore and fallback to HTML
  }

  // HTML fallback
  const res = await fetchWithTimeout(`${baseApi}/`)
  if (!res.ok) throw new Error(`Failed: ${res.status}`)

  const html = await res.text()
  const matches = html.matchAll(/href="([^"]+)\.html"/g)

  return [...new Set([...matches].map(m => m[1]).filter(name =>
    !name.includes('/') && name !== 'index' && name !== 'all'
  ))].sort()
}

const findMethod = (data, methodName) => {
  const search = obj => {
    if (obj.name === methodName || obj.textRaw?.includes(methodName))
      return obj

    const methodMatch = obj.methods?.find(m =>
      m.name === methodName || m.textRaw?.includes(methodName)
    )
    if (methodMatch) return methodMatch

    return obj.modules?.reduce(
      (found, mod) => found || search(mod), null
    ) || null
  }

  return search(data)
}

const fetch = async (mod, method, full = false) => {
  const link = url(mod)
  spinner(`fetching: ${link}`)

  const res = await fetchWithTimeout(link)
  if (!res.ok) throw new Error(`Failed: ${res.status}`)

  const data = await res.json()

  if (method) {
    const found = findMethod(data, method)
    if (!found) throw new Error(`Method '${method}' not found in '${mod}'`)

    return found
  }

  return extract(data, full)
}

const fetchModules = specs =>
  Promise.all(specs.map(spec => {
    const [mod, method] = parseSpec(spec)
    return fetch(mod, method, values.full)
  }))
    .then(results => console.log(JSON.stringify(results, null, 2)))

const showStats = async specs => {
  const results = await Promise.all(specs.map(async spec => {
    const [mod] = parseSpec(spec)
    const link = url(mod)
    spinner(`fetching: ${link}`)

    const res = await fetchWithTimeout(link)
    if (!res.ok) throw new Error(`Failed: ${res.status}`)

    const data = await res.json()

    const fullDoc = extract(data, true)
    const summaryDoc = extract(data, false)

    const full = JSON.stringify(fullDoc).length
    const summary = JSON.stringify(summaryDoc).length
    const saved = `${((1 - summary / full) * 100).toFixed(2)}%`

    return { module: mod, full, summary, saved }
  }))

  console.table(results)
}

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

// Export internals for tests
export { parseSpec, extract, findMethod }
export const __internals = { url, fetchWithTimeout, asLoading }
// Export the networked fetch helper for tests, with a safe alias
export { fetch as fetchDoc }

// Run CLI only when executed directly
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  if (values.nodev !== 'latest' && !/^\d+$/.test(values.nodev)) {
    fail(`Invalid Node version: ${values.nodev}`)
  }

  if (values.help || !positionals.length) {
    console.warn(usage())
    process.exit(values.help ? 0 : 1)
  }

  if (positionals[0] === 'list') {
    list()
      .then(modules => console.log(modules.join('\n')))
      .catch(fail)
  } else if (positionals[0] === 'completion') {
    list()
      .then(modules => console.log(completion(modules)))
      .catch(fail)
  } else if (values.stats) {
    showStats(positionals)
      .catch(fail)
  } else {
    fetchModules(positionals)
      .catch(fail)
  }
}
