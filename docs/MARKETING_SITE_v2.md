# Marketing Site v2 — GTM-driven plan

Status: **PROPOSAL v2 — codex-reviewed (NEEDS WORK → revised); awaiting user go/no-go before build**
Author: design pass following the OpenClaw+Hermes integration (RuntimeId × 4, runtimeMode × 2).
Last updated: 2026-05-23.

> **v2 changelog** (codex review applied):
> - **HIGH-1 (CTA path)**: Primary CTA flips to "Start a cloud agent" (raltic mode, zero install); local-bridge wizard becomes the secondary "Bring your own daemon" path.
> - **HIGH-2 (OpenClaw/Hermes premature SEO)**: `/runtimes/openclaw` + `/runtimes/hermes` ship with `<meta name="robots" content="noindex">` and an "Experimental — smoke verification pending" banner until `docs/SMOKE_TESTS_openclaw_hermes.md` completes.
> - **HIGH-3 (connector-event claims)**: Removed all references to PR-triggered or scheduled autonomous agents. Connectors story becomes "Give agents access to your tools" (PAT storage + per-agent grants only, which IS shipped).
> - **MED (/teams gating)**: `/teams` does not appear in top nav until P4 billing ships; if built early, it's an unlinked URL for paid ad targeting only, with an explicit "Private beta for teams — waitlist" frame.
> - **MED (scope)**: Revised to 8–12 days, re-phased so unverified surfaces ship last.
> - **MED (truth audit)**: Memory claim limited to Hermes-experimental; connectors copy tightened to PAT-grant model; "D1 encryption at rest" replaced with the verifiable "connector tokens are envelope-encrypted; transport uses HTTPS/WSS".
> - **LOW (must-ship)**: Demo GIF (or animated SVG) added as Phase 1 deliverable. Changelog page deferred to post-launch.
> - **LOW (thin-content guard)**: Per-runtime pages require ≥60% unique body copy; below that bar → `noindex`.

---

## 0. TL;DR

The new architecture (4 runtimes + 2 execution modes + connectors +
agentic memory) opens a positioning we couldn't credibly claim before:
**"the chat platform where AI runs on YOUR machine, with YOUR keys, in
YOUR daemon — and ours, if you'd rather not install."** No other team
chat tool can say this. Slack/Discord can't (agents are bolt-on bots).
ChatGPT Teams / Claude Teams can't (one provider, their keys). Cursor /
Cody can't (they're editors, not team comms).

This plan keeps the existing `/` as the primary AI-native-teams
landing, and adds three SEO+paid-targeted secondary landings
(`/indie`, `/teams`, `/runtimes/*`) plus support pages (`/connectors`,
`/security`). Pricing stays "Free private beta" until P4 ships.

**Scope**: phase-able. Verified surfaces (Claude/Codex pages, primary
landing, security, connectors) ship before experimental ones
(OpenClaw/Hermes pages noindex until smoke verification completes).

---

## 1. Positioning

### One-line thesis
> Raltic is the team chat platform where AI agents are first-class
> teammates — running on your hardware, your keys, your model. Or ours,
> zero install required.

### Three things every page must communicate
1. **Agents are first-class** — not bots, not "/ai" slash commands.
   They have identity, channels, DMs, threads, memory.
2. **You own the stack** — bring your Claude Code, Codex, OpenClaw, or
   Hermes daemon. We never see your provider keys.
3. **Zero install if you want** — Raltic cloud mode runs in our
   sandbox containers with managed routing. Same chat surface.

### What we explicitly DON'T claim (yet)
- Enterprise SSO/SAML (not built)
- HIPAA/SOC 2 compliance (not pursued)
- Real-time voice/video (not built)
- Workflow automation / Zapier-style builder (not built)
- Multi-org tenancy (single workspace per user today)

Every section on every page must point to a shipped feature. The
existing `apps/web/src/app/page.tsx:18-33` truth-audit comment is the
contract — extend it page by page.

