# Local and GitHub database secrets

`DATABASE_URL` is a server-only Supabase Postgres credential. A real credential must not be placed in source control, `.env.example`, client-side code, or a `NEXT_PUBLIC_*` variable.

## Local macOS development

Store the connection string in the login Keychain. The command prompts without putting the value in shell history or process arguments:

```bash
npm run keychain:store
```

Start the app with the Keychain value injected only into that process:

```bash
npm run dev:keychain
# or
npm run start:keychain
```

The default Keychain service is `atlas-wealth/DATABASE_URL`, with the current macOS user as the account. To use a different item, set `ATLAS_WEALTH_KEYCHAIN_SERVICE` and/or `ATLAS_WEALTH_KEYCHAIN_ACCOUNT` consistently for both commands.

## GitHub Actions

After storing the value locally and authenticating GitHub CLI, transfer it directly from Keychain to an encrypted repository secret:

```bash
npm run keychain:sync-github
```

The default target is `ashwathravi/Portfolio-Manager`. Set `GITHUB_REPOSITORY=OWNER/REPO` to target another repository. For a GitHub Actions environment secret, also set `GITHUB_ENVIRONMENT`, for example:

```bash
GITHUB_ENVIRONMENT=staging npm run keychain:sync-github
```

The workflow passes the secret only to the Next.js build step. The E2E job intentionally keeps its isolated local Postgres service and does not use the Supabase credential. Pull requests from forks also do not receive repository secrets, which is expected GitHub behavior.

Neither helper prints the connection string or writes it to a file. Rotate the Supabase database password if the credential may have been exposed.
