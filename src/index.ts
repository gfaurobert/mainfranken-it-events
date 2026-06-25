import { buildApp } from "./app.js";

const { app, env } = await buildApp();

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  app.log.info(`Listening on http://0.0.0.0:${env.PORT} (PORT from environment)`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
