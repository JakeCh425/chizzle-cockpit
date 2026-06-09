import "dotenv/config";
import express, { Response, NextFunction } from 'express';
import type { Request } from 'express';
import { registerRoutes } from "./routes";
import { initStorage, storage } from "./storage";
import { _updateRegimeCache } from "./regimeService";
import { startSMA20AlertEngine } from "./sma20Alerts";
import { startConfirmationDetector } from "./confirmationDetector";
import { serveStatic } from "./static";
import { createServer } from "node:http";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

// Health check endpoint (Render pings this)
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    mode: process.env.LOW_CREDIT_MODE === "true" ? "low-credit" : "normal",
    schedulersDisabled: process.env.LOW_CREDIT_MODE === "true",
    testMode: process.env.VITE_TEST_MODE === "true",
    testModeRaw: process.env.VITE_TEST_MODE ?? null,
    uptime: process.uptime(),
    now: new Date().toISOString(),
  });
});

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Initialize DB schema + seed before anything else
  await initStorage();

  // Warm the regime cache so getEffectiveRegime() works synchronously
  try {
    const regState = await storage.getRegimeState();
    _updateRegimeCache(regState);
  } catch (e) {
    console.warn("[boot] Could not warm regime cache:", e);
  }

  await registerRoutes(httpServer, app);

  // Kick off the SMA20 alert engine (no-op if watchlist is empty).
  // Honors LOW_CREDIT_MODE — pauses background scans there.
  if (process.env.LOW_CREDIT_MODE !== "true") {
    try { startSMA20AlertEngine(); } catch (e) { console.warn("[boot] sma20 engine failed:", e); }
    try { startConfirmationDetector(); } catch (e) { console.warn("[boot] confirmation detector failed:", e); }
  }

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(port, "0.0.0.0", () => {
    log(`serving on port ${port} (${process.env.NODE_ENV || "development"})`);
  });
})();
