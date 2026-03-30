/**
 * Process @file CLI arguments into text content and image attachments
 */

import { access, readFile, stat } from "node:fs/promises";
import type { ImageContent } from "@mariozechner/pi-ai";
import chalk from "chalk";
import { resolve } from "path";
import { resolveReadPath } from "../core/tools/path-utils.js";
import { formatDimensionNote, resizeImage } from "../utils/image-resize.js";
import { detectSupportedImageMimeTypeFromFile } from "../utils/mime.js";

/** Strip trailing punctuation often glued to @path in prose (e.g. `see @a.png`). */
function trimTrailingPunctuationFromPathToken(raw: string): string {
	let s = raw;
	while (s.length > 0 && /[.,;:!?)\]}>"'`]+$/.test(s.slice(-1))) {
		s = s.slice(0, -1);
	}
	return s;
}

export interface ProcessedFiles {
	text: string;
	images: ImageContent[];
}

export interface ProcessFileOptions {
	/** Whether to auto-resize images to 2000x2000 max. Default: true */
	autoResizeImages?: boolean;
}

/** Process @file arguments into text content and image attachments */
export async function processFileArguments(fileArgs: string[], options?: ProcessFileOptions): Promise<ProcessedFiles> {
	const autoResizeImages = options?.autoResizeImages ?? true;
	let text = "";
	const images: ImageContent[] = [];

	for (const fileArg of fileArgs) {
		// Expand and resolve path (handles ~ expansion and macOS screenshot Unicode spaces)
		const absolutePath = resolve(resolveReadPath(fileArg, process.cwd()));

		// Check if file exists
		try {
			await access(absolutePath);
		} catch {
			console.error(chalk.red(`Error: File not found: ${absolutePath}`));
			process.exit(1);
		}

		// Check if file is empty
		const stats = await stat(absolutePath);
		if (stats.size === 0) {
			// Skip empty files
			continue;
		}

		const mimeType = await detectSupportedImageMimeTypeFromFile(absolutePath);

		if (mimeType) {
			// Handle image file
			const content = await readFile(absolutePath);
			const base64Content = content.toString("base64");

			let attachment: ImageContent;
			let dimensionNote: string | undefined;

			if (autoResizeImages) {
				const resized = await resizeImage({ type: "image", data: base64Content, mimeType });
				if (!resized) {
					text += `<file name="${absolutePath}">[Image omitted: could not be resized below the inline image size limit.]</file>\n`;
					continue;
				}
				dimensionNote = formatDimensionNote(resized);
				attachment = {
					type: "image",
					mimeType: resized.mimeType,
					data: resized.data,
				};
			} else {
				attachment = {
					type: "image",
					mimeType,
					data: base64Content,
				};
			}

			images.push(attachment);

			// Add text reference to image with optional dimension note
			if (dimensionNote) {
				text += `<file name="${absolutePath}">${dimensionNote}</file>\n`;
			} else {
				text += `<file name="${absolutePath}"></file>\n`;
			}
		} else {
			// Handle text file
			try {
				const content = await readFile(absolutePath, "utf-8");
				text += `<file name="${absolutePath}">\n${content}\n</file>\n`;
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(chalk.red(`Error: Could not read file ${absolutePath}: ${message}`));
				process.exit(1);
			}
		}
	}

	return { text, images };
}

/**
 * Find `@path` tokens in free text (interactive TUI, extensions), resolve image files
 * relative to `cwd`, and replace each token with the same `<file name="...">` markers
 * as {@link processFileArguments}. Non-image paths and missing files are left unchanged
 * so the model can still use the read tool.
 */
export async function expandInlineAtImageReferences(
	text: string,
	cwd: string,
	options?: ProcessFileOptions,
): Promise<{ text: string; images: ImageContent[] }> {
	const autoResizeImages = options?.autoResizeImages ?? true;
	const matches = [...text.matchAll(/@([^\s@]+)/g)];
	if (matches.length === 0) {
		return { text, images: [] };
	}

	const images: ImageContent[] = [];
	const replacements: Array<{ start: number; end: number; replacement: string }> = [];

	for (const m of matches) {
		const fullMatch = m[0];
		const rawPath = m[1];
		const start = m.index!;
		const end = start + fullMatch.length;
		const trimmedPath = trimTrailingPunctuationFromPathToken(rawPath);
		if (!trimmedPath) {
			continue;
		}

		let absolutePath: string;
		try {
			absolutePath = resolve(resolveReadPath(trimmedPath, cwd));
		} catch {
			continue;
		}

		try {
			await access(absolutePath);
		} catch {
			continue;
		}

		const stats = await stat(absolutePath);
		if (stats.size === 0) {
			continue;
		}

		const mimeType = await detectSupportedImageMimeTypeFromFile(absolutePath);
		if (!mimeType) {
			continue;
		}

		const fileBuffer = await readFile(absolutePath);
		const base64Content = fileBuffer.toString("base64");

		let replacement: string;

		if (autoResizeImages) {
			const resized = await resizeImage({ type: "image", data: base64Content, mimeType });
			if (!resized) {
				replacement = `<file name="${absolutePath}">[Image omitted: could not be resized below the inline image size limit.]</file>`;
				replacements.push({ start, end, replacement });
				continue;
			}
			const dimensionNote = formatDimensionNote(resized);
			images.push({
				type: "image",
				mimeType: resized.mimeType,
				data: resized.data,
			});
			replacement = dimensionNote
				? `<file name="${absolutePath}">${dimensionNote}</file>`
				: `<file name="${absolutePath}"></file>`;
		} else {
			images.push({
				type: "image",
				mimeType,
				data: base64Content,
			});
			replacement = `<file name="${absolutePath}"></file>`;
		}

		replacements.push({ start, end, replacement });
	}

	if (replacements.length === 0) {
		return { text, images: [] };
	}

	let out = text;
	for (const r of [...replacements].sort((a, b) => b.start - a.start)) {
		out = out.slice(0, r.start) + r.replacement + out.slice(r.end);
	}

	return { text: out, images };
}
