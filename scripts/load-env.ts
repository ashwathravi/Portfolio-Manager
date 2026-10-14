// Side-effect import for scripts: load env files with the same precedence as
// Next.js (.env.local wins over .env). Variables already set in the shell win
// over both. Import this before anything that reads process.env at load time.
import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });
