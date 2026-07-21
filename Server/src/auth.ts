import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import { Request, Response, NextFunction, RequestHandler } from "express-serve-static-core";

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

export interface AuthContext {
  userID: string;
  actorUserID: string;
  isAdmin: boolean;
}

declare module "express-serve-static-core" {
  interface Request {
    auth?: AuthContext;
  }
}

export interface GoogleIdentity {
  userID: string;
  email: string;
  name: string;
}

export const verifyGoogleToken = async (
  credential: string,
): Promise<GoogleIdentity> => {
  const ticket = await googleClient.verifyIdToken({
    idToken: credential,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload || !payload.sub || !payload.email) {
    throw new Error("Invalid Google credential");
  }
  return {
    userID: payload.sub,
    email: payload.email,
    name: payload.name ?? payload.email,
  };
};

interface SessionTokenInput {
  userID: string;
  email: string;
  name: string;
  isAdmin: boolean;
  actor?: string;
}

export const issueSessionToken = ({
  userID,
  email,
  name,
  isAdmin,
  actor,
}: SessionTokenInput): string => {
  return jwt.sign(
    { sub: userID, email, name, isAdmin, ...(actor ? { actor } : {}) },
    process.env.JWT_SECRET as string,
    { expiresIn: process.env.JWT_EXPIRES_IN } as jwt.SignOptions,
  );
};

// These serve <img src>/<a href> targets, which can't carry an Authorization
// header — they authenticate themselves via a short-lived ?mediaToken= query
// param instead, verified independently by each route handler.
const MEDIA_ROUTE_PATTERNS = [
  /^\/getImage$/,
  /^\/events\/\d+\/image$/,
  /^\/budget\/files\/\d+\/download$/,
  /^\/export\/my-data\/download$/,
];

export const authenticateMiddleware: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (MEDIA_ROUTE_PATTERNS.some((pattern) => pattern.test(req.path))) {
    return next();
  }

  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;

  if (!token) {
    return res.status(401).send("Missing Authorization header");
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET as string) as {
      sub: string;
      isAdmin: boolean;
      actor?: string;
    };
    req.auth = {
      userID: payload.sub,
      actorUserID: payload.actor ?? payload.sub,
      isAdmin: payload.isAdmin,
    };
    next();
  } catch {
    return res.status(401).send("Invalid or expired token");
  }
};

export const requireAdmin: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!req.auth?.isAdmin) {
    return res.status(403).send("Admin access required");
  }
  next();
};
