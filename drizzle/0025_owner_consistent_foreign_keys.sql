ALTER TABLE "plaid_items" ADD CONSTRAINT "plaid_items_id_user_key" UNIQUE("id","user_id");--> statement-breakpoint
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_id_user_key" UNIQUE("id","user_id");--> statement-breakpoint
ALTER TABLE "order_plans" DROP CONSTRAINT "order_plans_portfolio_id_portfolios_id_fk";--> statement-breakpoint
ALTER TABLE "plaid_accounts" DROP CONSTRAINT "plaid_accounts_plaid_item_record_id_plaid_items_id_fk";--> statement-breakpoint
ALTER TABLE "order_plans" ADD CONSTRAINT "order_plans_portfolio_owner_fk" FOREIGN KEY ("portfolio_id","user_id") REFERENCES "public"."portfolios"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plaid_accounts" ADD CONSTRAINT "plaid_accounts_item_owner_fk" FOREIGN KEY ("plaid_item_record_id","user_id") REFERENCES "public"."plaid_items"("id","user_id") ON DELETE cascade ON UPDATE no action;
