/**
 * Review config persistence and provider presets.
 * Used by the Settings page to configure AI provider credentials.
 */

export interface ReviewConfig {
  gatewayBaseUrl: string;
  gatewayApiKey: string;
  gatewayModel: string;
  reviewTone: string;
  customRules?: string[];
}

const STORAGE_KEY = "codevetter_review_config";

export function loadReviewConfig(): ReviewConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const config = JSON.parse(raw) as ReviewConfig;
    if (!config.gatewayApiKey || !config.gatewayBaseUrl) return null;
    return config;
  } catch {
    return null;
  }
}

export function saveReviewConfig(config: ReviewConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export const PROVIDER_PRESETS: Record<string, { baseUrl: string; model: string }> = {
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-20250514",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o",
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    model: "anthropic/claude-sonnet-4-20250514",
  },
};
