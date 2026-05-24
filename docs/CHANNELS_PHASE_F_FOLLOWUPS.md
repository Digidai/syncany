# Channels Phase F — Tier-4 stubs (shipped + deferred)

## Shipped

- **Browser Notification on `channel_new` when tab hidden** — fires a
  silent system toast when a new message arrives in a channel the
  user is a member of, *and* their tab is in the background, *and*
  they have previously granted Notification permission for
  raltic.com. Implementation: `apps/web/src/hooks/use-agent-activity.tsx`,
  `channel_new` handler. Click → focuses tab.

## Deferred (intentional)

### Permission request UI

Today the Notification only fires if the user has *already* granted
permission for raltic.com (e.g. via browser settings). We don't
auto-call `Notification.requestPermission()` from the gateway
provider because it requires a user gesture in Chrome/Safari.

**Next step**: small "Enable notifications" CTA in the user-pill
dropdown OR a one-time toast on the first workspace open. Both go
through a click handler that wraps `Notification.requestPermission()`.

### Slash commands

Considered: `/me`, `/shrug`, `/clear`, `/pin <message-link>`.

Skipped for v1 because Raltic's pitch is "agents replace slash
commands" — a half-baked slash framework competes with the agent
surface without offering parity. If we ship slash later, do it as
a small parser in `tiptap-message-input.tsx` that intercepts
`onSend` for `/`-prefixed text. ~1h for `/me + /shrug + /clear`,
no infrastructure.

### Emoji `:shortcode:` autocomplete

Skipped — needs the Unicode emoji-data dependency (a few hundred
KB minified) and a Tiptap suggestion plugin. Real value is low
since users can use the system emoji picker (⌃⌘Space on macOS) or
paste characters directly.

**Next step**: add `@tiptap/extension-mention`-style suggestion
hooked to a slim emoji-name → unicode map (curated ~50 most-used:
`:smile:` `:fire:` `:tada:` etc.). ~2h.

### Channel-level admin role

Considered: `channel_members.is_admin` boolean flag + `canRemoveMember`
check accepts admin OR creator OR owner.

Skipped because today the gate is creator-or-workspace-owner, which
fits Raltic's scale (single-workspace teams, ≤20 channels). Adding
a per-channel admin role adds policy complexity (who grants admin?
how is it audited?) without solving a current pain.

**Next step when needed**: add the column + a `grantAdmin/revokeAdmin`
endpoint pair (gated by creator/owner), extend canRemoveMember to
accept admins. ~1h.
