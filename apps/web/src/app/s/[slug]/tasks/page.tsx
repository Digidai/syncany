"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, type Channel, type Agent } from "@/lib/api";
import { notifyThrown } from "@/lib/notify";
import { Card, CardHeader, CardTitle, CardPanel } from "@raltic/ui/components/ui/card";
import { Button } from "@raltic/ui/components/ui/button";
import { Input } from "@raltic/ui/components/ui/input";
import { ListChecks } from "lucide-react";

interface Task {
  id: string;
  channelId: string;
  // Nullable: a fresh task row may have a null messageId between the row
  // insert and the back-fill after the chat-message DO send completes
  // (or permanently null if the DO send failed).
  messageId: string | null;
  taskNumber: number;
  title?: string;
  status: "todo" | "in_progress" | "in_review" | "done";
  assigneeId: string | null;
  assigneeType: "human" | "agent" | null;
  createdAt: number;
  updatedAt: number;
}

const COLUMNS = [
  { key: "todo",        label: "To do",         color: "bg-zinc-100" },
  { key: "in_progress", label: "In progress",   color: "bg-blue-50" },
  { key: "in_review",   label: "In review",     color: "bg-amber-50" },
  { key: "done",        label: "Done",          color: "bg-emerald-50" },
] as const;

export default function TaskBoardPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [channels, setChannels] = useState<Channel[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [serverId, setServerId] = useState<string>("");
  const [filterChannel, setFilterChannel] = useState<string>("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  // Create form
  const [title, setTitle] = useState("");
  const [createChannel, setCreateChannel] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    setServerId("");
    setFilterChannel("");
    setChannels([]);
    setAgents([]);
    setCreateChannel("");
    setTasks([]);
    (async () => {
      try {
        const data = await api.getServerBySlug(slug);
        if (cancelled) return;
        setServerId(data.server.id);
        setChannels(data.channels);
        setAgents(data.agents);
        setCreateChannel(data.channels[0]?.id ?? "");
      } catch (e) {
        notifyThrown("Couldn't load server", e);
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        if (!serverId && !filterChannel) {
          if (!cancelled) setTasks([]);
          return;
        }
        const data = await api.listTasks(filterChannel ? { channelId: filterChannel } : { serverId });
        if (!cancelled) setTasks(data.tasks);
      } catch (e) {
        notifyThrown("Couldn't load tasks", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [filterChannel, serverId]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !createChannel) return;
    try {
      const titleText = title.trim();
      const res = await api.createTask({ channelId: createChannel, title: titleText });
      setTitle("");
      // Optimistically prepend with title — backend echoes it back via the
      // joined message content on next listTasks refresh.
      setTasks((prev) => [{
        id: res.id, channelId: createChannel, messageId: "",
        taskNumber: res.taskNumber, title: titleText, status: "todo",
        assigneeId: null, assigneeType: null,
        createdAt: Date.now(), updatedAt: Date.now(),
      }, ...prev]);
    } catch (e) {
      notifyThrown("Couldn't create task", e);
    }
  }

  async function move(t: Task, status: Task["status"]) {
    setTasks((prev) => prev.map(p => p.id === t.id ? { ...p, status } : p));
    try { await api.updateTask(t.id, { status }); }
    catch (e) {
      notifyThrown("Couldn't move task", e);
      setTasks((prev) => prev.map(p => p.id === t.id ? t : p));
    }
  }

  const channelById = new Map(channels.map(c => [c.id, c]));
  const labelFor = (a: Task["assigneeType"], id: string | null) => {
    if (!id) return null;
    if (a === "agent") return agents.find(g => g.id === id)?.displayName ?? id.slice(0, 6);
    return id.slice(0, 6);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Full-width header bar — matches Inbox + Agent profile shells so
          navigating between sidebar destinations doesn't make the top
          chrome jump (used to: Tasks had no header, content floated
          inside padding). Inner row is max-w-5xl mx-auto so the title
          column lines up across pages too. */}
      <header className="border-b px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          {/* Page tint convention (D-style): Inbox=cyan (notice/attention),
              Tasks=amber (todo accent), Agents=emerald (automation),
              People=violet (humans). Distinct per top-level destination
              so the visual breadcrumb is clear at a glance. */}
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-400">
            <ListChecks className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold">Tasks</h1>
            <p className="text-xs text-muted-foreground">
              Kanban view of work across this workspace.
            </p>
          </div>
          <select
            value={filterChannel}
            onChange={(e) => setFilterChannel(e.target.value)}
            className="shrink-0 rounded border px-2 py-1 text-sm"
            aria-label="Filter by channel"
          >
            <option value="">All channels</option>
            {channels.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
          </select>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-5xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Quick add</CardTitle>
          </CardHeader>
          <form onSubmit={handleCreate}>
            <CardPanel>
              <div className="flex gap-2">
                <select
                  value={createChannel}
                  onChange={(e) => setCreateChannel(e.target.value)}
                  className="rounded border px-2 py-1 text-sm"
                >
                  {channels.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
                </select>
                <Input value={title}
                  onChange={(e) => setTitle((e.target as HTMLInputElement).value)}
                  placeholder="Task title — what needs doing?" className="flex-1" />
                <Button type="submit">Add</Button>
              </div>
            </CardPanel>
          </form>
        </Card>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          {COLUMNS.map(col => {
            const colTasks = tasks.filter(t => t.status === col.key);
            return (
              <div key={col.key} className={"rounded-lg border p-3 " + col.color}>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {col.label}
                  <span className="ml-1 rounded bg-white px-1.5 text-[10px]">{colTasks.length}</span>
                </h3>
                <div className="space-y-2">
                  {loading && col.key === "todo" && (
                    <p className="text-xs text-muted-foreground">Loading…</p>
                  )}
                  {colTasks.map(t => (
                    <div key={t.id} className="rounded border bg-white p-2 text-xs shadow-sm">
                      <div className="flex items-baseline justify-between">
                        <span className="font-mono text-[10px] text-muted-foreground">#{t.taskNumber}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {channelById.get(t.channelId)?.name ?? t.channelId.slice(0, 6)}
                        </span>
                      </div>
                      <div className="mt-1 break-words text-sm font-medium leading-snug text-foreground">
                        {t.title ?? "(untitled)"}
                      </div>
                      {t.assigneeId && (
                        <div className="mt-1 text-[10px] text-muted-foreground">
                          → {labelFor(t.assigneeType, t.assigneeId)}
                        </div>
                      )}
                      <div className="mt-2 flex gap-1">
                        {COLUMNS.filter(c => c.key !== col.key).map(other => (
                          <button
                            key={other.key}
                            onClick={() => move(t, other.key)}
                            className="rounded border px-1.5 py-0.5 text-[10px] hover:bg-zinc-50"
                            title={`Move to ${other.label}`}
                          >→{other.label.split(" ")[0]}</button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        </div>
      </div>
    </div>
  );
}
