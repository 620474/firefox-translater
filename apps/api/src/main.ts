import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: true });
  // The browser extension has an unstable moz-extension:// origin on Android.
  // All requests use the user's own provider key: the server keeps no AI secrets.
  const allowed = process.env.CORS_ORIGINS?.split(",").map(x => x.trim()).filter(Boolean);
  app.enableCors({
    origin: allowed?.length
      ? (origin, callback) => callback(null, !origin || allowed.includes(origin))
      : true,
    allowedHeaders: ["Content-Type", "X-Provider-Api-Key"],
    methods: ["GET", "POST", "OPTIONS"]
  });
  const port = Number(process.env.PORT || 3000);
  await app.listen(port, "0.0.0.0");
}
bootstrap().catch(error => {
  console.error("Could not start NestJS API", error);
  process.exitCode = 1;
});
