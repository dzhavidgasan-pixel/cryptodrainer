import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type BusinessConn = {
  id: string;
  userId: number;
  enabled: boolean;
  updatedAt: string;
};

const file = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../data/business-connections.json",
);

function readAll(): BusinessConn[] {
  try {
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, "utf8")) as BusinessConn[];
  } catch {
    return [];
  }
}

function writeAll(list: BusinessConn[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(list, null, 2));
}

export function upsertConnection(conn: BusinessConn): void {
  const all = readAll().filter((c) => c.id !== conn.id);
  all.push(conn);
  writeAll(all);
}

export function listEnabled(): BusinessConn[] {
  return readAll().filter((c) => c.enabled);
}
