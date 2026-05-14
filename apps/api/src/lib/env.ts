import type { AuthEnv } from "@syncany/auth-core";
import type { Subject } from "@syncany/auth-core";

export interface Env extends AuthEnv {
  RATE_LIMITS: KVNamespace;
  USER_GATEWAY: DurableObjectNamespace;
  UPLOADS: R2Bucket;
  MACHINE_KEY_PEPPER: string;
}

export type Variables = { subject: Subject };

import type { Context } from "hono";
/** Typed Hono context used everywhere instead of `: any`. */
export type Ctx = Context<{ Bindings: Env; Variables: Variables }>;
