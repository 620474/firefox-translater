import { Body, Controller, Get, Headers, Post, Query } from "@nestjs/common";
import { AiService } from "./service";

@Controller("api")
export class ApiController {
  constructor(private readonly ai: AiService) {}

  @Get("health")
  health(): { status: string } {
    return { status: "ok" };
  }

  @Post("generate")
  generate(
    @Headers("x-provider-api-key") apiKey: string | undefined,
    @Body() body: {
      provider?: unknown; model?: unknown; system?: unknown;
      prompt?: unknown; mode?: unknown
    }
  ): Promise<{ text: string }> {
    return this.ai.generate(apiKey, body);
  }

  @Get("models")
  models(
    @Headers("x-provider-api-key") apiKey: string | undefined,
    @Query("provider") provider: string
  ): Promise<{ models: string[] }> {
    return this.ai.models(apiKey, provider);
  }
}
