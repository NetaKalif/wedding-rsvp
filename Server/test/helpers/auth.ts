import jwt from "jsonwebtoken";

export const TEST_USER_ID = "test-user-id";

/**
 * Signs a session token identical in shape to what /auth/google issues,
 * using the same JWT_SECRET the live test server reads from .server.test.env.
 * Tests don't have a real Google credential, so this skips that endpoint entirely.
 */
export const signTestToken = (
  userID: string = TEST_USER_ID,
  overrides: { isAdmin?: boolean } = {},
): string =>
  jwt.sign(
    { sub: userID, email: `${userID}@test.com`, name: userID, isAdmin: false, ...overrides },
    process.env.JWT_SECRET as string,
    { expiresIn: "1h" },
  );

export const authHeader = (userID: string = TEST_USER_ID, overrides: { isAdmin?: boolean } = {}) => ({
  Authorization: `Bearer ${signTestToken(userID, overrides)}`,
});
