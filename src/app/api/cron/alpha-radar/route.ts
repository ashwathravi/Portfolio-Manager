import { ALPHA_RADAR_JOBS } from "@/lib/alpha-radar/daily-refresh";
import { createCronHandler } from "@/lib/jobs/cron";

export const dynamic = "force-dynamic";
// The job starts no filer after 240 s; 300 s is the most Vercel allows
// (Hobby, with Fluid compute).
export const maxDuration = 300;

/** Vercel Cron, once a day (vercel.json): Alpha Radar's SEC filings (launch item i60). Needs CRON_SECRET. */
export const GET = createCronHandler({ route: "/api/cron/alpha-radar", jobs: ALPHA_RADAR_JOBS });
