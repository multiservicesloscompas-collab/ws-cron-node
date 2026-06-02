import { newDb } from "pg-mem";
import { failure, success, type Result } from "../../types/result.ts";
import { initializePostgresSchema } from "./initialize-postgres-schema.ts";
import type { PostgresTransactionClient } from "./postgres-types.ts";

export const makeTestPostgresDb = async () => {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();

  const schemaResult = await initializePostgresSchema(pool);
  if (schemaResult.isFailure) {
    throw new Error(schemaResult.getError());
  }

  return {
    pool,
    close: () => pool.end(),
    runInTransaction: async <T>(
      callback: (client: PostgresTransactionClient) => Promise<Result<T, string>>,
    ): Promise<Result<T, string>> => {
      const backup = db.backup();
      const client = await pool.connect() as PostgresTransactionClient;
      try {
        await client.query("BEGIN");
        const result = await callback(client);
        if (result.isFailure) {
          await client.query("ROLLBACK");
          backup.restore();
          return failure(result.getError());
        }
        await client.query("COMMIT");
        return success(result.getValue());
      } catch (error) {
        await client.query("ROLLBACK");
        backup.restore();
        const reason = error instanceof Error ? error.message : String(error);
        return failure(reason);
      } finally {
        client.release();
      }
    },
  };
};