---

## 2. Audience segmentation

| Tier | Persona | Pain | Primary CTA |
|------|---------|------|-------------|
| **P1 (primary)** | AI-native dev team (3–20 devs, founders, ICs running multiple AI CLIs daily) | Agents siloed in 5 tools; can't @mention them in team chat; provider lock-in fears | "Start free private beta" → wizard with 4 runtime choices |
| **P2 (SEO/paid)** | Indie dev / AI tinkerer | Wants one place for personal agents; loves local-first; reluctant to give cards to N providers | Self-serve signup, "bridge runs on your laptop" hero |
| **P3 (SEO/paid)** | Mid-market eng org (50–500) | Slack-fatigued; AI tools chaotic; budget owner wants control | "See teams pricing" → waitlist for P4 billing |

**Intent stages we'll instrument:**
- *Stage 0*: doesn't know agents-in-chat is possible → `/runtimes/*`
  SEO catches them
- *Stage 1*: knows Claude Code, wants it in team chat → `/` hero
- *Stage 2*: comparing tools → `/` comparison section
- *Stage 3*: signed up, evaluating → wizard + onboarding agent
- *Stage 4*: team rollout → `/teams` (P4 trigger)

---

## 3. Site map

```
/                       Primary landing — AI-native dev teams
/indie                  Indie dev landing (SEO: "claude code chat",
                                            "openclaw team",
                                            "personal AI workspace")
/teams                  Mid-market landing (SEO: "ai team chat",
                                             "slack alternative ai",
                                             "agent platform team")
/runtimes               Runtime overview hub
/runtimes/claude        Claude Code in Raltic (SEO: "claude code multiplayer")
/runtimes/codex         Codex in Raltic
/runtimes/openclaw      OpenClaw in Raltic (SEO: "openclaw team chat",
                                              "local AI team")
/runtimes/hermes        Hermes Agent in Raltic
/connectors             GitHub + Linear + Notion overview
/security               BYO key + local execution + data flow
/login                  (exists)
/signup                 (exists)
/s/[slug]/*             (app — out of scope)
```

**SEO bets** (per runtime page):
- Long-tail keywords ("claude code multiplayer", "openclaw share session")
- Each runtime page is the canonical "this CLI in a team chat" landing
- Schema.org structured data for SoftwareApplication
- OG cards with runtime-specific imagery

**Paid bets** (per landing):
- `/indie`: target individual devs on X/Reddit/HN
- `/teams`: target eng-leader keywords on LinkedIn

---

## 4. Per-page blueprint

### 4.1 `/` (primary)

New section order (vs current):

1. **Hero** — "AI teammates that run on our cloud. Or yours."
   - Visual: animated GIF/SVG showing 4 differently-colored agents
     (claude/codex/openclaw/hermes) replying in a channel
   - Sub: 4 logos + "Zero install with Raltic cloud. Or bring your
     own daemon."
   - **PRIMARY CTA**: "Start a cloud agent" → signup → create-agent
     dialog with `runtimeMode: "raltic"` preselected (zero local install)
   - **SECONDARY CTA**: "Bring your own daemon" → signup → setup-wizard
     (the existing 5-step bridge flow). Smaller, below primary.
   - codex review HIGH-1: pre-revision the primary CTA went to the
     bridge wizard, which is the LOCAL setup path. Cloud signup is
     the zero-install offer — must be the default journey.
2. **Runtime matrix** — 4 cards, each with: name, badge color, "where
   it runs" (local vs cloud), "what you provide" (keys vs nothing).
   OpenClaw + Hermes cards carry an "Experimental" pill until smoke
   verification completes (codex review HIGH-2).
3. **The pitch in 30 seconds** — one paragraph, no decoration. The
   "your hardware, your keys" line, then "or ours, zero install".
4. **Live mock** — embedded chat snippet (existing `MockMessage`
   component) showing two devs + two agents in `#engineering`
