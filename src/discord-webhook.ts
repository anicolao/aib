import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const DISCORD_CONTENT_LIMIT = 2000;
const SAFE_CONTENT_LIMIT = 1900;
const MAX_DISCORD_ATTEMPTS = 6;
const RETRY_MARGIN_MS = 100;

export interface DiscordWebhookConfig {
    url: string;
    username?: string;
}

export async function postMarkdownToDiscord(markdown: string, config: DiscordWebhookConfig) {
    const chunks = splitDiscordMarkdown(markdown);
    for (const chunk of chunks) {
        await postDiscordMessage(chunk, config);
    }
    return chunks.length;
}

export async function postPngToDiscord(path: string, content: string, config: DiscordWebhookConfig) {
    if (content.length > DISCORD_CONTENT_LIMIT) {
        throw new Error(`Discord file message exceeds ${DISCORD_CONTENT_LIMIT} characters`);
    }
    const file = await readFile(path);
    await postDiscordFile(file, basename(path), content, config);
}

export function splitDiscordMarkdown(markdown: string) {
    const normalized = markdown.trimEnd();
    if (!normalized) return [];
    const sectionChunks = splitSections(normalized);
    return sectionChunks.flatMap((section) => splitToLimit(section, SAFE_CONTENT_LIMIT));
}

function splitSections(markdown: string) {
    const lines = markdown.split("\n");
    const sections: string[] = [];
    let current: string[] = [];

    const flush = () => {
        if (current.length === 0) return;
        sections.push(current.join("\n").trimEnd());
        current = [];
    };

    for (const line of lines) {
        const startsSection = /^(?:##|###) /.test(line);
        if (startsSection && current.length > 0) flush();
        current.push(line);
    }
    flush();
    return sections;
}

function splitToLimit(text: string, limit: number) {
    if (text.length <= limit) return [text];
    const chunks: string[] = [];
    let current = "";
    for (const line of text.split("\n")) {
        if (line.length > limit) {
            if (current) {
                chunks.push(current.trimEnd());
                current = "";
            }
            chunks.push(...hardSplit(line, limit));
            continue;
        }

        const candidate = current ? `${current}\n${line}` : line;
        if (candidate.length > limit) {
            if (current) chunks.push(current.trimEnd());
            current = line;
        } else {
            current = candidate;
        }
    }
    if (current) chunks.push(current.trimEnd());
    return chunks;
}

function hardSplit(text: string, limit: number) {
    const chunks: string[] = [];
    for (let index = 0; index < text.length; index += limit) {
        chunks.push(text.slice(index, index + limit));
    }
    return chunks;
}

async function postDiscordMessage(content: string, config: DiscordWebhookConfig) {
    if (content.length > DISCORD_CONTENT_LIMIT) {
        throw new Error(`Discord message chunk exceeds ${DISCORD_CONTENT_LIMIT} characters`);
    }
    const payload: Record<string, unknown> = {
        content,
        allowed_mentions: { parse: [] },
    };
    if (config.username) payload.username = config.username;

    for (let attempt = 1; attempt <= MAX_DISCORD_ATTEMPTS; attempt += 1) {
        const response = await fetch(config.url, {
            method: "POST",
            headers: {
                "content-type": "application/json",
            },
            body: JSON.stringify(payload),
        });
        if (response.ok) return;

        const body = await response.text();
        if (response.status === 429 && attempt < MAX_DISCORD_ATTEMPTS) {
            await sleep(discordRetryDelayMs(response, body));
            continue;
        }
        throw new Error(`Discord webhook failed with HTTP ${response.status}: ${body.slice(0, 500)}`);
    }
}

async function postDiscordFile(file: Buffer, filename: string, content: string, config: DiscordWebhookConfig) {
    for (let attempt = 1; attempt <= MAX_DISCORD_ATTEMPTS; attempt += 1) {
        const payload: Record<string, unknown> = {
            content,
            allowed_mentions: { parse: [] },
            attachments: [{ id: 0, filename }],
        };
        if (config.username) payload.username = config.username;

        const form = new FormData();
        form.append("payload_json", JSON.stringify(payload));
        form.append("files[0]", new Blob([Uint8Array.from(file)], { type: "image/png" }), filename);

        const response = await fetch(config.url, {
            method: "POST",
            body: form,
        });
        if (response.ok) return;

        const body = await response.text();
        if (response.status === 429 && attempt < MAX_DISCORD_ATTEMPTS) {
            await sleep(discordRetryDelayMs(response, body));
            continue;
        }
        throw new Error(`Discord webhook file upload failed with HTTP ${response.status}: ${body.slice(0, 500)}`);
    }
}

function discordRetryDelayMs(response: Response, body: string) {
    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : retryAfterFromBody(body);
    if (typeof retryAfterSeconds === "number" && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
        return Math.ceil(retryAfterSeconds * 1000) + RETRY_MARGIN_MS;
    }
    return 1000;
}

function retryAfterFromBody(body: string) {
    try {
        const parsed = JSON.parse(body) as { retry_after?: unknown };
        return typeof parsed.retry_after === "number" ? parsed.retry_after : undefined;
    } catch {
        return undefined;
    }
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
