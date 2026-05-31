"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, type Channel, type Agent } from "@/lib/api";
import { notifyThrown } from "@/lib/notify";
import { Card, CardHeader, CardTitle, CardPanel } from "@/components/heroui-pro/card";
import { Button } from "@/components/heroui-pro/button";
import { Input } from "@/components/heroui-pro/input";
import { Select } from "@/components/heroui-pro/select";
import { Chip } from "@/components/heroui-pro/chip";
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
  { key: "todo",        label: "To do",         color: "default" },
  { key: "in_progress", label: "In progress",   color: "accent" },
  { key: "in_review",   label: "In review",     color: "warning" },
  { key: "done",        label: "Done",          color: "success" },
] as const satisfies readonly {
  key: Task["status"];
  label: string;
  color: "default" | "accent" | "warning" | "success";
}[];

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
  const channelSelectOptions = channels.map((channel) => ({ value: channel.id, label: `#${channel.name}` }));

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
    <div className="flex h-full w-full min-w-0 flex-1 flex-col overflow-hidden">
      {/* Full-width header bar — matches Inbox + Agent profile shells so
          navigating between sidebar destinations doesn't make the top
          chrome jump (used to: Tasks had no header, content floated
          inside padding). Inner row is max-w-5xl mx-auto so the title
          column lines up across pages too. */}
      <header className="shrink-0 border-b border-border/70 bg-background/85 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 sm:flex-row sm:items-center">
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
          <Select
            value={filterChannel}
            onChange={(e) => setFilterChannel(e.target.value)}
            className="w-full sm:w-44 sm:shrink-0"
            aria-label="Filter by channel"
            options={[{ value: "", label: "All channels" }, ...channelSelectOptions]}
          >
          </Select>
        </div>
      </header>

      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto w-full max-w-5xl space-y-5">
        <Card className="border-border/70 bg-surface/80 !shadow-none">
          <CardHeader className="px-4 py-3">
            <CardTitle className="text-sm font-semibold">Quick add</CardTitle>
          </CardHeader>
          <form onSubmit={handleCreate}>
            <CardPanel className="px-4 py-3">
              <div className="flex flex-col gap-2 sm:flex-row">
          <Select
            value={createChannel}
            onChange={(e) => setCreateChannel(e.target.value)}
            className="w-full sm:w-40 sm:shrink-0"
            aria-label="Task channel"
            options={channelSelectOptions}
          >
          </Select>
                <Input value={title}
                  onChange={(e) => setTitle((e.target as HTMLInputElement).value)}
                  placeholder="Task title — what needs doing?" className="min-w-0 flex-1" />
                <Button type="submit" className="w-full sm:w-auto">Add</Button>
              </div>
            </CardPanel>
          </form>
        </Card>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {COLUMNS.map(col => {
            const colTasks = tasks.filter(t => t.status === col.key);
            return (
              <Card key={col.key} className="min-w-0 border-border/60 bg-surface/70 !shadow-none">
                <CardPanel className="p-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {col.label}
                  </h3>
                  <Chip size="sm" variant="soft" color={col.color}>
                    {colTasks.length}
                  </Chip>
                </div>
                <div className="space-y-2">
                  {loading && col.key === "todo" && (
                    <p className="text-xs text-muted-foreground">Loading…</p>
                  )}
                  {colTasks.map(t => (
                    <Card key={t.id} className="border-transparent bg-background/80 !shadow-none">
                      <CardPanel className="p-2 text-xs">
                      <div className="flex min-w-0 items-baseline justify-between gap-2">
                        <span className="font-mono text-[10px] text-muted-foreground">#{t.taskNumber}</span>
                        <span className="min-w-0 truncate text-[10px] text-muted-foreground">
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
                      <div className="mt-2 grid grid-cols-2 gap-1">
                        {COLUMNS.filter(c => c.key !== col.key).map(other => (
                          <Button
                            key={other.key}
                            type="button"
                            onClick={() => move(t, other.key)}
                            variant="outline"
                            size="xs"
                            className="h-6 min-w-0 px-1.5 text-[10px]"
                            title={`Move to ${other.label}`}
                          >{other.label.split(" ")[0]}</Button>
                        ))}
                      </div>
                      </CardPanel>
                    </Card>
                  ))}
                </div>
                </CardPanel>
              </Card>
            );
          })}
        </div>
        </div>
      </div>
    </div>
  );
}
