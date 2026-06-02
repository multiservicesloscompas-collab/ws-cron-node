export interface PostgresQueryResultRow {
  [key: string]: unknown;
}

export interface PostgresQueryResult {
  rows: PostgresQueryResultRow[];
  rowCount: number | null;
}

export interface PostgresQueryable {
  query: (text: string, values?: unknown[]) => Promise<PostgresQueryResult>;
}

export interface PostgresTransactionClient extends PostgresQueryable {
  release: () => void;
}
