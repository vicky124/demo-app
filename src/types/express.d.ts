import { ClientLimits } from "../config/clients";

declare global {
  namespace Express {
    interface Request {
      client?: {
        id: string;
        limits: ClientLimits;
      };
    }
  }
}

export {};
