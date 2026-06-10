// A tiny dictionary keyed by route. Group 1 (dictionary-driven mirror) slots
// look up per-route content here. In a real app this is often the same object
// you derive `paths` from (`Object.keys(PATH_LABELS) as Path[]`).
export const PATH_LABELS: Record<string, string> = {
  '/account/': 'Account',
  '/account/info/': 'Account · Info',
  '/docs/getting-started/': 'Docs · Getting Started',
  '/docs/api/': 'Docs · API Reference',
}
