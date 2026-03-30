/**
 * Integration: AgentSession.prompt runs expandInlineAtImageReferences so user messages include ImageContent.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./test-harness.js";

const TINY_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

describe("AgentSession inline @ image paths", () => {
	let harness: Harness;

	afterEach(() => {
		harness?.cleanup();
	});

	it("passes expanded images to the model context on prompt()", async () => {
		harness = createHarness({ responses: ["ok"] });
		const pngPath = join(harness.tempDir, "snap.png");
		writeFileSync(pngPath, Buffer.from(TINY_PNG_BASE64, "base64"));

		await harness.session.prompt(`@snap.png what is this?`);

		expect(harness.faux.contexts).toHaveLength(1);
		const userMsg = harness.faux.contexts[0].messages.find((m) => m.role === "user");
		expect(userMsg).toBeDefined();
		expect(typeof userMsg!.content).not.toBe("string");
		const parts = userMsg!.content as Array<{ type: string; text?: string }>;
		const hasImage = parts.some((p) => p.type === "image");
		expect(hasImage).toBe(true);
		const textParts = parts.filter((p) => p.type === "text").map((p) => p.text ?? "");
		const combined = textParts.join("");
		expect(combined).toContain("what is this?");
		expect(combined).not.toContain("@snap.png");
	});
});
