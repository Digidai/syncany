// Public entry. Re-exports common symbols so consumers can do
// `import { usePlatform, PlatformProvider } from "@raltic/ui"`
// without remembering sub-paths. Heavier features (full Inbox /
// AgentProfile etc) stay accessible via sub-path imports to keep
// the entry bundle small.

export type { PlatformAdapter, PlatformKind, NotifyOptions, BridgeControlAPI, WindowControlAPI, UpdateAPI, ClipboardAPI, StorageAPI } from "./lib/platform";
export { PlatformProvider, usePlatform } from "./providers";
