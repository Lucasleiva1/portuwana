import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadDatabaseMock, selectMock } = vi.hoisted(() => ({
  loadDatabaseMock: vi.fn(),
  selectMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
}));

vi.mock("@tauri-apps/plugin-sql", () => ({
  default: { load: loadDatabaseMock },
}));

vi.mock("../src/logging/logger", () => ({
  logger: { info: vi.fn() },
}));

import { initializeDatabase } from "../src/storage/database";

describe("database initialization", () => {
  beforeEach(() => {
    loadDatabaseMock.mockReset();
    selectMock.mockReset();
  });

  it("retries after a transient SQLite initialization failure", async () => {
    loadDatabaseMock
      .mockRejectedValueOnce(new Error("database is busy"))
      .mockResolvedValueOnce({ select: selectMock });
    selectMock.mockResolvedValue([{ key: "schema.version", value: "2" }]);

    await expect(initializeDatabase()).rejects.toThrow("database is busy");
    await expect(initializeDatabase()).resolves.toMatchObject({
      status: "ready",
      schemaVersion: "2",
    });
    expect(loadDatabaseMock).toHaveBeenCalledTimes(2);
  });
});
