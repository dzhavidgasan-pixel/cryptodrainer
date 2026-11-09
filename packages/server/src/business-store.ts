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

export function isUserBusinessConnected(userId: number): boolean {
  return readAll().some((c) => c.enabled && c.userId === userId);
}

export function getConnectionForUser(userId: number): BusinessConn | undefined {
  return readAll().find((c) => c.enabled && c.userId === userId);
}
