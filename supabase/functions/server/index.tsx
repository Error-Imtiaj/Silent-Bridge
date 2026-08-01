import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import * as kv from "./kv_store.tsx";

const app = new Hono();

app.use('*', logger(console.log));
app.use("/*", cors({
  origin: "*",
  allowHeaders: ["Content-Type", "Authorization"],
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  exposeHeaders: ["Content-Length"],
  maxAge: 600,
}));

app.get("/make-server-a45f9ce8/health", (c) => c.json({ status: "ok" }));

// ── Custom gestures ───────────────────────────────────────────────────────────
app.get("/make-server-a45f9ce8/gestures", async (c) => {
  return c.json(await kv.get("custom_gestures") ?? []);
});
app.post("/make-server-a45f9ce8/gestures", async (c) => {
  const body = await c.req.json();
  await kv.set("custom_gestures", body);
  return c.json({ ok: true });
});

// ── Community signs ───────────────────────────────────────────────────────────
app.get("/make-server-a45f9ce8/community-signs", async (c) => {
  return c.json(await kv.get("community_signs") ?? []);
});
app.post("/make-server-a45f9ce8/community-signs", async (c) => {
  const body = await c.req.json();
  const existing: any[] = await kv.get("community_signs") ?? [];
  const updated = [body.sign, ...existing].slice(0, 200);
  await kv.set("community_signs", updated);
  return c.json({ ok: true });
});
app.put("/make-server-a45f9ce8/community-signs", async (c) => {
  const body = await c.req.json();
  await kv.set("community_signs", body);
  return c.json({ ok: true });
});

Deno.serve(app.fetch);
