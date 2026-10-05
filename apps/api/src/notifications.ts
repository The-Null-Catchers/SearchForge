import type { createDatabase } from "@searchforge/db";
import type { Mailer } from "./mailer.js";

type DbPool = ReturnType<typeof createDatabase>["pool"];
type AlertState = "warning" | "exceeded";
type ApiKeyExpiryBucket = "expiring_7d" | "expiring_1d" | "expired";

type DeliveryPayload = Record<string, unknown>;
type DeliveryRow = {
  id: string;
  recipient: string;
  kind: string;
  payload: DeliveryPayload;
  attempts: number;
};

type QuotaCandidateRow = {
  project_id: string;
  project_name: string;
  user_id: string;
  email: string;
  warning_percent: number;
  monthly_searches: string | number | null;
  monthly_api_requests: string | number | null;
  monthly_crawl_pages: string | number | null;
  max_documents: string | number | null;
  searches: string | number;
  api_requests: string | number;
  crawl_pages: string | number;
  documents: string | number;
};

type ApiKeyCandidateRow = {
  api_key_id: string;
  api_key_name: string;
  api_key_kind: string;
  prefix: string;
  expires_at: Date | string;
  project_id: string;
  project_name: string;
  user_id: string;
  email: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DELIVERY_BATCH_SIZE = 20;

function asNumber(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function quotaAlertState(used: number, limit: number | null, warningPercent: number): AlertState | undefined {
  if (limit === null || limit <= 0) return undefined;
  if (used >= limit) return "exceeded";
  return (used / limit) * 100 >= warningPercent ? "warning" : undefined;
}

export function apiKeyExpiryBucket(expiresAt: Date, now = new Date()): ApiKeyExpiryBucket | undefined {
  const remaining = expiresAt.getTime() - now.getTime();
  if (!Number.isFinite(remaining)) return undefined;
  if (remaining <= 0) return remaining >= -DAY_MS ? "expired" : undefined;
  if (remaining <= DAY_MS) return "expiring_1d";
  if (remaining <= 7 * DAY_MS) return "expiring_7d";
  return undefined;
}

function quotaMetricLabel(metric: string): string {
  switch (metric) {
    case "searches": return "monthly searches";
    case "apiRequests": return "monthly API requests";
    case "crawlPages": return "monthly crawl pages";
    case "documents": return "indexed documents";
    default: return metric;
  }
}

function dashboardUrl(publicWebUrl: string, projectId: string): string {
  const url = new URL("/dashboard/usage", publicWebUrl);
  url.searchParams.set("project", projectId);
  return url.toString();
}

export class NotificationService {
  constructor(
    private readonly pool: DbPool,
    private readonly mailer: Pick<Mailer, "sendOperationalAlert">,
    private readonly publicWebUrl: string
  ) {}

  async sweep(now = new Date()): Promise<{ queued: number; sent: number; failed: number }> {
    const queued = await this.discover(now);
    await this.recoverInterruptedClaims();
    const deliveries = await this.claimDue();
    let sent = 0;
    let failed = 0;

    for (const delivery of deliveries) {
      try {
        const { subject, text } = this.renderDelivery(delivery);
        await this.mailer.sendOperationalAlert(delivery.recipient, subject, text);
        await this.markSent(delivery.id);
        sent += 1;
      } catch {
        await this.markFailed(delivery.id, delivery.attempts);
        failed += 1;
      }
    }

    return { queued, sent, failed };
  }

  private async discover(now: Date): Promise<number> {
    const period = now.toISOString().slice(0, 7);
    const [quotaRows, keyRows] = await Promise.all([
      this.pool.query(`
        select
          p.id::text as project_id,
          p.name as project_name,
          u.id::text as user_id,
          u.email,
          pq.warning_percent,
          pq.monthly_searches,
          pq.monthly_api_requests,
          pq.monthly_crawl_pages,
          pq.max_documents,
          coalesce(uc.searches, 0) as searches,
          coalesce(uc.api_requests, 0) as api_requests,
          coalesce(uc.crawl_pages, 0) as crawl_pages,
          coalesce(dc.documents, 0) as documents
        from project_quotas pq
        join projects p on p.id = pq.project_id
        join memberships m on m.organization_id = p.organization_id and m.role in ('owner', 'admin')
        join users u on u.id = m.user_id and u.email_verified_at is not null
        left join usage_counters uc on uc.project_id = p.id and uc.period = $1
        left join lateral (
          select count(*)::bigint as documents
          from documents d
          join indexes i on i.id = d.index_id
          where i.project_id = p.id
            and i.deletion_requested_at is null
            and d.deleted_at is null
        ) dc on true
        where p.deletion_requested_at is null and p.deleted_at is null
      `, [period]),
      this.pool.query(`
        select
          ak.id::text as api_key_id,
          ak.name as api_key_name,
          ak.kind::text as api_key_kind,
          ak.prefix,
          ak.expires_at,
          p.id::text as project_id,
          p.name as project_name,
          u.id::text as user_id,
          u.email
        from api_keys ak
        join projects p on p.id = ak.project_id
        join memberships m on m.organization_id = p.organization_id and m.role in ('owner', 'admin')
        join users u on u.id = m.user_id and u.email_verified_at is not null
        where ak.revoked_at is null
          and ak.expires_at is not null
          and ak.expires_at >= $1::timestamptz - interval '1 day'
          and ak.expires_at <= $1::timestamptz + interval '7 days'
          and p.deletion_requested_at is null
          and p.deleted_at is null
      `, [now])
    ]);

    let queued = 0;
    for (const row of quotaRows.rows as QuotaCandidateRow[]) {
      queued += await this.enqueueQuotaAlerts(row, period);
    }
    for (const row of keyRows.rows as ApiKeyCandidateRow[]) {
      queued += await this.enqueueApiKeyAlert(row, now);
    }
    return queued;
  }

  private async enqueueQuotaAlerts(row: QuotaCandidateRow, period: string): Promise<number> {
    const warningPercent = Number(row.warning_percent);
    const metrics = [
      { metric: "searches", used: asNumber(row.searches) ?? 0, limit: asNumber(row.monthly_searches), monthly: true },
      { metric: "apiRequests", used: asNumber(row.api_requests) ?? 0, limit: asNumber(row.monthly_api_requests), monthly: true },
      { metric: "crawlPages", used: asNumber(row.crawl_pages) ?? 0, limit: asNumber(row.monthly_crawl_pages), monthly: true },
      { metric: "documents", used: asNumber(row.documents) ?? 0, limit: asNumber(row.max_documents), monthly: false }
    ] as const;

    let queued = 0;
    for (const entry of metrics) {
      const state = quotaAlertState(entry.used, entry.limit, warningPercent);
      if (!state || entry.limit === null) continue;
      const scope = entry.monthly ? period : `limit-${entry.limit}-warning-${warningPercent}`;
      const dedupeKey = `quota:${scope}:${row.project_id}:${entry.metric}:${state}:${row.user_id}`;
      queued += await this.insertReceipt({
        dedupeKey,
        projectId: row.project_id,
        userId: row.user_id,
        recipient: row.email,
        kind: `quota_${state}`,
        payload: {
          projectId: row.project_id,
          projectName: row.project_name,
          metric: entry.metric,
          metricLabel: quotaMetricLabel(entry.metric),
          used: entry.used,
          limit: entry.limit,
          percent: Math.round((entry.used / entry.limit) * 1000) / 10,
          period: entry.monthly ? period : null,
          url: dashboardUrl(this.publicWebUrl, row.project_id)
        }
      });
    }
    return queued;
  }

  private async enqueueApiKeyAlert(row: ApiKeyCandidateRow, now: Date): Promise<number> {
    const expiresAt = new Date(row.expires_at);
    const bucket = apiKeyExpiryBucket(expiresAt, now);
    if (!bucket) return 0;
    const dedupeKey = `api-key:${row.api_key_id}:${bucket}:${row.user_id}`;
    return this.insertReceipt({
      dedupeKey,
      projectId: row.project_id,
      userId: row.user_id,
      recipient: row.email,
      kind: bucket === "expired" ? "api_key_expired" : "api_key_expiring",
      payload: {
        projectId: row.project_id,
        projectName: row.project_name,
        apiKeyId: row.api_key_id,
        apiKeyName: row.api_key_name,
        apiKeyKind: row.api_key_kind,
        prefix: row.prefix,
        expiresAt: expiresAt.toISOString(),
        bucket,
        url: dashboardUrl(this.publicWebUrl, row.project_id)
      }
    });
  }

  private async insertReceipt(input: {
    dedupeKey: string;
    projectId: string;
    userId: string;
    recipient: string;
    kind: string;
    payload: DeliveryPayload;
  }): Promise<number> {
    const result = await this.pool.query(`
      insert into notification_deliveries (
        dedupe_key, project_id, recipient_user_id, recipient, kind, payload
      ) values ($1, $2::uuid, $3::uuid, $4, $5, $6::jsonb)
      on conflict (dedupe_key) do nothing
      returning id
    `, [input.dedupeKey, input.projectId, input.userId, input.recipient, input.kind, JSON.stringify(input.payload)]);
    return result.rowCount ?? 0;
  }

  private async recoverInterruptedClaims(): Promise<void> {
    await this.pool.query(`
      update notification_deliveries
      set state = 'failed', claimed_at = null, next_attempt_at = now(),
          last_error = 'delivery_interrupted', updated_at = now()
      where state = 'sending'
        and claimed_at < now() - interval '15 minutes'
    `);
  }

  private async claimDue(): Promise<DeliveryRow[]> {
    const result = await this.pool.query(`
      with due as (
        select id
        from notification_deliveries
        where state in ('pending', 'failed')
          and next_attempt_at <= now()
        order by next_attempt_at asc, created_at asc
        for update skip locked
        limit ${DELIVERY_BATCH_SIZE}
      )
      update notification_deliveries n
      set state = 'sending', claimed_at = now(), attempts = n.attempts + 1, updated_at = now()
      from due
      where n.id = due.id
      returning n.id::text, n.recipient, n.kind, n.payload, n.attempts
    `);
    return result.rows as DeliveryRow[];
  }

  private renderDelivery(delivery: DeliveryRow): { subject: string; text: string } {
    const payload = delivery.payload;
    if (delivery.kind === "quota_warning" || delivery.kind === "quota_exceeded") {
      const exceeded = delivery.kind === "quota_exceeded";
      return {
        subject: exceeded ? "SearchForge quota exceeded" : "SearchForge quota warning",
        text: [
          exceeded ? "A SearchForge project quota has been exceeded." : "A SearchForge project is approaching a configured quota.",
          "",
          `Project: ${String(payload.projectName ?? payload.projectId ?? "Unknown")}`,
          `Metric: ${String(payload.metricLabel ?? payload.metric ?? "usage")}`,
          `Usage: ${String(payload.used ?? "?")} / ${String(payload.limit ?? "?")} (${String(payload.percent ?? "?")}%)`,
          "",
          `Review usage and limits: ${String(payload.url ?? this.publicWebUrl)}`
        ].join("\n")
      };
    }

    const expired = delivery.kind === "api_key_expired";
    return {
      subject: expired ? "SearchForge API key expired" : "SearchForge API key expires soon",
      text: [
        expired ? "A SearchForge API key has expired." : "A SearchForge API key is nearing its expiration time.",
        "",
        `Project: ${String(payload.projectName ?? payload.projectId ?? "Unknown")}`,
        `Key: ${String(payload.apiKeyName ?? "Unnamed key")} (${String(payload.apiKeyKind ?? "unknown")})`,
        `Prefix: ${String(payload.prefix ?? "unknown")}`,
        `Expires at: ${String(payload.expiresAt ?? "unknown")}`,
        "",
        `Review API keys: ${String(payload.url ?? this.publicWebUrl)}`
      ].join("\n")
    };
  }

  private async markSent(id: string): Promise<void> {
    await this.pool.query(`
      update notification_deliveries
      set state = 'sent', sent_at = now(), claimed_at = null, last_error = null, updated_at = now()
      where id = $1::uuid
    `, [id]);
  }

  private async markFailed(id: string, attempts: number): Promise<void> {
    const retryMinutes = Math.min(360, 2 ** Math.min(Math.max(attempts, 1), 8));
    await this.pool.query(`
      update notification_deliveries
      set state = 'failed', claimed_at = null,
          next_attempt_at = now() + ($2::text || ' minutes')::interval,
          last_error = 'delivery_failed', updated_at = now()
      where id = $1::uuid
    `, [id, String(retryMinutes)]);
  }
}
