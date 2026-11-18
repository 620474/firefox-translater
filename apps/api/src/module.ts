import { Module } from "@nestjs/common";
import { ApiController } from "./controller";
import { AiService } from "./service";

@Module({
  controllers: [ApiController],
  providers: [AiService]
})
export class AppModule {}
