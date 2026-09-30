const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

export async function accountAction(action: "forgot-password" | "reset-password" | "verify-email", body: Record<string, string>): Promise<void> {
  const response = await fetch(`${API_URL}/v1/auth/${action}`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(payload.error?.message ?? "The request could not be completed. Please try again.");
  }
}
