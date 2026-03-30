import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expandInlineAtImageReferences, processFileArguments } from "../src/cli/file-processor.js";
import { SettingsManager } from "../src/core/settings-manager.js";
import { createReadTool } from "../src/core/tools/read.js";

// 1x1 red PNG image as base64 (smallest valid PNG)
const TINY_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

describe("blockImages setting", () => {
	describe("SettingsManager", () => {
		it("should default blockImages to false", () => {
			const manager = SettingsManager.inMemory({});
			expect(manager.getBlockImages()).toBe(false);
		});

		it("should return true when blockImages is set to true", () => {
			const manager = SettingsManager.inMemory({ images: { blockImages: true } });
			expect(manager.getBlockImages()).toBe(true);
		});

		it("should persist blockImages setting via setBlockImages", () => {
			const manager = SettingsManager.inMemory({});
			expect(manager.getBlockImages()).toBe(false);

			manager.setBlockImages(true);
			expect(manager.getBlockImages()).toBe(true);

			manager.setBlockImages(false);
			expect(manager.getBlockImages()).toBe(false);
		});

		it("should handle blockImages alongside autoResize", () => {
			const manager = SettingsManager.inMemory({
				images: { autoResize: true, blockImages: true },
			});
			expect(manager.getImageAutoResize()).toBe(true);
			expect(manager.getBlockImages()).toBe(true);
		});
	});

	describe("Read tool", () => {
		let testDir: string;

		beforeEach(() => {
			testDir = join(tmpdir(), `block-images-test-${Date.now()}`);
			mkdirSync(testDir, { recursive: true });
		});

		afterEach(() => {
			rmSync(testDir, { recursive: true, force: true });
		});

		it("should always read images (filtering happens at convertToLlm layer)", async () => {
			// Create test image
			const imagePath = join(testDir, "test.png");
			writeFileSync(imagePath, Buffer.from(TINY_PNG_BASE64, "base64"));

			const tool = createReadTool(testDir);
			const result = await tool.execute("test-1", { path: imagePath });

			// Should have text note + image content
			expect(result.content.length).toBeGreaterThanOrEqual(1);
			const hasImage = result.content.some((c) => c.type === "image");
			expect(hasImage).toBe(true);
		});

		it("should read text files normally", async () => {
			// Create test text file
			const textPath = join(testDir, "test.txt");
			writeFileSync(textPath, "Hello, world!");

			const tool = createReadTool(testDir);
			const result = await tool.execute("test-2", { path: textPath });

			expect(result.content).toHaveLength(1);
			expect(result.content[0].type).toBe("text");
			const textContent = result.content[0] as { type: "text"; text: string };
			expect(textContent.text).toContain("Hello, world!");
		});
	});

	describe("processFileArguments", () => {
		let testDir: string;

		beforeEach(() => {
			testDir = join(tmpdir(), `block-images-process-test-${Date.now()}`);
			mkdirSync(testDir, { recursive: true });
		});

		afterEach(() => {
			rmSync(testDir, { recursive: true, force: true });
		});

		it("should always process images (filtering happens at convertToLlm layer)", async () => {
			// Create test image
			const imagePath = join(testDir, "test.png");
			writeFileSync(imagePath, Buffer.from(TINY_PNG_BASE64, "base64"));

			const result = await processFileArguments([imagePath]);

			expect(result.images).toHaveLength(1);
			expect(result.images[0].type).toBe("image");
		});

		it("should process text files normally", async () => {
			// Create test text file
			const textPath = join(testDir, "test.txt");
			writeFileSync(textPath, "Hello, world!");

			const result = await processFileArguments([textPath]);

			expect(result.images).toHaveLength(0);
			expect(result.text).toContain("Hello, world!");
		});
	});

	describe("expandInlineAtImageReferences", () => {
		let testDir: string;

		beforeEach(() => {
			testDir = join(tmpdir(), `inline-at-test-${Date.now()}`);
			mkdirSync(testDir, { recursive: true });
		});

		afterEach(() => {
			rmSync(testDir, { recursive: true, force: true });
		});

		it("should attach images for @path in prose and emit file markers", async () => {
			const imagePath = join(testDir, "secret.png");
			writeFileSync(imagePath, Buffer.from(TINY_PNG_BASE64, "base64"));

			const raw = `@secret.png What do you see?`;
			const result = await expandInlineAtImageReferences(raw, testDir, { autoResizeImages: false });

			expect(result.images).toHaveLength(1);
			expect(result.images[0].type).toBe("image");
			expect(result.text).toContain("<file name=");
			expect(result.text).toContain("What do you see?");
			expect(result.text).not.toContain("@secret.png");
		});

		it("should resolve two adjacent @ paths separately", async () => {
			const a = join(testDir, "a.png");
			const b = join(testDir, "b.png");
			writeFileSync(a, Buffer.from(TINY_PNG_BASE64, "base64"));
			writeFileSync(b, Buffer.from(TINY_PNG_BASE64, "base64"));

			const raw = `@a.png@b.png`;
			const result = await expandInlineAtImageReferences(raw, testDir, { autoResizeImages: false });

			expect(result.images).toHaveLength(2);
		});

		it("should leave missing paths unchanged", async () => {
			const raw = `@nope.png hello`;
			const result = await expandInlineAtImageReferences(raw, testDir);

			expect(result.images).toHaveLength(0);
			expect(result.text).toBe(raw);
		});
	});
});
