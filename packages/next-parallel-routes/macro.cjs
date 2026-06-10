'use strict'

// Runtime-safe entry. Contains ONLY the `staticParamsFromConfig` marker
// helper (and the shared Symbol). No `fs`, `path`, `process.env`, or
// `Module._compile` — so importing this from a user `page.tsx` doesn't drag
// the build-time-only `index.cjs` into Turbopack's server-component bundle.
//
// The marker is identified across module boundaries via `Symbol.for(...)`,
// so `preload.cjs` does not need to share this file's instance.

const MARKER_SYMBOL = Symbol.for('next-parallel-routes.static-params-from-config')

function staticParamsFromConfig() {
  const marker = function staticParamsFromConfigMarker() {
    throw new Error(
      '[next-parallel-routes] staticParamsFromConfig() marker was called directly. ' +
        'Did the preload patch fail to load? Check NODE_OPTIONS=--require=...preload.cjs',
    )
  }
  marker[MARKER_SYMBOL] = true
  return marker
}

module.exports = { staticParamsFromConfig, MARKER_SYMBOL }
module.exports.staticParamsFromConfig = staticParamsFromConfig
