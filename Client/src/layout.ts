/**
 * Full-screen workspace routes own the whole viewport (height: 100vh, no page
 * scroll), so the app shell must not render the site footer on them.
 */
export const isFullScreenRoute = (pathname: string): boolean =>
  pathname === "/seating";
