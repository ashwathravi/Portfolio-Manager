import { createCronHandler } from "@/lib/jobs/cron";
import { DAILY_JOBS } from "@/lib/jobs/daily-jobs";

export const dynamic = "force-dynamic";
// The price backfill stops itself at 240 s; 300 s is the most Vercel allows
// (Hobby, with Fluid compute).
export const maxDuration = 300;

/** Vercel Cron, weekdays after the close (vercel.json). Needs CRON_SECRET. */
export const GET = createCronHandler({ route: "/api/cron/daily", jobs: DAILY_JOBS });
