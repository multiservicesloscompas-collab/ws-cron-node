import { Pool } from "pg";
import { failure, success, type Result } from "../../types/result.ts";
import type { PostgresClientDeps } from "./get-postgres-env.ts";
import { initializePostgresSchema } from "./initialize-postgres-schema.ts";
import type { PostgresQueryable, PostgresTransactionClient } from "./postgres-types.ts";

export interface PostgresDb {
  pool: PostgresQueryable & { end: () => Promise<void> };
  close: () => Promise<void>;
  runInTransaction: <T>(
    callback: (client: PostgresTransactionClient) => Promise<Result<T, string>>,
  ) => Promise<Result<T, string>>;
}

const rollbackSafely = async (
  client: PostgresTransactionClient,
): Promise<void> => {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Ignore rollback failures to preserve the original error.
  }
};

export const makePostgresDb = async (
  deps: PostgresClientDeps,
): Promise<Result<PostgresDb, string>> => {
  if (!deps.connectionString.trim()) {
    return failure(
      "Falta la conexión de PostgreSQL. Verifica INTERNAL_POSTGRES_URL o DATABASE_URL en .env",
    );
  }

  const pool = new Pool({
    connectionString: deps.connectionString,
    ssl: deps.ssl ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await pool.query("SELECT 1");

    const schemaResult = await initializePostgresSchema(pool);
    if (schemaResult.isFailure) {
      await pool.end();
      return failure(schemaResult.getError());
    }

    const runInTransaction = async <T>(
      callback: (client: PostgresTransactionClient) => Promise<Result<T, string>>,
    ): Promise<Result<T, string>> => {
      const client = await pool.connect() as PostgresTransactionClient;

      try {
        await client.query("BEGIN");
        const result = await callback(client);

        if (result.isFailure) {
          await rollbackSafely(client);
          return failure(result.getError());
        }

        await client.query("COMMIT");
        return result;
      } catch (error) {
        await rollbackSafely(client);
        const reason = error instanceof Error ? error.message : String(error);
        return failure(`Error al ejecutar transacción PostgreSQL: ${reason}`);
      } finally {
        client.release();
      }
    };

    return success({
      pool: pool as unknown as PostgresQueryable & { end: () => Promise<void> },
      close: () => pool.end(),
      runInTransaction,
    });
  } catch (error) {
    await pool.end().catch(() => undefined);
    const reason = error instanceof Error ? error.message : String(error);
    return failure(`Error al inicializar PostgreSQL: ${reason}`);
  }
};
