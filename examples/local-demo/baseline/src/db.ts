export type Row = Record<string, string | number>;

export type Db = {
  query: (sql: string, params?: (string | number)[]) => Promise<Row[]>;
};
