import Fastify from "fastify";
import cors from "@fastify/cors";
import "dotenv/config";

const app = Fastify({
  logger: true,
});

async function startServer() {
  await app.register(cors, {
    origin: process.env.FRONTEND_URL || true,
  });

  // Basic health check
  app.get("/", async () => {
    return {
      name: "Pelex AI Backend",
      status: "running",
      message: "Pelex AI API is online.",
    };
  });

  // Health endpoint for monitoring
  app.get("/health", async () => {
    return {
      status: "healthy",
      timestamp: new Date().toISOString(),
    };
  });

  const port = Number(process.env.PORT || 3000);

  try {
    await app.listen({
      port,
      host: "0.0.0.0",
    });

    app.log.info(`Pelex AI backend listening on port ${port}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

startServer();