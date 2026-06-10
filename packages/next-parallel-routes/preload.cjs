'use strict'

// Build-time runtime patch for next.js. Loaded via `NODE_OPTIONS="--require=..."`
// so it runs in the next build main process AND every child worker (jest-worker
// processChild). Configuration is passed via env vars (so it survives the
// process boundary):
//
//   NEXT_PARALLEL_ROUTES_PATHS_JSON       JSON { paths, trailingSlash }. Used
//                                         to replace `staticParamsFromConfig()`
//                                         marker functions with real GSPs at
//                                         runtime. Set automatically by
//                                         `withParallelRoutes(...)`.
//   NEXT_PARALLEL_GSP_DEDUPE_VERBOSE      '0' to silence the patch log line.
//   NEXT_PARALLEL_GSP_DEDUPE_KEEP_SLOTS   (diagnostic only) JSON array of slot
//                                         names whose generateStaticParams
//                                         should be preferred as the keeper
//                                         when dedup'ing within a mirror group.
//                                         Useful for reproducing/comparing
//                                         dedupe behaviour; not exposed via
//                                         the `withParallelRoutes` options
//                                         object.
//
// The `withParallelRoutes(nextConfig, options)` wrapper in ./index.cjs is the
// recommended entry point — it sets these env vars and adds `--require=…` to
// NODE_OPTIONS automatically.

const Module = require('module')
const path = require('path')

const VERBOSE = process.env.NEXT_PARALLEL_GSP_DEDUPE_VERBOSE !== '0'
const KEEP_SLOTS = (() => {
  try {
    const raw = process.env.NEXT_PARALLEL_GSP_DEDUPE_KEEP_SLOTS
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch (_err) {
    return []
  }
})()

const PATHS_CONFIG = (() => {
  try {
    const raw = process.env.NEXT_PARALLEL_ROUTES_PATHS_JSON
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed.paths)) return null
    return parsed  // { paths: string[], trailingSlash: boolean }
  } catch (_err) {
    return null
  }
})()

// Precompute the GSP return value once — every marker function across all
// slots returns the exact same `[{ slug: [...] }, ...]` array.
const MARKER_RESULT = PATHS_CONFIG
  ? PATHS_CONFIG.paths
      .filter(function (p) { return typeof p === 'string' && p !== '/' })
      .map(function (p) {
        return { slug: p.split('/').filter(Boolean) }
      })
  : null

const log = (...args) => {
  if (VERBOSE) console.log('[next-parallel-routes]', ...args)
}
const warn = (...args) => {
  console.warn('[next-parallel-routes]', ...args)
}

const PATCH_GUARD = '__nbpDedupeParallelSegments'

