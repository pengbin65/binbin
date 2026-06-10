export type AppConfig = {
  port: number;
  hubstudioApiBase: string;
  hubstudioApiToken: string;
  hubstudioProfileName: string;
  sheinNewProductNegotiationUrl: string;
  retryAttempts: number;
  retryDelayMs: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: Number(env.PORT ?? 3210),
    hubstudioApiBase: env.HUBSTUDIO_API_BASE ?? "http://127.0.0.1:6873",
    hubstudioApiToken: env.HUBSTUDIO_API_TOKEN ?? "",
    hubstudioProfileName: env.HUBSTUDIO_PROFILE_NAME ?? "女装希音1",
    sheinNewProductNegotiationUrl: env.SHEIN_NEW_PRODUCT_NEGOTIATION_URL ?? "",
    retryAttempts: Number(env.RETRY_ATTEMPTS ?? 3),
    retryDelayMs: Number(env.RETRY_DELAY_MS ?? 1000)
  };
}
