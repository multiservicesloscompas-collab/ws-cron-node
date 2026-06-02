export interface PostgresClientDeps {
  connectionString: string;
  ssl: boolean;
}

const parseBooleanEnv = (value: string | undefined): boolean => {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  if (["0", "false", "no", "off", "disable", "disabled"].includes(normalized)) {
    return false;
  }

  return normalized.length > 0;
};

export const getPostgresEnv = (): PostgresClientDeps => ({
  connectionString: process.env.INTERNAL_POSTGRES_URL ??
    process.env.DATABASE_URL ??
    "",
  ssl: parseBooleanEnv(
    process.env.INTERNAL_POSTGRES_SSL ?? process.env.PGSSLMODE,
  ),
});