// Note: `__nbpKeepSlots` and `__nbpMarkerResult` are inlined as JSON literals
// so the patched code does not need to re-read process.env. Both are captured
// at preload time — which is fine because env vars don't change for the
// lifetime of a build.
const DEDUPE_PREAMBLE = `
const __nbpKeepSlots = ${JSON.stringify(KEEP_SLOTS)};
const __nbpMarkerResult = ${JSON.stringify(MARKER_RESULT)};
const __nbpMarkerSymbol = Symbol.for('next-parallel-routes.static-params-from-config');

function __nbpExtractSlotName(filePath) {
  if (typeof filePath !== 'string') return null;
  const m = filePath.match(/[\\/\\\\](@[A-Za-z0-9][^\\/\\\\@]*)[\\/\\\\]/);
  return m ? m[1] : null;
}

// "mirror key" = the path under the first \`/@slot/\` segment. Segments
// sharing the same mirror key are pure parallel-slot mirrors of the same
// route (e.g. \`@title/[...slug]/page.tsx\` and \`@breadcrumbs/[...slug]/page.tsx\`
// both have key \`[...slug]/page.tsx\`). They get dedup'd. Segments with
// different mirror keys (e.g. nested-leaf catch-all \`@sidebar/docs/[...slug]/page.tsx\`
// has key \`docs/[...slug]/page.tsx\`) belong to separate groups and
// their GSPs are independent — never strip them.
function __nbpExtractMirrorKey(filePath) {
  if (typeof filePath !== 'string') return null;
  const m = filePath.match(/[\\/\\\\]@[A-Za-z0-9][^\\/\\\\@]*[\\/\\\\](.+)$/);
  return m ? m[1].replace(/\\\\/g, '/') : null;
}

// Extract the URL prefix that segments contribute (excluding the trailing
// catch-all dynamic segment). e.g. \`/docs/[...slug]\` route's segments
// contribute prefix ["docs"]; \`/[...slug]\` contributes [].
function __nbpExtractRoutePrefix(segments) {
  const prefix = [];
  if (!Array.isArray(segments)) return prefix;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (!s || typeof s.name !== 'string') continue;
    const n = s.name;
    if (n === '') continue;
    if (n.charCodeAt(0) === 40 /* ( */) continue;       // route group "(xxx)"
    if (n.charCodeAt(0) === 64 /* @ */) continue;       // slot "@xxx"
    if (n.charCodeAt(0) === 91 /* [ */) continue;       // dynamic "[xxx]" or "[...xxx]"
    if (n.indexOf('__') === 0) continue;                // __DEFAULT__ / __PAGE__
    prefix.push(n);
  }
  return prefix;
}

// Filter MARKER_RESULT paths so only those matching the route prefix survive,
// stripping the prefix from each slug. Paths that exactly equal the prefix
// (i.e. remaining slug is empty) are dropped — they correspond to the spec
// \`/<prefix>/page.tsx\`, not the catch-all.
function __nbpFilterPathsForRoute(paths, prefix) {
  if (!Array.isArray(paths) || paths.length === 0) return paths;
  if (prefix.length === 0) return paths;
  const filtered = [];
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i];
    if (!p || !Array.isArray(p.slug) || p.slug.length <= prefix.length) continue;
    let match = true;
    for (let j = 0; j < prefix.length; j++) {
      if (p.slug[j] !== prefix[j]) { match = false; break; }
    }
    if (!match) continue;
    filtered.push({ slug: p.slug.slice(prefix.length) });
  }
  return filtered;
}

// Step 1: replace every marker GSP with a real function returning the
// route-appropriate paths array. The replacement is route-aware: for nested
// catch-alls like \`/docs/[...slug]\` the paths array is filtered to
// only entries under that prefix. This must run BEFORE dedupe so segments
// using the marker look identical from dedupe's perspective.
function __nbpResolveMarkerSegments(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return segments;
  if (!__nbpMarkerResult) return segments;
  const prefix = __nbpExtractRoutePrefix(segments);
  const filtered = __nbpFilterPathsForRoute(__nbpMarkerResult, prefix);
  let out = null;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const gsp = s && s.generateStaticParams;
    if (typeof gsp !== 'function' || !gsp[__nbpMarkerSymbol]) continue;
    if (!out) out = segments.slice();
    out[i] = Object.assign({}, s, {
      generateStaticParams: function () { return filtered; },
    });
  }
  return out || segments;
}

function __nbpDedupeParallelSegments(segments) {
  segments = __nbpResolveMarkerSegments(segments);
  if (!Array.isArray(segments) || segments.length === 0) return segments;

  // Group GSP segments by mirror key. Non-parallel ("primary") GSPs have no
  // /@slot/ marker → they bypass grouping and always win against parallel
  // mirrors of the same mirror key.
  const groups = Object.create(null);  // mirrorKey → [{ idx, slot }, ...]
  let primaryGspIdx = -1;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (!s || typeof s.generateStaticParams !== 'function') continue;
    const slot = __nbpExtractSlotName(s.filePath);
    if (!slot) {
      if (primaryGspIdx === -1) primaryGspIdx = i;
      continue;
    }
    const key = __nbpExtractMirrorKey(s.filePath);
    if (!key) continue;
    if (!groups[key]) groups[key] = [];
    groups[key].push({ idx: i, slot: slot });
  }

  const stripIdxs = new Set();
  const groupKeys = Object.keys(groups);
  for (let g = 0; g < groupKeys.length; g++) {
    const entries = groups[groupKeys[g]];
    if (entries.length <= 1) continue;
    // Within a group, pick keeper. Primary GSP wins; otherwise honour user
    // config; otherwise heuristic: first parallel slot encountered.
    let keep;
    if (primaryGspIdx !== -1) {
      keep = primaryGspIdx;  // primary outside group still wins this group
    } else if (__nbpKeepSlots.length > 0) {
      const fromConfig = entries.filter(function (p) { return __nbpKeepSlots.indexOf(p.slot) !== -1; });
      keep = fromConfig.length > 0 ? fromConfig[0].idx : entries[0].idx;
    } else {
      keep = entries[0].idx;
    }
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].idx !== keep) stripIdxs.add(entries[i].idx);
    }
  }

  if (stripIdxs.size === 0) return segments;

  const out = new Array(segments.length);
  for (let i = 0; i < segments.length; i++) {
    if (!stripIdxs.has(i)) { out[i] = segments[i]; continue; }
    const stripped = {};
    const keys = Object.keys(segments[i]);
    for (let k = 0; k < keys.length; k++) {
      const key = keys[k];
      if (key !== 'generateStaticParams') stripped[key] = segments[i][key];
    }
    out[i] = stripped;
  }
  return out;
}
`

const TARGET_REL = path.join('next', 'dist', 'build', 'static-paths', 'app.js')
const TARGET_REL_POSIX = TARGET_REL.split(path.sep).join('/')

const NEEDLE =
  'async function generateRouteStaticParams(segments, store, isRoutePPREnabled) {'
const REPLACEMENT =
  NEEDLE + '\n    segments = __nbpDedupeParallelSegments(segments);'

let patchLogged = false
let nextVersionLogged = false

const origCompile = Module.prototype._compile
Module.prototype._compile = function patchedCompile(content, filename) {
  if (
    typeof filename === 'string' &&
    (filename.endsWith(TARGET_REL) || filename.endsWith(TARGET_REL_POSIX))
  ) {
    if (!nextVersionLogged) {
      nextVersionLogged = true
      try {
        const nextPkgPath = filename.replace(
          /[\/\\]dist[\/\\]build[\/\\]static-paths[\/\\]app\.js$/,
          path.sep + 'package.json'
        )
        const nextVersion = require(nextPkgPath).version
        log(
          'next version detected:',
          nextVersion,
          '(verified against 16.1.0; re-verify NEEDLE on upgrade)'
        )
      } catch (_err) {
        // Ignore — version detection is best-effort.
      }
    }

    if (content.includes(PATCH_GUARD)) {
      // Already patched (defensive — shouldn't normally happen).
    } else if (!content.includes(NEEDLE)) {
      warn(
        'could not locate generateRouteStaticParams in',
        filename,
        '— next internal layout changed; patch skipped.'
      )
    } else {
      content = DEDUPE_PREAMBLE + '\n' + content.replace(NEEDLE, REPLACEMENT)
      if (!patchLogged) {
        patchLogged = true
        const detail =
          KEEP_SLOTS.length > 0
            ? ' (keepSlots override: ' + KEEP_SLOTS.join(', ') + ')'
            : ''
        log(
          'patched generateRouteStaticParams: marker resolution + route-aware filter + dedupe by mirror key' +
            detail
        )
      }
    }
  }
  return origCompile.call(this, content, filename)
}
