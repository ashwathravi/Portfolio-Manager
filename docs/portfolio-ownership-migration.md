# Portfolio ownership migration

Migration `0009_enforce_portfolio_ownership.sql` makes every portfolio belong to
one exact Auth.js user. It intentionally refuses to guess ownership for legacy
rows.

## Preflight

Before deploying migration 0009, run this against the target database:

```sql
SELECT p.id, p.name, p.user_id, u.email
FROM portfolios p
LEFT JOIN auth_users u ON u.id = p.user_id::text
WHERE p.user_id IS NULL OR u.id IS NULL
ORDER BY p.id;
```

An empty result is ready to migrate. Any returned row requires an
operator-reviewed mapping to an existing `auth_users.id`.

For an Auth.js user whose ID is UUID-shaped, apply each mapping explicitly
before the migration:

```sql
UPDATE portfolios
SET user_id = '<exact-auth-user-uuid>'::uuid
WHERE id = '<exact-portfolio-id>'::uuid;
```

Review every affected portfolio before committing. Do not bulk-map all rows to
the first or only user. If an Auth.js user ID is not UUID-shaped, pause the
deployment and perform an operator-reviewed staged type conversion and mapping;
do not weaken or remove the migration guard.

## Post-migration verification

```sql
SELECT
    count(*) FILTER (WHERE p.user_id IS NULL) AS unowned,
    count(*) FILTER (WHERE u.id IS NULL) AS unmatched
FROM portfolios p
LEFT JOIN auth_users u ON u.id = p.user_id;
```

Both counts must be zero. The application schema then enforces `TEXT NOT NULL`,
the `auth_users(id)` foreign key, and the `portfolios_user_id_idx` lookup index.
