// This `default.tsx` has NO top-level imports, so the plugin generates an
// **inline shim** for `@breadcrumbs/[...slug]/page.tsx` with a `return null`
// body (it does not re-export this file — see the package docs for the
// isolatedModules edge case this avoids).
export default function BreadcrumbsDefault() {
  return null
}
