import { describe, expect, it } from "vitest";
import { apiKeyExpiryBucket, quotaAlertState } from "./notifications.js";

describe("quotaAlertState", () => {
  it("returns warning only after the configured threshold", () => {
    expect(quotaAlertState(79, 100, 80)).toBeUndefined();
    expect(quotaAlertState(80, 100, 80)).toBe("warning");
    expect(quotaAlertState(99, 100, 80)).toBe("warning");
    expect(quotaAlertState(100, 100, 80)).toBe("exceeded");
  });

  it("ignores unlimited or invalid limits", () => {
    expect(quotaAlertState(10, null, 80)).toBeUndefined();
    expect(quotaAlertState(10, 0, 80)).toBeUndefined();
  });
});

describe("apiKeyExpiryBucket", () => {
  const now = new Date("2026-10-06T00:00:00.000Z");

  it("buckets seven-day and one-day warnings", () => {
    expect(apiKeyExpiryBucket(new Date("2026-10-12T00:00:00.000Z"), now)).toBe("expiring_7d");
    expect(apiKeyExpiryBucket(new Date("2026-10-06T12:00:00.000Z"), now)).toBe("expiring_1d");
  });

  it("emits a bounded expired signal", () => {
    expect(apiKeyExpiryBucket(new Date("2026-10-05T12:00:00.000Z"), now)).toBe("expired");
    expect(apiKeyExpiryBucket(new Date("2026-10-04T00:00:00.000Z"), now)).toBeUndefined();
  });

  it("ignores keys outside the seven-day window", () => {
    expect(apiKeyExpiryBucket(new Date("2026-10-20T00:00:00.000Z"), now)).toBeUndefined();
  });
});
