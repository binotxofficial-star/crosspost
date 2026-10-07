export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** fetch() that throws a readable error for non-2xx responses and parses JSON bodies. */
export async function fetchJson<T>(url: string, init: RequestInit = {}, label = "Request"): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    // keep the raw text
  }
  if (!res.ok) throw new ApiError(`${label} failed (${res.status}): ${describe(body)}`, res.status);
  return body as T;
}

function describe(body: unknown): string {
  if (typeof body === "string") return body.slice(0, 300) || "empty response";
  const b = body as Record<string, unknown>;
  const err = b.error as Record<string, unknown> | string | undefined;
  if (typeof err === "string") return [err, b.error_description].filter(Boolean).join(": ");
  if (err && typeof err === "object") {
    const msg = err.message || err.code;
    if (msg) return String(msg);
  }
  return JSON.stringify(body).slice(0, 300);
}

export function form(values: Record<string, string>): URLSearchParams {
  return new URLSearchParams(values);
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
