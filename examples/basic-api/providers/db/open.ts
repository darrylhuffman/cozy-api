import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { DatabaseSync } from "node:sqlite"

export const PET_STATUSES = ["available", "pending", "sold"] as const
export type PetStatus = (typeof PET_STATUSES)[number]

export interface Pet {
  id: number
  name: string
  species: string
  status: PetStatus
}

export interface Order {
  id: number
  petId: number
  quantity: number
  status: "placed"
  placedAt: string
}

export interface NewPet {
  name: string
  species: string
  status?: PetStatus
}

/** The `db` provider. Async so node test cases can mock it with canned results. */
export interface PetStoreDb {
  listPets(filter?: { status?: PetStatus; species?: string }): Promise<Pet[]>
  getPet(id: number): Promise<Pet | null>
  addPet(pet: NewPet): Promise<Pet>
  updatePetStatus(id: number, status: PetStatus): Promise<Pet | null>
  /** Records the order and marks the pet pending, in one transaction. */
  placeOrder(petId: number, quantity: number): Promise<Order>
  inventory(): Promise<Record<PetStatus, number>>
  close(): void
}

const SEED: NewPet[] = [
  { name: "Biscuit", species: "dog", status: "available" },
  { name: "Miso", species: "cat", status: "available" },
  { name: "Pickles", species: "rabbit", status: "pending" },
  { name: "Captain", species: "parrot", status: "sold" },
]

/**
 * Opens (and on first use creates and seeds) the pet store database.
 *
 * @param file - A SQLite file path, or `:memory:` for a throwaway database.
 */
export function openPetStoreDb(file: string): PetStoreDb {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS pets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      species TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'available'
        CHECK (status IN ('available', 'pending', 'sold'))
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pet_id INTEGER NOT NULL REFERENCES pets(id),
      quantity INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'placed',
      placed_at TEXT NOT NULL
    );
  `)

  const insertPet = db.prepare("INSERT INTO pets (name, species, status) VALUES (?, ?, ?)")
  const selectPet = db.prepare("SELECT id, name, species, status FROM pets WHERE id = ?")
  const count = db.prepare("SELECT COUNT(*) AS n FROM pets").get() as { n: number }
  if (count.n === 0) {
    for (const p of SEED) insertPet.run(p.name, p.species, p.status ?? "available")
  }

  const getPet = (id: number) => (selectPet.get(id) as Pet | undefined) ?? null

  return {
    async listPets(filter = {}) {
      const where: string[] = []
      const args: string[] = []
      if (filter.status) {
        where.push("status = ?")
        args.push(filter.status)
      }
      if (filter.species) {
        where.push("species = ?")
        args.push(filter.species)
      }
      const sql = `SELECT id, name, species, status FROM pets${
        where.length ? ` WHERE ${where.join(" AND ")}` : ""
      } ORDER BY id`
      return db.prepare(sql).all(...args) as unknown as Pet[]
    },

    async getPet(id) {
      return getPet(id)
    },

    async addPet({ name, species, status = "available" }) {
      const { lastInsertRowid } = insertPet.run(name, species, status)
      return getPet(Number(lastInsertRowid)) as Pet
    },

    async updatePetStatus(id, status) {
      db.prepare("UPDATE pets SET status = ? WHERE id = ?").run(status, id)
      return getPet(id)
    },

    async placeOrder(petId, quantity) {
      const placedAt = new Date().toISOString()
      db.exec("BEGIN")
      try {
        const { lastInsertRowid } = db
          .prepare("INSERT INTO orders (pet_id, quantity, placed_at) VALUES (?, ?, ?)")
          .run(petId, quantity, placedAt)
        db.prepare("UPDATE pets SET status = 'pending' WHERE id = ?").run(petId)
        db.exec("COMMIT")
        return { id: Number(lastInsertRowid), petId, quantity, status: "placed", placedAt }
      } catch (e) {
        db.exec("ROLLBACK")
        throw e
      }
    },

    async inventory() {
      const rows = db.prepare("SELECT status, COUNT(*) AS n FROM pets GROUP BY status").all() as {
        status: PetStatus
        n: number
      }[]
      const counts = { available: 0, pending: 0, sold: 0 }
      for (const r of rows) counts[r.status] = r.n
      return counts
    },

    close() {
      db.close()
    },
  }
}
