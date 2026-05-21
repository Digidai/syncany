// Component primitives. Migrated incrementally from apps/web/src/components/ui/
// — keep this re-export list in sync as components move. Until then, hosts
// continue importing from their local copies.
//
// Migration playbook (per component):
//   1. Copy file to packages/ui/src/components/<name>.tsx
//   2. Remove any next/electron imports; replace with usePlatform() calls
//   3. Add re-export below
//   4. Replace apps/web import sites
//   5. Delete apps/web copy
//
// Don't bulk-move everything at once — each component has its own host-
// dependency footprint to audit.

// (intentionally empty for now — D2 will populate this.)
export {};
