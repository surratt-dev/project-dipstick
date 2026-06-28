import { config, PORT } from "./config.js";
import { buildApp } from "./app.js";

const app = await buildApp();

try {
  await app.listen({ port: PORT, host: "0.0.0.0" });
  app.log.info(`Server listening on port ${PORT} [${config.NODE_ENV}]`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
