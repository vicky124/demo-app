import { NextFunction, Request, Response } from "express";
import { getClientLimits } from "../config/clients";
import { sendUnauthorized } from "../utils/respond";

const BEARER_PATTERN = /^bearer\s+(.+)$/i;

/**
 * Parses `Authorization: bearer <client-id>`, resolves the client's configured
 * limits, and attaches them to `req.client`. Unknown/missing/malformed clients
 * are rejected with 401 before any rate-limit logic runs.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.header("Authorization");
  const match = header ? BEARER_PATTERN.exec(header.trim()) : null;

  if (!match) {
    sendUnauthorized(res);
    return;
  }

  const clientId = match[1].trim();
  const limits = getClientLimits(clientId);

  if (!limits) {
    sendUnauthorized(res);
    return;
  }

  req.client = { id: clientId, limits };
  next();
}
