import { BadGatewayException, BadRequestException, Injectable } from "@nestjs/common";

type Provider = "gemini" | "deepseek" | "openai";
type Data = Record<string, any>;

@Injectable()
export class AiService {
  private validate(provider: unknown, model: unknown, key: string | undefined): {
    provider: Provider; model: string; key: string
  } {
    if (provider !== "gemini" && provider !== "deepseek" && provider !== "openai") {
      throw new BadRequestException("Unsupported provider");
    }
    if (typeof key !== "string" || key.length < 6 || key.length > 500) {
      throw new BadRequestException("X-Provider-Api-Key is required");
    }
    if (typeof model !== "string" || !/^[a-zA-Z0-9._/:+-]{2,100}$/.test(model)) {
      throw new BadRequestException("Invalid model");
    }
    return { provider, model, key };
  }

  private async request(url: string, headers: Record<string, string>, body?: object): Promise<Data> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    try {
      const response = await fetch(url, {
        method: body ? "POST" : "GET",
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
      const data: Data = await response.json().catch(() => ({}));
      if (!response.ok) {
        // Do not echo sensitive upstream bodies or the user's API key in errors.
        throw new BadGatewayException("Provider returned HTTP " + response.status);
      }
      return data;
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      throw new BadGatewayException("AI provider request failed");
    } finally {
      clearTimeout(timer);
    }
  }

  async generate(
    apiKey: string | undefined,
    body: { provider?: unknown; model?: unknown; prompt?: unknown }
  ): Promise<{ text: string }> {
    const { provider, model, key } = this.validate(body?.provider, body?.model, apiKey);
    if (typeof body?.prompt !== "string" || !body.prompt.trim() || body.prompt.length > 100000) {
      throw new BadRequestException("Invalid prompt");
    }
    let text: unknown;
    if (provider === "gemini") {
      const name = encodeURIComponent(model.replace(/^models\//, ""));
      const data = await this.request(
        "https://generativelanguage.googleapis.com/v1beta/models/" + name + ":generateContent",
        { "Content-Type": "application/json", "x-goog-api-key": key },
        { contents: [{ parts: [{ text: body.prompt }] }] }
      );
      text = (data.candidates?.[0]?.content?.parts || [])
        .map((part: { text?: string }) => part.text || "").join("");
    } else {
      const endpoint = provider === "deepseek"
        ? "https://api.deepseek.com/chat/completions"
        : "https://api.openai.com/v1/chat/completions";
      const data = await this.request(endpoint, {
        "Content-Type": "application/json", Authorization: "Bearer " + key
      }, {
        model,
        messages: [{ role: "user", content: body.prompt }]
      });
      text = data.choices?.[0]?.message?.content;
    }
    if (typeof text !== "string" || !text) {
      throw new BadGatewayException("Provider returned no text");
    }
    return { text };
  }

  async models(apiKey: string | undefined, provider: string): Promise<{ models: string[] }> {
    const { key } = this.validate(provider, "placeholder-model", apiKey);
    const names: string[] = [];
    if (provider === "gemini") {
      let page = "";
      for (let i = 0; i < 10; i++) {
        const url = "https://generativelanguage.googleapis.com/v1beta/models?pageSize=100" +
          (page ? "&pageToken=" + encodeURIComponent(page) : "");
        const data = await this.request(url, { "x-goog-api-key": key });
        names.push(...(data.models || []).filter((m: Data) =>
          (m.supportedGenerationMethods || []).includes("generateContent")
        ).map((m: Data) => String(m.name).replace(/^models\//, "")));
        page = data.nextPageToken || "";
        if (!page) break;
      }
    } else {
      const endpoint = provider === "deepseek"
        ? "https://api.deepseek.com/models" : "https://api.openai.com/v1/models";
      const data = await this.request(endpoint, { Authorization: "Bearer " + key });
      names.push(...(data.data || []).map((m: Data) => m.id).filter((id: string) =>
        provider === "deepseek" || /^(gpt-|o[1-9]|chatgpt-)/i.test(id)));
    }
    return { models: [...new Set(names)].sort() };
  }
}
