import app from "./app";
import { logger } from "./lib/logger";

if (!process.env.DATABASE_URL) {
  logger.warn("DATABASE_URL is not set; analysis snapshots will not be stored and history requests will be unavailable.");
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const onListen = (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
};

app.listen(port, "127.0.0.1", onListen);
