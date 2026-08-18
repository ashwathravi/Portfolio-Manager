DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "portfolios" WHERE "user_id" IS NULL) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23502',
            MESSAGE = 'portfolio ownership migration blocked: unowned portfolios exist',
            HINT = 'Map every portfolios.user_id to an exact auth_users.id before applying migration 0009; never assign legacy portfolios implicitly.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "portfolios" p
        LEFT JOIN "auth_users" u ON u."id" = p."user_id"::text
        WHERE u."id" IS NULL
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23503',
            MESSAGE = 'portfolio ownership migration blocked: portfolio owners do not match Auth.js users',
            HINT = 'Create the intended Auth.js user and explicitly map every legacy portfolio before applying migration 0009.';
    END IF;
END $$;--> statement-breakpoint

ALTER TABLE "portfolios"
    ALTER COLUMN "user_id" SET DATA TYPE text
    USING "user_id"::text;--> statement-breakpoint
ALTER TABLE "portfolios" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "portfolios_user_id_idx" ON "portfolios" USING btree ("user_id");
