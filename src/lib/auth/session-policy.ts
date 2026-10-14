/**
 * Database sessions last 7 days and roll forward at most once a day, so a
 * signed-in person who returns within a week stays signed in, and a lost
 * device stops working within a week of its last use.
 */
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
export const SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60;
