import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.server.test.env") });

// The test-DB port is parameterized (TEST_PG_PORT, default 5433) so the suite
// can run on machines where 5433 is already taken. .server.test.env hardcodes
// the default port in DATABASE_URL — rewrite it to the actual port so suites
// that open the server's Database in-process connect to the right instance.
if (process.env.TEST_PG_PORT && process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace(
    /localhost:\d+/,
    `localhost:${process.env.TEST_PG_PORT}`,
  );
}
