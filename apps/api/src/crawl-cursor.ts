import { createHash } from "node:crypto";
import { z } from "zod";
import { AppError } from "@searchforge/shared";

export function crawlCursorScope(sourceId: string, status: string | undefined, q: string, jobId?: string) {
  return createHash("sha256").update(JSON.stringify({ sourceId, status: status ?? "", q, jobId: jobId ?? "" })).digest("hex");
}
export function encodeCrawlCursor(createdAt: Date | string, id: string, scope: string) {
  return Buffer.from(JSON.stringify({ createdAt: typeof createdAt === "string" ? createdAt : createdAt.toISOString(), id, scope })).toString("base64url");
}
export function decodeCrawlCursor(value: string, scope: string) {
  try {
    if (value.length > 1000 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid encoding");
    const cursor = z.object({ createdAt: z.iso.datetime(), id: z.string().uuid(), scope: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
      .parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    if (cursor.scope !== scope) throw new Error("Cursor belongs to different filters");
    return { createdAt: cursor.createdAt, id: cursor.id };
  } catch { throw new AppError("VALIDATION_ERROR", "Invalid cursor or changed crawl filters", 400); }
}
