import { Response } from "express";

export function sendSuccess(res: Response): void {
  res.status(200).json({ success: true });
}

export function sendRateLimited(res: Response): void {
  res.status(429).json({ error: "rate limit exceeded" });
}

export function sendUnauthorized(res: Response): void {
  res.status(401).json({ error: "unauthorized" });
}

export function sendUnavailable(res: Response): void {
  res.status(503).json({ error: "rate limiter unavailable" });
}
