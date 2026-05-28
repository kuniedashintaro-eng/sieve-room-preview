const QUOTA_KEY = "sieve-room-preview-remaining-generations";
export const GENERATION_LIMIT = 100;

type QuotaMode = "local" | "shared";

type UpstashResponse = {
  result?: string | number | null;
  error?: string;
};

function getRedisConfig() {
  const url =
    process.env.KV_REST_API_URL ??
    process.env.UPSTASH_REDIS_REST_URL ??
    process.env.STORAGE_URL;
  const token =
    process.env.KV_REST_API_TOKEN ??
    process.env.UPSTASH_REDIS_REST_TOKEN ??
    process.env.STORAGE_TOKEN;

  if (!url || !token) {
    return null;
  }

  return {
    token,
    url: url.replace(/\/$/, ""),
  };
}

async function redisCommand(path: string) {
  const config = getRedisConfig();

  if (!config) {
    return null;
  }

  const response = await fetch(`${config.url}${path}`, {
    headers: {
      Authorization: `Bearer ${config.token}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("共有回数カウントに接続できませんでした。");
  }

  const payload = (await response.json()) as UpstashResponse;

  if (payload.error) {
    throw new Error(payload.error);
  }

  return payload.result ?? null;
}

function normalizeRemaining(value: unknown) {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue)) {
    return GENERATION_LIMIT;
  }

  return Math.min(Math.max(Math.trunc(parsedValue), 0), GENERATION_LIMIT);
}

export function getQuotaMode(): QuotaMode {
  return getRedisConfig() ? "shared" : "local";
}

export async function getRemainingGenerations() {
  if (!getRedisConfig()) {
    return null;
  }

  const currentValue = await redisCommand(`/get/${encodeURIComponent(QUOTA_KEY)}`);

  if (currentValue === null) {
    await resetRemainingGenerations();
    return GENERATION_LIMIT;
  }

  return normalizeRemaining(currentValue);
}

export async function decrementRemainingGenerations() {
  if (!getRedisConfig()) {
    return null;
  }

  const currentValue = await getRemainingGenerations();

  if (currentValue === null) {
    return null;
  }

  if (currentValue <= 0) {
    return 0;
  }

  const nextValue = currentValue - 1;
  await redisCommand(`/set/${encodeURIComponent(QUOTA_KEY)}/${nextValue}`);
  return nextValue;
}

export async function resetRemainingGenerations() {
  if (!getRedisConfig()) {
    return null;
  }

  await redisCommand(`/set/${encodeURIComponent(QUOTA_KEY)}/${GENERATION_LIMIT}`);
  return GENERATION_LIMIT;
}
