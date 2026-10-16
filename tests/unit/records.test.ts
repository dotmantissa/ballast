import { describe, expect, it, vi } from "vitest";
import { collectPages, mergeRecords } from "../../lib/records";
describe("record recovery", () => {
  it("keeps records with the same ID fresh and preserves older pages", () => {
    expect(
      mergeRecords(
        [
          { id: "old", value: 1 },
          { id: "same", value: 1 },
        ],
        [
          { id: "same", value: 2 },
          { id: "new", value: 3 },
        ],
      ),
    ).toEqual([
      { id: "old", value: 1 },
      { id: "same", value: 2 },
      { id: "new", value: 3 },
    ]);
  });
  it("retrieves every account case instead of stopping at fifty", async () => {
    const older = vi
      .fn()
      .mockResolvedValueOnce({
        items: Array.from({ length: 50 }, (_, i) => i + 50),
        total: 103,
        next_cursor: 3,
      })
      .mockResolvedValueOnce({
        items: [100, 101, 102],
        total: 103,
        next_cursor: null,
      });
    const all = await collectPages(
      {
        items: Array.from({ length: 50 }, (_, i) => i),
        total: 103,
        next_cursor: 53,
      },
      older,
    );
    expect(all).toHaveLength(103);
    expect(all.at(-1)).toBe(102);
    expect(older.mock.calls).toEqual([[53], [3]]);
  });
  it("fails visibly instead of silently looping or dropping a nonadvancing page", async () => {
    await expect(
      collectPages({ items: [], total: 2, next_cursor: 1 }, async () => ({
        items: [],
        total: 2,
        next_cursor: 1,
      })),
    ).rejects.toThrow("cursor did not advance");
  });
});
