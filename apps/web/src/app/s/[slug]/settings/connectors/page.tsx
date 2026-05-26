"use client";

/**
 * Connectors settings page (P2).
 *
 * Per-user list of external-service PATs the user has registered. From
 * here they can add/remove credentials; per-agent grants happen on the
 * agent's edit dialog.
 *
 * UX choice: we show the PAT once on creation (in case the user wants
 * to copy it back somewhere) but never again. The label is the only
 * stable identifier in the list.
 */
import { useEffect, useState } from "react";
import { GitBranch, Briefcase, BookOpen, Plug, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { notifyThrown } from "@/lib/notify";
import { Card, CardHeader, CardTitle, CardDescription, CardPanel } from "@/components/heroui-pro/card";
import { Button } from "@/components/heroui-pro/button";
import { Input } from "@/components/heroui-pro/input";
import { Select } from "@/components/heroui-pro/select";
import { Field, FieldLabel } from "@/components/heroui-pro/field";
import { ConfirmDialog } from "@/components/heroui-pro/confirm-dialog";
import { SettingsSection } from "../layout";

type ConnectorKind = "github" | "linear" | "notion";

interface ConnectorRow {
  id: string;
  kind: ConnectorKind;
  label: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

const KIND_META: Record<ConnectorKind, {
  label: string;
  Icon: typeof GitBranch;
  helpUrl: string;
  scopesDefault: string[];
  description: string;
}> = {
  github: {
    label: "GitHub",
    Icon: GitBranch,
    helpUrl: "https://github.com/settings/tokens?type=beta",
    scopesDefault: ["repo", "issues"],
    description: "Personal Access Token (classic or fine-grained). Grant `repo` for private repos + `issues` for issue/PR tools.",
  },
  linear: {
    label: "Linear",
    Icon: Briefcase,
    helpUrl: "https://linear.app/settings/api",
    scopesDefault: [],
    description: "Personal API Key from Linear's Settings → API → Personal API keys.",
  },
  notion: {
    label: "Notion",
    Icon: BookOpen,
    helpUrl: "https://www.notion.so/my-integrations",
    scopesDefault: [],
    description: "Internal Integration Token from notion.so/my-integrations. Grant access to specific pages/databases inside Notion.",
  },
};

export default function ConnectorsPage() {
  const [connectors, setConnectors] = useState<ConnectorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<ConnectorKind>("github");
  const [label, setLabel] = useState("");
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ConnectorRow | null>(null);

  async function reload() {
    try {
      const r = await api.listConnectors();
      setConnectors(r.connectors as ConnectorRow[]);
    } catch (e) { notifyThrown("Couldn't load connectors", e); }
    finally { setLoading(false); }
  }
  useEffect(() => { reload(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || !token.trim()) return;
    setSubmitting(true);
    try {
      await api.createConnector({
        kind,
        label: label.trim(),
        token: token.trim(),
        scopes: KIND_META[kind].scopesDefault,
      });
      setLabel("");
      setToken("");
      await reload();
    } catch (e) {
      notifyThrown("Couldn't add connector", e);
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmRevoke() {
    if (!revokeTarget) return;
    try {
      await api.deleteConnector(revokeTarget.id);
      await reload();
      setRevokeTarget(null);
    }
    catch (e) { notifyThrown("Couldn't remove connector", e); }
  }

  return (
    <SettingsSection
      title="Connectors"
      description="Personal tokens that let your agents talk to GitHub, Linear, and Notion on your behalf. Tokens are encrypted at rest and never shown again after you save them."
    >
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Plug className="h-4 w-4" /> Add a connector</CardTitle>
          <CardDescription>{KIND_META[kind].description}{" "}
            <a href={KIND_META[kind].helpUrl} target="_blank" rel="noopener noreferrer" className="underline">Get a token</a>.
          </CardDescription>
        </CardHeader>
        <CardPanel>
          <form onSubmit={handleCreate} className="grid gap-3 sm:grid-cols-[140px_1fr_1fr_auto]">
            <Field>
              <FieldLabel htmlFor="connector-kind">Service</FieldLabel>
              <Select
                id="connector-kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as ConnectorKind)}
                aria-label="Connector kind"
              >
                {(Object.keys(KIND_META) as ConnectorKind[]).map(k => (
                  <option key={k} value={k}>{KIND_META[k].label}</option>
                ))}
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="connector-label">Label</FieldLabel>
              <Input id="connector-label" value={label} onChange={e => setLabel(e.target.value)} placeholder="personal-gh" />
            </Field>
            <Field>
              <FieldLabel htmlFor="connector-token">Token</FieldLabel>
              <Input
                id="connector-token"
                type="password"
                value={token}
                onChange={e => setToken(e.target.value)}
                placeholder="ghp_…"
                autoComplete="off"
              />
            </Field>
            <Button type="submit" disabled={submitting || !label.trim() || !token.trim()} className="self-end">
              {submitting ? "Saving…" : "Add"}
            </Button>
          </form>
        </CardPanel>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Your connectors</CardTitle>
          <CardDescription>
            {loading ? "Loading…" : connectors.length === 0
              ? "No connectors yet. Add one above to enable agent tools for that service."
              : `${connectors.length} connector${connectors.length === 1 ? "" : "s"}.`}
          </CardDescription>
        </CardHeader>
        <CardPanel>
          {!loading && connectors.length > 0 && (
            <ul className="divide-y">
              {connectors.map(c => {
                const meta = KIND_META[c.kind];
                const Icon = meta.Icon;
                return (
                  <li key={c.id} className="flex items-center gap-3 py-2.5">
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{c.label}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {meta.label}{c.scopes.length > 0 ? ` · ${c.scopes.join(", ")}` : ""}
                        {c.lastUsedAt ? ` · used ${new Date(c.lastUsedAt).toLocaleDateString()}` : " · never used"}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove ${c.label}`}
                      onClick={() => setRevokeTarget(c)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardPanel>
      </Card>

      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title={`Remove "${revokeTarget?.label ?? ""}"?`}
        description="Agents using this connector will immediately lose access to the service. The token is also deleted from our database."
        confirmLabel="Remove"
        onConfirm={confirmRevoke}
      />
    </SettingsSection>
  );
}
