import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@raltic/db/schema";
import app from "../src/index";
import { bridgeKey, db, request, seedAgent, seedChannel, seedServer, seedUser, userBearer } from "./helpers";

async function seedTask(
  channelId: string,
  senderId: string,
  taskNumber: number,
): Promise<{ id: string; messageId: string }> {
  const id = crypto.randomUUID();
  const messageId = crypto.randomUUID();
  const now = new Date();
  await db().insert(schema.messages).values({
    id: messageId,
    channelId,
    senderId,
    senderType: "human",
    content: `Task #${taskNumber}`,
    seq: taskNumber,
    threadParentId: null,
    createdAt: now,
    updatedAt: now,
    editedAt: null,
    deletedAt: null,
    vectorIndexedAt: null,
    pinnedAt: null,
    pinnedBy: null,
  });
  await db().insert(schema.tasks).values({
    id,
    messageId,
    channelId,
    taskNumber,
    status: "todo",
    assigneeId: null,
    assigneeType: null,
    createdAt: now,
    updatedAt: now,
  });
  return { id, messageId };
}

describe("PATCH /api/v1/tasks/:ref", () => {
  it("resolves visible tasks by task number and message id prefix", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const channel = await seedChannel(srv, "public", [owner]);
    const auth = await userBearer(owner);
    const task = await seedTask(channel.id, owner.id, 7);

    const byNumber = await request(app as never, "https://test.local/api/v1/tasks/7", {
      method: "PATCH",
      headers: { authorization: auth, "content-type": "application/json" },
      body: JSON.stringify({ status: "in_progress" }),
    });
    expect(byNumber.status).toBe(200);

    const afterNumber = await db().select().from(schema.tasks).where(eq(schema.tasks.id, task.id)).limit(1);
    expect(afterNumber[0].status).toBe("in_progress");

    const byMessagePrefix = await request(app as never, `https://test.local/api/v1/tasks/${task.messageId.slice(0, 8)}`, {
      method: "PATCH",
      headers: { authorization: auth, "content-type": "application/json" },
      body: JSON.stringify({ status: "done" }),
    });
    expect(byMessagePrefix.status).toBe(200);

    const afterPrefix = await db().select().from(schema.tasks).where(eq(schema.tasks.id, task.id)).limit(1);
    expect(afterPrefix[0].status).toBe("done");
  });

  it("returns 409 for ambiguous visible task numbers", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const channelA = await seedChannel(srv, "public", [owner]);
    const channelB = await seedChannel(srv, "public", [owner]);
    const auth = await userBearer(owner);
    await seedTask(channelA.id, owner.id, 3);
    await seedTask(channelB.id, owner.id, 3);

    const res = await request(app as never, "https://test.local/api/v1/tasks/3", {
      method: "PATCH",
      headers: { authorization: auth, "content-type": "application/json" },
      body: JSON.stringify({ status: "done" }),
    });
    expect(res.status).toBe(409);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("AMBIGUOUS_TASK");
  });

  it("lets bridge-scoped agents resolve their visible task numbers only", async () => {
    const owner = await seedUser({ name: "Owner" });
    const srv = await seedServer(owner);
    const channel = await seedChannel(srv, "public", [owner]);
    const hiddenChannel = await seedChannel(srv, "public", [owner]);
    const agent = await seedAgent(srv, owner);
    await db().insert(schema.channelMembers).values({
      channelId: channel.id,
      memberId: agent.id,
      memberType: "agent",
      joinedAt: new Date(),
      lastReadSeq: 0,
    });
    const visible = await seedTask(channel.id, owner.id, 11);
    const hidden = await seedTask(hiddenChannel.id, owner.id, 12);
    const key = await bridgeKey(owner, srv);
    const connected = await request(app as never, "https://test.local/api/v1/bridge/connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: key }),
    });
    expect(connected.status).toBe(200);
    const { token } = await connected.json() as { token: string };
    const auth = `Bearer sy_bridge_${token}`;

    const visiblePatch = await request(app as never, "https://test.local/api/v1/tasks/11", {
      method: "PATCH",
      headers: { authorization: auth, "content-type": "application/json" },
      body: JSON.stringify({ status: "in_progress" }),
    });
    expect(visiblePatch.status).toBe(200);
    const visibleRows = await db().select().from(schema.tasks).where(eq(schema.tasks.id, visible.id)).limit(1);
    expect(visibleRows[0].status).toBe("in_progress");

    const hiddenPatch = await request(app as never, "https://test.local/api/v1/tasks/12", {
      method: "PATCH",
      headers: { authorization: auth, "content-type": "application/json" },
      body: JSON.stringify({ status: "done" }),
    });
    expect(hiddenPatch.status).toBe(404);
    const hiddenRows = await db().select().from(schema.tasks).where(eq(schema.tasks.id, hidden.id)).limit(1);
    expect(hiddenRows[0].status).toBe("todo");
  });
});
