export type AppConfig = {
  port: number;
  hubstudioApiBase: string;
  hubstudioApiToken: string;
  hubstudioProfileNames: string[];
  sheinNewProductNegotiationUrl: string;
  retryAttempts: number;
  retryDelayMs: number;
};

function parsePositiveInteger(name: string, value: string | undefined, defaultValue: number): number {
  const rawValue = value ?? String(defaultValue);
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a finite positive integer`);
  }
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: parsePositiveInteger("PORT", env.PORT, 3210),
    hubstudioApiBase: env.HUBSTUDIO_API_BASE ?? "http://127.0.0.1:6873",
    hubstudioApiToken: env.HUBSTUDIO_API_TOKEN ?? "",
    hubstudioProfileNames: parseProfileNames(env.HUBSTUDIO_PROFILE_NAMES ?? env.HUBSTUDIO_PROFILE_NAME),
    sheinNewProductNegotiationUrl: env.SHEIN_NEW_PRODUCT_NEGOTIATION_URL ?? "",
    retryAttempts: parsePositiveInteger("RETRY_ATTEMPTS", env.RETRY_ATTEMPTS, 3),
    retryDelayMs: parsePositiveInteger("RETRY_DELAY_MS", env.RETRY_DELAY_MS, 1000)
  };
}

function parseProfileNames(value: string | undefined): string[] {
  const names = (value ?? "女装希音1")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

  return names.length > 0 ? names : ["女装希音1"];
}
