import * as SQLite from "expo-sqlite";

const DB_NAME = "check-the-tag.db";
let dbPromise = null;

async function getDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const database = await SQLite.openDatabaseAsync(DB_NAME);
      await database.execAsync(
        `CREATE TABLE IF NOT EXISTS prices (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          item TEXT NOT NULL,
          brand TEXT,
          price REAL NOT NULL,
          weight TEXT,
          storeName TEXT NOT NULL
        );`
      );
      await database.execAsync(
        `CREATE INDEX IF NOT EXISTS idx_prices_item ON prices(item);`
      );
      return database;
    })();
  }
  return dbPromise;
}

export async function initDb() {
  await getDb();
}

export async function insertPriceRow({ item, brand, price, weight, storeName }) {
  const normalizedItem = (item ?? "").trim();
  const normalizedBrand = (brand ?? "").trim();
  const normalizedWeight = (weight ?? "").trim();
  const normalizedStore = (storeName ?? "").trim();
  const numericPrice = Number(price);

  if (!normalizedItem) throw new Error("insertPriceRow: item is required");
  if (!normalizedStore) throw new Error("insertPriceRow: storeName is required");
  if (!Number.isFinite(numericPrice))
    throw new Error("insertPriceRow: price must be a number");

  const db = await getDb();
  const result = await db.runAsync(
    `INSERT INTO prices (item, brand, price, weight, storeName)
     VALUES (?, ?, ?, ?, ?);`,
    [
      normalizedItem,
      normalizedBrand || null,
      numericPrice,
      normalizedWeight || null,
      normalizedStore,
    ]
  );

  return result.lastInsertRowId;
}

export async function insertManyPriceRows(rows, storeName) {
  if (!Array.isArray(rows)) return [];
  const db = await getDb();
  const ids = [];

  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const row of rows) {
      const item = (row?.item ?? "").trim();
      const brand = (row?.brand ?? "").trim();
      const weight = (row?.weight ?? "").trim();
      const price = Number(row?.price);
      const store = (storeName ?? "").trim();

      if (!item || !store || !Number.isFinite(price)) continue;

      const result = await txn.runAsync(
        `INSERT INTO prices (item, brand, price, weight, storeName)
         VALUES (?, ?, ?, ?, ?);`,
        [item, brand || null, price, weight || null, store]
      );
      ids.push(result.lastInsertRowId);
    }
  });

  return ids;
}

export async function getCheapestOtherStoreForItem(item, currentStoreName) {
  const normalizedItem = (item ?? "").trim();
  const normalizedStore = (currentStoreName ?? "").trim();
  if (!normalizedItem) return null;

  const db = await getDb();
  const row = await db.getFirstAsync(
    `SELECT item, brand, price, weight, storeName
     FROM prices
     WHERE item = ?
       AND storeName <> ?
     ORDER BY price ASC
     LIMIT 1;`,
    [normalizedItem, normalizedStore]
  );

  return row ? { ...row, price: Number(row.price) } : null;
}

/** Returns first price row for item at a given store, or null. */
export async function getPriceForItemAtStore(item, storeName) {
  const normalizedItem = (item ?? "").trim();
  const normalizedStore = (storeName ?? "").trim();
  if (!normalizedItem || !normalizedStore) return null;

  const db = await getDb();
  const row = await db.getFirstAsync(
    `SELECT item, brand, price, weight, storeName FROM prices
     WHERE item = ? AND storeName = ? LIMIT 1;`,
    [normalizedItem, normalizedStore]
  );
  return row ? { ...row, price: Number(row.price) } : null;
}

export async function getAllPricesForItem(item) {
  const normalizedItem = (item ?? "").trim();
  if (!normalizedItem) return [];

  const db = await getDb();
  const rows = await db.getAllAsync(
    `SELECT id, item, brand, price, weight, storeName
     FROM prices
     WHERE item = ?
     ORDER BY price ASC;`,
    [normalizedItem]
  );

  return (rows ?? []).map((r) => ({ ...r, price: Number(r.price) }));
}

/**
 * Search prices by keyword (item, brand, or storeName). Pass empty string for all.
 */
export async function searchPrices(searchTerm = "") {
  const db = await getDb();
  const term = (searchTerm ?? "").trim();
  let rows;
  if (!term) {
    rows = await db.getAllAsync(
      `SELECT id, item, brand, price, weight, storeName FROM prices ORDER BY item, price ASC;`
    );
  } else {
    const like = `%${term.replace(/%/g, "\\%")}%`;
    rows = await db.getAllAsync(
      `SELECT id, item, brand, price, weight, storeName FROM prices
       WHERE item LIKE ? OR brand LIKE ? OR storeName LIKE ?
       ORDER BY item, price ASC;`,
      [like, like, like]
    );
  }
  return (rows ?? []).map((r) => ({ ...r, price: Number(r.price) }));
}
