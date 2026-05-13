// Vercel serverless function — Hono fetch adapter
import app from "../src/api/index.js";

export const config = { runtime: "nodejs" };

export default async function handler(req: Request): Promise<Response> {
  return app.fetch(req);
}
