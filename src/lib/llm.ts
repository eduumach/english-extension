// OpenAI-compatible chat client, shared by the background and the hub.
// DeepSeek is the default; any provider exposing /chat/completions
// (OpenAI, OpenRouter, Groq, ...) works by changing baseUrl and model.
export const LLM_KEY = "llm";
export const DEFAULT_LLM = {
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-chat",
  apiKey: "",
};

export type LlmConfig = typeof DEFAULT_LLM;

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export async function getLlmConfig(): Promise<LlmConfig> {
  const data = await browser.storage.local.get(LLM_KEY);
  return { ...DEFAULT_LLM, ...(data[LLM_KEY] || {}) };
}

export async function chatJSON(
  messages: ChatMessage[],
  { temperature = 0.7, timeoutMs = 60000 } = {},
): Promise<any> {
  const cfg = await getLlmConfig();
  if (!cfg.apiKey) throw new Error("no-api-key");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature,
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
    }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("empty LLM response");
    return JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } finally {
    clearTimeout(timer);
  }
}
