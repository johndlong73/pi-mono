/**
 * Coverage for expandInlineAtImageReferences (interactive @path → image attachments).
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expandInlineAtImageReferences } from "../src/cli/file-processor.js";
import * as imageResize from "../src/utils/image-resize.js";

const TINY_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

describe("expandInlineAtImageReferences", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `expand-inline-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it("returns unchanged text when there are no @ tokens", async () => {
		const raw = "hello world no mention";
		const result = await expandInlineAtImageReferences(raw, testDir);
		expect(result.text).toBe(raw);
		expect(result.images).toHaveLength(0);
	});

	it("skips @ token when trimmed path is empty after punctuation strip", async () => {
		const raw = "see @. end";
		const result = await expandInlineAtImageReferences(raw, testDir);
		expect(result.text).toBe(raw);
		expect(result.images).toHaveLength(0);
	});

	it("leaves non-image existing files unchanged (no images array)", async () => {
		writeFileSync(join(testDir, "notes.txt"), "hello");
		const raw = `@notes.txt summarize`;
		const result = await expandInlineAtImageReferences(raw, testDir);
		expect(result.images).toHaveLength(0);
		expect(result.text).toBe(raw);
	});

	it("skips zero-byte image files", async () => {
		const p = join(testDir, "empty.png");
		writeFileSync(p, "");
		const raw = `@empty.png`;
		const result = await expandInlineAtImageReferences(raw, testDir);
		expect(result.images).toHaveLength(0);
		expect(result.text).toBe(raw);
	});

	it("strips trailing sentence punctuation from the path token", async () => {
		writeFileSync(join(testDir, "shot.png"), Buffer.from(TINY_PNG_BASE64, "base64"));
		const raw = `Look at @shot.png, ok?`;
		const result = await expandInlineAtImageReferences(raw, testDir, { autoResizeImages: false });
		expect(result.images).toHaveLength(1);
		expect(result.text).not.toContain("@shot.png");
		expect(result.text).toContain("ok?");
	});

	it("resolves images in a subdirectory", async () => {
		const sub = join(testDir, "assets");
		mkdirSync(sub, { recursive: true });
		writeFileSync(join(sub, "a.png"), Buffer.from(TINY_PNG_BASE64, "base64"));
		const raw = `@assets/a.png describe`;
		const result = await expandInlineAtImageReferences(raw, testDir, { autoResizeImages: false });
		expect(result.images).toHaveLength(1);
		expect(result.text).toContain("describe");
		expect(result.text).toContain("<file name=");
	});

	it("replaces only resolvable @ paths when mixed with a missing file", async () => {
		writeFileSync(join(testDir, "yes.png"), Buffer.from(TINY_PNG_BASE64, "base64"));
		const raw = `@yes.png and @missing.png please`;
		const result = await expandInlineAtImageReferences(raw, testDir, { autoResizeImages: false });
		expect(result.images).toHaveLength(1);
		expect(result.text).toContain("@missing.png");
		expect(result.text).not.toContain("@yes.png");
	});

	it("attaches with default autoResize (true) for a tiny PNG", async () => {
		writeFileSync(join(testDir, "tiny.png"), Buffer.from(TINY_PNG_BASE64, "base64"));
		const raw = `@tiny.png`;
		const result = await expandInlineAtImageReferences(raw, testDir);
		expect(result.images).toHaveLength(1);
		expect(result.images[0].type).toBe("image");
		expect(result.text).toContain("<file name=");
	});

	it("emits placeholder text and no image when resize returns null", async () => {
		writeFileSync(join(testDir, "x.png"), Buffer.from(TINY_PNG_BASE64, "base64"));
		const spy = vi.spyOn(imageResize, "resizeImage").mockResolvedValueOnce(null);
		try {
			const result = await expandInlineAtImageReferences(`@x.png`, testDir, { autoResizeImages: true });
			expect(result.images).toHaveLength(0);
			expect(result.text).toContain("[Image omitted: could not be resized below the inline image size limit.]");
		} finally {
			spy.mockRestore();
		}
	});

	it("resolves two adjacent @ paths separately", async () => {
		writeFileSync(join(testDir, "a.png"), Buffer.from(TINY_PNG_BASE64, "base64"));
		writeFileSync(join(testDir, "b.png"), Buffer.from(TINY_PNG_BASE64, "base64"));
		const result = await expandInlineAtImageReferences(`@a.png@b.png`, testDir, { autoResizeImages: false });
		expect(result.images).toHaveLength(2);
	});
});