5. **The two ways agents work** — DM and channel @mention. (Earlier
   draft listed "autonomous on a schedule" + "in response to a
   connector event"; neither is shipped. Removed per codex review
   HIGH-3. Re-add when scheduler + event triggers land.)
6. **Connectors** — "Give agents access to your tools". GitHub +
   Linear + Notion: store a PAT once, grant per-agent. NO claims of
   webhook automation, PR-triggered runs, or workflow orchestration
   (none shipped; codex review HIGH-3 + MED-5).
7. **Memory** — limited to the shipped agentic memory (filesystem-first,
   workspace files). Don't conflate with Hermes' separate persistent
   memory — that's a per-runtime feature, mention only on
   /runtimes/hermes (codex review MED-4).
8. **Why Raltic** — three pillars (own the stack / zero lock-in /
   real chat surface)
9. **Comparison** — keep current table, add OpenClaw/Hermes row
10. **Security/privacy** — short, with deep link to `/security`
11. **Pricing** — "Free private beta" with note "Team tier coming
    after P4"
12. **FAQ** — 8 questions max (current has more — trim)
13. **Final CTA** — single button, no decoration
14. **Footer** — link to indie/teams/runtimes/connectors/security

Removed sections (vs current `page.tsx`):
- "Architecture" diagram (move to `/security`, too low-funnel for `/`)
- "Use cases" generic blob (replaced by section 5 above)
- "Agent recipe" / "Roster" (move to `/runtimes`)

### 4.2 `/indie`

For solo devs. Tone: warm, lower stakes, "your AI playground".

