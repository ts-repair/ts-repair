
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import path from "path";
import fs from "fs";
import { plan } from "../../src/oracle/planner";

const tmpDir = path.join(process.cwd(), "tmp-scaling-test");

describe("Efficiency Scaling", () => {
  beforeEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tmpDir);
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("scales linearly with independent errors", () => {
    const numFiles = 10; 
    
    // Create tsconfig
    const tsconfig = {
      compilerOptions: {
        target: "es2020",
        module: "commonjs",
        strict: true,
      },
      include: ["*.ts"],
    };
    fs.writeFileSync(path.join(tmpDir, "tsconfig.json"), JSON.stringify(tsconfig, null, 2));

    // Create N independent files, each with an easy-to-fix error
    for (let i = 0; i < numFiles; i++) {
      const content = `
export function test${i}() {
  await Promise.resolve(1);
}
`;
      fs.writeFileSync(path.join(tmpDir, `file${i}.ts`), content);
    }

    const start = performance.now();
    const result = plan(path.join(tmpDir, "tsconfig.json"), {
      maxIterations: numFiles + 5,
      maxCandidatesPerIteration: 100,
    });
    const end = performance.now();

    console.log(`Planned ${result.steps.length} fixes in ${(end - start).toFixed(0)}ms`);
    console.log(`Verifications: ${result.summary.budget.candidatesVerified}`);

    expect(result.steps.length).toBe(numFiles);
    
    // Check linear scaling: 
    // Initial scan: 10 verifications.
    // Re-verifications: 10 (one per committed fix).
    // Total should be around 20.
    // Definitely less than quadratic (55).
    expect(result.summary.budget.candidatesVerified).toBeLessThan(numFiles * 3);
  });
});
