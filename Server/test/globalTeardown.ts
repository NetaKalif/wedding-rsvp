export default async function globalTeardown() {
  // Docker container lifecycle is managed manually via test:db:start / test:db:stop.
  // Nothing to do here — leaving the container running so the test server stays connected.
  console.log("\n✅ Test run complete. Run 'npm run test:db:stop' when you're done testing.");
}
