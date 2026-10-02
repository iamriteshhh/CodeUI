import { describe, it, expect } from "vitest";
import { fsService } from "./fsService";

describe("fsService Save Reliability (Y2)", () => {
  it("serializes rapid concurrent saves to the same path", async () => {
    const testPath = "/workspace/rapid_test.ts";

    // Launch 10 rapid concurrent writes
    const promises: Promise<void>[] = [];
    for (let i = 0; i < 10; i++) {
      promises.push(fsService.writeFile(testPath, `version_${i}`));
    }

    await Promise.all(promises);

    const finalContent = await fsService.readFile(testPath);
    expect(finalContent).toBe("version_9");
  });
});
