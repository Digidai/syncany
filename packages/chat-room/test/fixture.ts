// Minimal worker fixture used only by `vitest-pool-workers` to instantiate
// the ChatRoom DO. Every test gets its own DO instance via `runInDurableObject`
// or by calling SELF.fetch routed below.
import { ChatRoom, UserGateway } from "../src/index";
export { ChatRoom, UserGateway };

export default {
  async fetch(req: Request, env: { CHAT_ROOM: DurableObjectNamespace }): Promise<Response> {
    const url = new URL(req.url);
    const channelId = url.searchParams.get("channelId") ?? "default";
    const stub = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(channelId));
    return stub.fetch(req);
  },
};
