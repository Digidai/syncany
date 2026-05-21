# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability in Raltic, **please do not open a public GitHub issue.** Instead, report it privately so it can be triaged and patched before details become public.

**Preferred channel:** [GitHub private vulnerability reporting](https://github.com/Digidai/raltic/security/advisories/new)

**Or by email:** `zaynhaodev@gmail.com` — please include `[raltic security]` in the subject so it doesn't get lost.

When reporting, please include:

- A clear description of the vulnerability and its impact
- Steps to reproduce (proof-of-concept code is helpful but not required)
- The affected component (`apps/web`, `apps/bridge`, `packages/cli`, etc.) and version/commit
- Any suggested mitigation, if you have one

## What to expect

- I aim to **acknowledge reports within 72 hours**.
- For valid issues, I'll work on a fix and coordinate disclosure with you.
- Raltic is a small project maintained in personal time, so timelines for fixes will vary by severity. Critical issues take priority.
- I'll credit you in the security advisory unless you'd rather stay anonymous.

## Scope

In-scope:

- The Raltic web application (`apps/web`)
- The Raltic bridge published as `@raltic/bridge` on npm
- The `@raltic/cli` package
- Database schema, RLS policies, and triggers in `packages/db`

Out of scope:

- Vulnerabilities in third-party dependencies (please report those upstream — though feel free to ping me too if Raltic needs a version bump)
- Issues in the hosted infrastructure at `raltic.example.com` that are *not* caused by application code (e.g. Supabase platform issues)
- Social-engineering attacks, physical attacks, or anything requiring access to a victim's already-unlocked device

## Hardening notes for self-hosters

If you're running Raltic on your own infrastructure:

- **Rotate the Supabase service role key** if it ever lands in a place it shouldn't (logs, error reports, screenshots).
- **Keep RLS policies reviewed** when you change the schema — Raltic relies on Supabase RLS to enforce channel/server isolation.
- **The bridge runs Claude Code with your local credentials.** Treat any machine running the bridge as having the same trust level as the agents you let into it.
- Pin the bridge to a specific version in production (`npx @raltic/bridge@x.y.z`) rather than tracking `latest`.
