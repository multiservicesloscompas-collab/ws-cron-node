import { failure, success, type Result } from "../../types/result.ts";
import type { PostgresQueryable } from "../postgres/postgres-types.ts";

export type ContactKind = "manual" | "system";

export interface InternalContact {
  jid: string;
  name: string;
  kind: ContactKind;
  source: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateContactInput {
  jid: string;
  name: string;
  kind?: ContactKind;
  source?: string | null;
}

export interface UpdateContactInput {
  name: string;
  kind?: ContactKind;
  source?: string | null;
}

export interface ContactsRepositoryDeps {
  database: PostgresQueryable;
}

export interface ContactsRepository {
  list: () => Promise<Result<InternalContact[], string>>;
  findByJid: (jid: string) => Promise<Result<InternalContact | null, string>>;
  create: (input: CreateContactInput) => Promise<Result<InternalContact, string>>;
  upsert: (input: CreateContactInput) => Promise<Result<InternalContact, string>>;
  update: (
    jid: string,
    input: UpdateContactInput,
  ) => Promise<Result<InternalContact, string>>;
  deleteSystemContactsBySourceExceptJid: (
    input: DeleteSystemContactsBySourceExceptJidInput,
  ) => Promise<Result<number, string>>;
  deleteSystemContactsBySourceExceptJids: (
    input: DeleteSystemContactsBySourceExceptJidsInput,
  ) => Promise<Result<number, string>>;
  delete: (jid: string) => Promise<Result<void, string>>;
  withDatabase: (database: PostgresQueryable) => ContactsRepository;
}

export interface DeleteSystemContactsBySourceExceptJidInput {
  source: string;
  keepJid: string;
}

export interface DeleteSystemContactsBySourceExceptJidsInput {
  source: string;
  keepJids: string[];
}

interface ContactRow {
  jid: string;
  name: string;
  kind: ContactKind;
  source: string | null;
  created_at: string;
  updated_at: string;
}

const toContact = (row: ContactRow): InternalContact => ({
  jid: row.jid,
  name: row.name,
  kind: row.kind,
  source: row.source,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const validateInput = (
  jid: string,
  name: string,
): Result<void, string> => {
  if (!jid.trim()) return failure("El JID es obligatorio");
  if (!name.trim()) return failure("El nombre es obligatorio");
  return success(undefined);
};

export const makeContactsRepository = (
  deps: ContactsRepositoryDeps,
): ContactsRepository => {
  const list = async (): Promise<Result<InternalContact[], string>> => {
    try {
      const result = await deps.database.query(`
        SELECT jid, name, kind, source, created_at, updated_at
        FROM internal_contacts
        ORDER BY
          CASE kind WHEN 'system' THEN 0 ELSE 1 END,
          lower(name),
          lower(jid)
      `);
      const rows = result.rows as unknown as ContactRow[];
      return success(rows.map(toContact));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return failure(`Error al listar contactos: ${reason}`);
    }
  };

  const findByJid = async (
    jid: string,
  ): Promise<Result<InternalContact | null, string>> => {
    try {
      const result = await deps.database.query(
        `
          SELECT jid, name, kind, source, created_at, updated_at
          FROM internal_contacts
          WHERE jid = $1
        `,
        [jid],
      );
      const row = result.rows[0] as unknown as ContactRow | undefined;
      return success(row ? toContact(row) : null);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return failure(`Error al buscar contacto: ${reason}`);
    }
  };

  const create = (
    input: CreateContactInput,
  ): Promise<Result<InternalContact, string>> => {
    return (async () => {
      const validationResult = validateInput(input.jid, input.name);
      if (validationResult.isFailure) return failure(validationResult.getError());

      try {
        const now = new Date().toISOString();
        await deps.database.query(
          `
            INSERT INTO internal_contacts (jid, name, kind, source, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6)
          `,
          [
            input.jid.trim(),
            input.name.trim(),
            input.kind ?? "manual",
            input.source ?? null,
            now,
            now,
          ],
        );

        const contactResult = await findByJid(input.jid.trim());
        if (contactResult.isFailure) return failure(contactResult.getError());
        if (!contactResult.getValue()) return failure("Contacto no encontrado");
        return success(contactResult.getValue()!);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (reason.includes("duplicate key") || reason.includes("UNIQUE")) {
          return failure("Ya existe un contacto con ese JID");
        }
        return failure(`Error al crear contacto: ${reason}`);
      }
    })();
  };

  const upsert = (
    input: CreateContactInput,
  ): Promise<Result<InternalContact, string>> => {
    return (async () => {
      const validationResult = validateInput(input.jid, input.name);
      if (validationResult.isFailure) return failure(validationResult.getError());

      try {
        const existingResult = await findByJid(input.jid.trim());
        if (existingResult.isFailure) return failure(existingResult.getError());

        const now = new Date().toISOString();
        const createdAt = existingResult.getValue()?.createdAt ?? now;

        await deps.database.query(
          `
            INSERT INTO internal_contacts (jid, name, kind, source, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT(jid) DO UPDATE SET
              name = excluded.name,
              kind = excluded.kind,
              source = excluded.source,
              updated_at = excluded.updated_at
          `,
          [
            input.jid.trim(),
            input.name.trim(),
            input.kind ?? existingResult.getValue()?.kind ?? "manual",
            input.source ?? existingResult.getValue()?.source ?? null,
            createdAt,
            now,
          ],
        );

        const contactResult = await findByJid(input.jid.trim());
        if (contactResult.isFailure) return failure(contactResult.getError());
        if (!contactResult.getValue()) return failure("Contacto no encontrado");
        return success(contactResult.getValue()!);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return failure(`Error al guardar contacto: ${reason}`);
      }
    })();
  };

  const update = (
    jid: string,
    input: UpdateContactInput,
  ): Promise<Result<InternalContact, string>> => {
    return (async () => {
      const validationResult = validateInput(jid, input.name);
      if (validationResult.isFailure) return failure(validationResult.getError());

      const currentResult = await findByJid(jid.trim());
      if (currentResult.isFailure) return failure(currentResult.getError());

      const current = currentResult.getValue();
      if (!current) return failure("Contacto no encontrado");

      try {
        await deps.database.query(
          `
            UPDATE internal_contacts
            SET name = $1, kind = $2, source = $3, updated_at = $4
            WHERE jid = $5
          `,
          [
            input.name.trim(),
            input.kind ?? current.kind,
            input.source ?? current.source,
            new Date().toISOString(),
            jid.trim(),
          ],
        );

        const contactResult = await findByJid(jid.trim());
        if (contactResult.isFailure) return failure(contactResult.getError());
        if (!contactResult.getValue()) return failure("Contacto no encontrado");
        return success(contactResult.getValue()!);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return failure(`Error al actualizar contacto: ${reason}`);
      }
    })();
  };

  const remove = async (jid: string): Promise<Result<void, string>> => {
    try {
      const result = await deps.database.query(
        `
          DELETE FROM internal_contacts
          WHERE jid = $1
        `,
        [jid.trim()],
      );
      if ((result.rowCount ?? 0) === 0) return failure("Contacto no encontrado");
      return success(undefined);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return failure(`Error al eliminar contacto: ${reason}`);
    }
  };

  const deleteSystemContactsBySourceExceptJid = (
    input: DeleteSystemContactsBySourceExceptJidInput,
  ): Promise<Result<number, string>> => {
    return deleteSystemContactsBySourceExceptJids({
      source: input.source,
      keepJids: [input.keepJid],
    });
  };

  const deleteSystemContactsBySourceExceptJids = (
    input: DeleteSystemContactsBySourceExceptJidsInput,
  ): Promise<Result<number, string>> => {
    return (async () => {
      if (!input.source.trim()) {
        return failure("La fuente es obligatoria");
      }

      const keepJids = Array.from(
        new Set(
          input.keepJids.map((jid) => jid.trim()).filter((jid) => jid.length > 0),
        ),
      );

      try {
        const source = input.source.trim();
        if (keepJids.length === 0) {
          const result = await deps.database.query(
            `
              DELETE FROM internal_contacts
              WHERE kind = 'system'
                AND source = $1
            `,
            [source],
          );
          return success(result.rowCount ?? 0);
        }

        const placeholders = keepJids.map((_, index) => `$${index + 2}`).join(", ");
        const result = await deps.database.query(
          `
            DELETE FROM internal_contacts
            WHERE kind = 'system'
              AND source = $1
              AND jid NOT IN (${placeholders})
          `,
          [source, ...keepJids],
        );

        return success(result.rowCount ?? 0);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return failure(`Error al eliminar contactos del sistema: ${reason}`);
      }
    })();
  };

  return {
    list,
    findByJid,
    create,
    upsert,
    update,
    deleteSystemContactsBySourceExceptJid,
    deleteSystemContactsBySourceExceptJids,
    delete: remove,
    withDatabase: (database) => makeContactsRepository({ database }),
  };
};
