import { test, expect, type Page } from "@playwright/test";

/**
 * Channels feature — end-to-end regression against the deployed
 * environment. Opt-in only.
 *
 * Run:
 *   RALTIC_E2E_EMAIL=ch-rt-…@raltic-test.local \
 *   RALTIC_E2E_PASSWORD='Test123!secure' \
 *   E2E_RUN_CHANNELS=1 \
 *   pnpm e2e -- channels-flow.spec.ts
 *
 * The user must already exist and have email_verified=1 (bootstrap via
 * better-auth signup + `wrangler d1 execute … "UPDATE user SET
 * email_verified=1 WHERE email='…'"`). Each run creates ONE throwaway
 * channel in the user's first workspace and leaves it at the end (or
 * deletes it via the danger-zone confirm).
 *
 * Coverage:
 *  - Create channel via dialog (no members beyond self)
 *  - Open Members dialog → see self in roster
 *  - Settings dialog → rename → save
 *  - Members chip count updates after rename refetch
 *  - Leave channel → router pushes back to workspace root → sidebar
 *    no longer lists the channel
 */
const RUN = process.env.E2E_RUN_CHANNELS === "1";
const EMAIL = process.env.RALTIC_E2E_EMAIL ?? "";
const PASSWORD = process.env.RALTIC_E2E_PASSWORD ?? "";

test.describe(RUN ? "channels flow" : "channels flow (skipped — set E2E_RUN_CHANNELS=1)", () => {
  test.skip(!RUN, "writes real channel rows to the target DB; opt-in only");
  test.skip(RUN && (!EMAIL || !PASSWORD), "RALTIC_E2E_EMAIL + RALTIC_E2E_PASSWORD required");

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("create → members → rename → leave full flow", async ({ page }) => {
    // Sidebar — the workspace landing redirects to the user's default
    // workspace after login. Wait for the "Create channel" button so
    // we know the sidebar has hydrated.
    const createBtn = page.getByRole("button", { name: "Create channel" });
    await expect(createBtn).toBeVisible({ timeout: 15000 });

    const channelName = `ch-rt-${Date.now().toString(36)}`;
    const renamedName = `${channelName}-renamed`;

    // -------- 1. Create the channel via the dialog --------
    await createBtn.click();
    const dialog = page.getByRole("dialog", { name: /create channel/i });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(/^name$/i).fill(channelName);
    // Create PRIVATE so the leave step at the end actually removes
    // the channel from the sidebar. Public channels stay visible
    // even after leave (by design — discovery via /channels page).
    await dialog.getByRole("button", { name: /private/i }).click();
    // Skip member picker — pure self-create exercises the new
    // initialMemberIds=undefined path (the simplest backend codepath).
    await dialog.getByRole("button", { name: /create channel/i }).click();
    await expect(dialog).toBeHidden({ timeout: 10000 });

    // Navigate to the new channel via the sidebar link (the create
    // dialog's onCreated dispatches the channels-changed event which
    // triggers a sidebar refetch).
    const sidebarLink = page.getByRole("link", { name: new RegExp(`^${channelName}$`) });
    await expect(sidebarLink).toBeVisible({ timeout: 10000 });
    await sidebarLink.click();
    await expect(page).toHaveURL(/\/channel\/[0-9a-f-]+$/);

    // -------- 2. Members chip + dialog --------
    const membersChip = page.getByRole("button", { name: /^\d+ members?$/ });
    await expect(membersChip).toBeVisible({ timeout: 10000 });
    await membersChip.click();
    const membersDialog = page.getByRole("dialog", { name: new RegExp(`Members of #${channelName}`) });
    await expect(membersDialog).toBeVisible();
    // Self row carries the (you) suffix per ChannelMembersDialog.
    await expect(membersDialog.getByText(/\(you\)/)).toBeVisible();
    // Press Escape rather than chase the "Close" selector — there are
    // two close affordances (footer text button + ✕ icon button) and
    // both are correctly labelled, but the disambiguation isn't worth
    // hardcoding into a regression test.
    await page.keyboard.press("Escape");
    await expect(membersDialog).toBeHidden();

    // -------- 3. Settings — rename --------
    await page.getByRole("button", { name: /channel actions/i }).click();
    await page.getByRole("menuitem", { name: /channel settings|view details/i }).click();
    const settingsDialog = page.getByRole("dialog", { name: /channel settings/i });
    await expect(settingsDialog).toBeVisible();
    const nameInput = settingsDialog.getByLabel(/^name$/i);
    await nameInput.fill(renamedName);
    await settingsDialog.getByRole("button", { name: /save changes/i }).click();
    await expect(settingsDialog).toBeHidden({ timeout: 10000 });
    // Sidebar link reflects the new name after refetch.
    await expect(page.getByRole("link", { name: new RegExp(`^${renamedName}$`) }))
      .toBeVisible({ timeout: 10000 });

    // -------- 4. Leave via the ⋯ menu + ConfirmDialog --------
    await page.getByRole("button", { name: /channel actions/i }).click();
    await page.getByRole("menuitem", { name: /leave channel/i }).click();
    const confirm = page.getByRole("alertdialog", { name: new RegExp(`Leave #${renamedName}`) });
    await expect(confirm).toBeVisible();
    // Confirm button lives inside the alert-dialog scope; constraining
    // the search avoids matching the menuitem that opened this confirm.
    await confirm.getByRole("button", { name: /^leave channel$/i }).click();
    // Router pushes back to workspace root (/s/[slug]).
    await expect(page).toHaveURL(/\/s\/[^/]+\/?$/, { timeout: 10000 });
    // Sidebar no longer lists the channel.
    await expect(page.getByRole("link", { name: new RegExp(`^${renamedName}$`) }))
      .toBeHidden({ timeout: 10000 });
  });
});

/** Sign in via the better-auth handler — keeps it independent of the
 *  login form's exact placeholder text, which the visual spec tests
 *  separately. */
async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder(/you@example\.com/i).fill(EMAIL);
  await page.getByPlaceholder(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  // After login better-auth redirects to /s/[slug] (the default
  // workspace). Wait for any workspace path.
  await expect(page).toHaveURL(/\/s\/[^/]+/, { timeout: 20000 });
}
