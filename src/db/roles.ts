/**
 * Database roles. Migration 0010 creates `app_runtime`, a NOLOGIN role that
 * holds the app's table grants and RLS policies. Each environment adds its own
 * LOGIN role as a member of it, so no password ever lives in a migration.
 */
export const APP_RUNTIME_ROLE = "app_runtime";

const ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

export function quoteSqlLiteral(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}

/**
 * SQL that creates a LOGIN role (or resets its password) and makes it a
 * member of app_runtime. CREATE ROLE takes no bind parameters, so the role
 * name must match a strict identifier pattern and the password is quoted as
 * a literal. Used by the local setup and E2E scripts only.
 */
export function buildEnsureAppLoginRoleSql(roleName: string, password: string): string {
    if (!ROLE_NAME.test(roleName)) {
        throw new Error(`Unsupported role name "${roleName}": use lowercase letters, digits and underscores.`);
    }
    if (roleName === APP_RUNTIME_ROLE) {
        throw new Error(`Connect as a separate login role that is a member of ${APP_RUNTIME_ROLE}, not as ${APP_RUNTIME_ROLE} itself.`);
    }
    if (!password) {
        throw new Error(`The login role "${roleName}" needs a password.`);
    }
    if (password.includes("$")) {
        throw new Error("Choose a password without '$' (it would end the DO block's dollar quoting).");
    }

    const literal = quoteSqlLiteral(password);
    return [
        "DO $$",
        "BEGIN",
        `    CREATE ROLE ${roleName} LOGIN PASSWORD ${literal};`,
        "EXCEPTION WHEN duplicate_object THEN",
        `    ALTER ROLE ${roleName} WITH LOGIN PASSWORD ${literal};`,
        "END $$;",
        `GRANT ${APP_RUNTIME_ROLE} TO ${roleName};`,
    ].join("\n");
}

export interface DatabaseLogin {
    user: string;
    password: string;
}

/** The user and password from a postgres:// URL, percent-decoded. */
export function readDatabaseLogin(connectionString: string): DatabaseLogin {
    const parsed = new URL(connectionString);
    return {
        user: decodeURIComponent(parsed.username),
        password: decodeURIComponent(parsed.password),
    };
}