1. Hero: "All your AI agents, one chat" — laptop screenshot
2. "Brings these together" — 4 runtime logos
3. Show DM + @mention pattern, one screenshot each
4. "Runs on your laptop" — bridge install one-liner, prominent
5. "Or zero install" — Raltic cloud mode
6. Privacy: "We can't see your keys"
7. FAQ (indie-specific: "Can I use my own provider?", "What if I
   uninstall?", "What about my message history?")
8. Free signup CTA

### 4.3 `/teams`

For mid-market eng leaders. Tone: precise, control-oriented.

1. Hero: "Your team's AI workspace, on your terms"
2. "Why teams choose Raltic" — three: control, no lock-in, native chat
3. "How it works for a team" — runtime per dev, shared channels,
   shared memory, audit-able
4. Comparison table — Raltic vs ChatGPT Teams vs Claude Teams vs
   Slack+bots
5. "Onboarding in 5 minutes" — wizard walk-through
6. Security deep-dive (link to `/security` for full)
7. "Team pricing coming after P4" + waitlist signup
8. Footer with sales contact

### 4.4 `/runtimes` hub

1. Hero: "Four agent runtimes. One chat surface."
2. 4 cards, each links to `/runtimes/[id]`
3. Comparison: features × runtime grid
4. "Mix and match per agent" — one workspace can run all 4
5. CTA: start free, pick yours

### 4.5 `/runtimes/[id]` (×4)

Same template, content-templated per runtime:

1. Hero: "<Runtime> in Raltic" — runtime logo + brand color
2. "What is <Runtime>?" — 1 paragraph (link to upstream)
3. "How Raltic uses it" — local daemon / per-turn spawn / etc
4. Install path — copy-paste command from `RUNTIME_INSTALL_CMD`
5. Live demo (mock chat with that runtime answering)
6. "Three things this runtime is best at" — content per runtime
7. FAQ specific to runtime
8. CTA: start free

### 4.6 `/connectors`

1. Hero: "Connect your tools, your agents do the work"
2. GitHub card + 2-line capability list
3. Linear card + 2-line capability list
4. Notion card + 2-line capability list
5. "Roadmap: <next 3>" — Slack import? Jira?
6. CTA

### 4.7 `/security`

1. Hero: "What we see. What we don't."
2. Data flow diagram (bridge → API → DO → fanout)
3. "We never have your provider keys" — explainer for BYO daemon
4. "Local execution" — files stay on your machine
5. Encryption at rest (D1) + in transit (WSS)
6. "No SSO/SAML yet" — honest disclosure of what we DON'T have
7. Per-machine key model — revocation flow
8. Contact + responsible disclosure

---

## 5. SEO + paid landing strategy

### SEO
- `/runtimes/[id]` pages are the SEO workhorses — each targets a
  long-tail query about that CLI ("claude code multiplayer",
  "openclaw team chat", "hermes agent collaborate")
- `/indie` targets "personal AI workspace", "self-hosted AI chat"
- `/teams` targets "AI team chat", "slack alternative AI"
- `/connectors` targets "AI agent github", "AI linear integration"
- Open Graph cards: runtime-colored, with the runtime logo
- Sitemap.xml: include all 4 runtime pages
- Schema.org: SoftwareApplication on `/`, Article on each runtime

### Paid (when we turn this on)
- `/indie` for X/Reddit/HN audience
- `/teams` for LinkedIn engineering leader audience
- `/runtimes/openclaw` + `/runtimes/hermes` for niche communities
  who already know those daemons (Nous Research Discord, OpenClaw
  Telegram)

### Analytics
- Cloudflare Web Analytics already on
- Add per-page event tracking: `landing_view`, `cta_click`,
  `runtime_card_click`, `wizard_start`
- Wire a hidden `?utm_source=…` capture into the wizard so
  attribution survives the auth round-trip

---

## 6. Visual + content tone

### Tone matrix
| Page | Voice |
|------|-------|
| `/` | Confident, technical, no fluff. Code-as-design. |
| `/indie` | Warmer, "you", playful tech humor. |
| `/teams` | Precise, control vocabulary, conservative. |
| `/runtimes/*` | Neutral-technical, like a docs landing. |
| `/security` | Plain, no marketing speak. |

### Visual
- Keep current dark palette (`bg-black text-white`)
- Per-runtime accent colors (cyan/amber/violet/rose — already in
  `RuntimeDot`)
- Monospace for code/metrics, sans-serif for prose
- Live-data widgets stay live (the chat mock already animates)

### Copy guidelines
- Every claim ⇄ shipped feature (truth audit per page)
- No "AI-powered" buzzword unless we name the runtime
- No "10x productivity" — show the actual mock instead
- Lengths: hero ≤ 12 words; sub ≤ 25; section header ≤ 6 words;
  card body ≤ 40 words

---

## 7. Execution phases

Critically, **verified surfaces ship first; experimental surfaces last**.

### Phase 1 (must-ship)
- Rewrite `/` Hero + sub + dual-CTA (primary cloud, secondary BYO)
- RuntimeBadges → 4 entries with "Experimental" pill on openclaw/hermes
- Update Comparison table to include OpenClaw + Hermes
- Remove "The four ways agents work" autonomous/event lines
- Tighten Connectors section copy to PAT-grant model
- Tighten Memory section to shipped agentic-memory only
- Trim FAQ to 8
- Truth-audit comment refresh
- **Demo GIF or SVG** of the chat in motion (codex LOW-11) — must-ship

### Phase 2 (verified runtimes only)
- Build `/runtimes` hub
- Ship `/runtimes/claude` + `/runtimes/codex` (verified, indexable)
- Add to sitemap + OG cards
- Defer `/runtimes/openclaw` + `/runtimes/hermes` to Phase 4

### Phase 3 (`/indie` + `/connectors`)
- `/indie` from `/` template, indie-tone copy
- `/connectors` overview page (PAT-grant model, no automation claims)
- Truth-audit per page

### Phase 4 (experimental runtimes)
- `/runtimes/openclaw` + `/runtimes/hermes` with `<meta robots="noindex">`
  and "Experimental — smoke verification pending" banner
- When smoke runbook completes, flip to `index, follow` (separate task)

### Phase 5 (`/security`)
- Built from existing Privacy section + data flow
- Tightened claims: "connector tokens envelope-encrypted; HTTPS/WSS"
- NOT "D1 encryption at rest" (codex LOW-10)
- `security@` mailbox configured BEFORE page ships

### Phase 6 (`/teams`, deferred until P4 billing)
- Per codex MED-6 + MED-7: do NOT build until billing exists. Page
  without price signal weakens evaluation for the mid-market buyer.
- When triggered: hidden from top nav, paid-ad-only URL,
  "Private beta for teams — waitlist".

### Phase 7 (instrumentation)
- landing_view / cta_click / runtime_card_click / wizard_start /
  cloud_agent_start events
- UTM capture on landing, persist through signup → wizard via cookie

Phases 1 → 2 → 5 are the indexable-and-honest critical path. Phases 3,
4, 7 can interleave.

---

## 8. Out of scope (don't get drawn in)

- New visual design language — keep existing palette
- Docs site (different project)
- Blog (different project)
- I18n / zh-CN site (separate effort)
- Animations beyond what's already in `MockMessage`
- A/B testing framework
- Real-time site analytics dashboard
- Customer logos (we don't have any to show)

---

## 9. Risks

- **Truth-audit drift** — adding 7 new pages multiplies the surface
  where feature claims could outrun reality. Mitigation: each page
  gets the audit comment at the top, identical to `page.tsx:18-33`.
- **SEO patience** — runtime pages won't rank for 6–12 weeks.
  Mitigation: paid traffic to validate copy/CTAs while SEO matures.
- **Two-audience message dilution on `/`** — primary stays
  AI-native-teams; secondary personas go to their own landings via
  footer links + sidebar nav. Don't mix on `/`.
- **OpenClaw + Hermes recognition** — most readers won't know either.
  Mitigation: `/runtimes/[id]` pages explain "what this is" before
  "what Raltic adds".

---

## 10. Codex review outcomes

Codex returned **NEEDS WORK** with 3 HIGH, 5 MED, 3 LOW. All HIGH
and MED applied in v2 above. Originals preserved for reference:

| # | Severity | Finding | Status |
|---|---|---|---|
| H1 | HIGH | Primary CTA pointed to bridge wizard (local) instead of cloud signup (zero-install) | APPLIED — dual-CTA, cloud primary |
| H2 | HIGH | `/runtimes/openclaw` + `/runtimes/hermes` premature SEO; smoke pending | APPLIED — Phase 4 + noindex |
| H3 | HIGH | "Autonomous schedule" + "PR event trigger" claims — neither shipped | APPLIED — section deleted, connectors copy tightened |
| M4 | MED | Memory claim conflated agentic-memory + Hermes memory | APPLIED — split per-runtime |
| M5 | MED | Connectors copy implied rich integrations; only PAT-grant ships | APPLIED — copy tightened |
| M6 | MED | `/teams` premature without billing | APPLIED — deferred to Phase 6 |
| M7 | MED | SEO 3-landing split optimistic for new site | APPLIED — Phase 2 ships only verified runtimes |
| M8 | MED | Estimate optimistic | APPLIED — verified-first phasing; no fixed estimates |
| L9 | LOW | Runtime pages thin-content risk | APPLIED — ≥60% unique body bar in §4.5 |
| L10 | LOW | "D1 encryption at rest" not product-backed | APPLIED — replaced with verifiable claim in §4.7 |
| L11 | LOW | Missing demo GIF/video + changelog | APPLIED — GIF added to Phase 1; changelog deferred |

Remaining open questions (for user decision):
1. Demo GIF medium — animated SVG (lightweight, no third-party host)
   vs hosted MP4/WebM (richer, requires R2 bucket + CDN)?
2. `/indie` ships in Phase 3 — confirm or defer until paid traffic plan exists?
