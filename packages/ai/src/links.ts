import type { ProviderId } from "./types";

/** 연결 화면의 안내 링크(2026-09-29 확인). OpenAI 페이지는 자동 요청을 막지만 브라우저에서는 열린다. */
export const PROVIDER_LINKS: Record<
  ProviderId,
  { name: string; apiKeyUrl: string; apiKeyNote: string; subscriptionUrl?: string; installUrl?: string }
> = {
  claude: {
    name: "Claude",
    apiKeyUrl: "https://console.anthropic.com/settings/keys",
    apiKeyNote: "Anthropic Console → API Keys → Create Key",
    subscriptionUrl: "https://claude.com/pricing",
    installUrl: "https://docs.claude.com/en/docs/claude-code/setup",
  },
  codex: {
    name: "Codex (OpenAI)",
    apiKeyUrl: "https://platform.openai.com/api-keys",
    apiKeyNote: "OpenAI Platform → API keys → Create new secret key",
    subscriptionUrl: "https://chatgpt.com/pricing",
  },
  muse: {
    name: "Muse Spark",
    apiKeyUrl: "https://dev.meta.ai/docs/muse-code",
    apiKeyNote: "Meta Model API 콘솔에서 키 발급(결제 등록 필요)",
    subscriptionUrl: "https://dev.meta.ai/docs/muse-code/subscriptions",
  },
  gemini: {
    name: "Gemini",
    apiKeyUrl: "https://aistudio.google.com/apikey",
    apiKeyNote: "Google AI Studio → Get API key (무료 키는 Flash 모델만)",
  },
};
