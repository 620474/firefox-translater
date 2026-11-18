import { BadGatewayException, BadRequestException, Injectable } from "@nestjs/common";

type Provider = "gemini" | "deepseek" | "openai";
type Mode = "text" | "json";
type Data = Record<string, any>;
type GenerateBody = {
  provider?: unknown;
  model?: unknown;
  prompt?: unknown;
  system?: unknown;
  mode?: unknown;
};

@Injectable()
export class AiService {
  private validate(provider: unknown, model: unknown, apiKey: string | undefined): {
    provider: Provider; model: string; key: string
  } {
    if (provider !== "gemini" && provider !== "deepseek" && provider !== "openai") {
      throw new BadRequestException("Unsupported provider");
    }
    if (typeof apiKey !== "string" || apiKey.length < 6 || apiKey.length > 500) {
      throw new BadRequestException("X-Provider-Api-Key is required");
    }
    if (typeof model !== "string" || !/^[a-zA-Z0-9._/:+-]{2,100}$/.test(model)) {
      throw new BadRequestException("Invalid model");
    }
    return { provider, model, key: apiKey };
  }

  private async request(
    url: string, headers: Record<string, string>, body?: object
  ): Promise<Data> {
    for (let attempt = 0; attempt <= 2; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60000);
      try {
        const response = await fetch(url, {
          method: body ? "POST" : "GET",
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal
        });
        const data: Data = await response.json().catch(() => ({}));
        if (response.ok) return data;
        if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, 900 * 2 ** attempt));
          continue;
        }
        // Never echo the upstream body: providers occasionally echo user-supplied prompts.
        throw new BadGatewayException("Provider returned HTTP " + response.status);
      } catch (error) {
        if (error instanceof BadGatewayException) throw error;
        if (attempt === 2) throw new BadGatewayException("Provider request failed");
        await new Promise(resolve => setTimeout(resolve, 900 * 2 ** attempt));
      } finally {
        clearTimeout(timer);
      }
    }
    throw new BadGatewayException("Provider request failed");
  }

  async generate(
    apiKey: string | undefined, body: GenerateBody
  ): Promise<{ text: string }> {
    const { provider, model, key } = this.validate(body?.provider, body?.model, apiKey);
    const mode: Mode = body?.mode === "json" ? "json" : "text";
    if (body?.mode !== undefined && body.mode !== "json" && body.mode !== "text") {
      throw new BadRequestException("Unsupported response mode");
    }
    if (typeof body?.prompt !== "string" || !body.prompt.trim() || body.prompt.length > 100000) {
      throw new BadRequestException("Invalid prompt");
    }
    if (typeof body?.system !== "string" || !body.system.trim() || body.system.length > 6000) {
      throw new BadRequestException("Missing system instructions");
    }

    let answer: unknown;
    if (provider === "gemini") {
      const name = encodeURIComponent(model.replace(/^models\//, ""));
      const url = "https://generativelanguage.googleapis.com/v1beta/models/" +
        name + ":generateContent";
      const headers = { "Content-Type": "application/json", "x-goog-api-key": key };
      const payload: Data = {
        systemInstruction: { parts: [{ text: body.system }] },
        contents: [{ parts: [{ text: body.prompt }] }]
      };
      if (mode === "json") payload.generationConfig = { responseMimeType: "application/json" };
      let data: Data;
      try {
        data = await this.request(url, headers, payload);
      } catch (error) {
        if (mode !== "json" || !(error instanceof BadGatewayException) ||
          !error.message.includes("400")) throw error;
        delete payload.generationConfig;
        data = await this.request(url, headers, payload);
      }
      answer = (data.candidates?.[0]?.content?.parts || [])
        .map((part: { text?: string }) => part.text || "").join("");
    } else {
      const url = provider === "deepseek"
        ? "https://api.deepseek.com/chat/completions"
        : "https://api.openai.com/v1/chat/completions";
      const headers = {
        "Content-Type": "application/json",
        Authorization: "Bearer " + key
      };
      const payload: Data = {
        model,
        messages: [
          { role: "system", content: body.system },
          { role: "user", content: body.prompt }
        ]
      };
      if (mode === "json") payload.response_format = { type: "json_object" };
      let data: Data;
      try {
        data = await this.request(url, headers, payload);
      } catch (error) {
        if (mode !== "json" || !(error instanceof BadGatewayException) ||
          !error.message.includes("400")) throw error;
        delete payload.response_format;
        data = await this.request(url, headers, payload);
      }
      answer = data.choices?.[0]?.message?.content;
    }
    if (typeof answer !== "string" || !answer) {
      throw new BadGatewayException("Provider returned no text");
    }
    return { text: answer };
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
      const url = provider === "deepseek"
        ? "https://api.deepseek.com/models" : "https://api.openai.com/v1/models";
      const data = await this.request(url, { Authorization: "Bearer " + key });
      names.push(...(data.data || []).map((m: Data) => m.id).filter((id: string) =>
        provider === "deepseek" || /^(gpt-|o[1-9]|chatgpt-)/i.test(id)));
    }
    return { models: [...new Set(names)].sort() };
  }
}
