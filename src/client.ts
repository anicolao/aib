import type { ApiResponse, ScanningData } from "./types.js";
import { splitCommands, type PlannedCommand, type SubmissionResult } from "./command.js";

export interface ScanClientConfig {
    baseUrl: string;
    gameId: string;
    apiKey?: string;
}

export interface AccountConfig {
    baseUrl: string;
    user: string;
    password: string;
    gameId?: string;
    version: string;
}

type ServerResponse = [string, unknown];

export interface AccountGame {
    id?: string | number;
    number?: string | number;
    game_number?: string | number;
    name?: string;
    status?: string;
    config?: {
        name?: string;
    };
}

interface InitPlayerReport {
    open_games?: AccountGame[];
}

export interface AccountSession {
    cookie: string;
    player: unknown;
}

export async function fetchScan(config: ScanClientConfig): Promise<ScanningData> {
    if (!config.apiKey) {
        throw new Error("Scan API fetch requires an API key");
    }
    const url = new URL("/api", trimTrailingSlash(config.baseUrl));
    url.search = new URLSearchParams({
        game_number: config.gameId,
        api_version: "0.1",
        code: config.apiKey,
    }).toString();

    const response = await fetch(url);
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`Scan fetch failed with HTTP ${response.status}: ${text.slice(0, 500)}`);
    }

    const parsed = JSON.parse(text) as ApiResponse;
    if (!parsed.scanning_data) {
        throw new Error(`Scan response did not contain scanning_data: ${text.slice(0, 500)}`);
    }
    return parsed.scanning_data;
}

export async function fetchAuthenticatedScan(config: AccountConfig, cookie?: string): Promise<ScanningData> {
    if (!config.gameId) {
        throw new Error("Authenticated scan fetch requires a game id");
    }

    const sessionCookie = cookie ?? (await createAccountSession(config)).cookie;
    return fetchFullUniverse(config, sessionCookie);
}

export async function fetchDiplomacyMessages(config: AccountConfig, cookie?: string): Promise<unknown[]> {
    if (!config.gameId) {
        throw new Error("Diplomacy message fetch requires a game id");
    }

    const sessionCookie = cookie ?? (await createAccountSession(config)).cookie;
    const response = await gamePost(config, "fetch_game_messages", {
        group: "game_diplomacy",
        count: "50",
        offset: "0",
    }, sessionCookie);
    if (response.event !== "message:new_messages") {
        throw new Error(`Unexpected diplomacy message response: ${JSON.stringify(response)}`);
    }

    const messages = messageArray(response.report);
    for (const message of messages) {
        const key = messageKey(message);
        if (!key) continue;
        const comments = await fetchDiplomacyComments(config, sessionCookie, key);
        if (message && typeof message === "object") {
            (message as { comments?: unknown[] }).comments = comments;
        }
    }
    return messages;
}

export async function listActiveGames(config: AccountConfig): Promise<AccountGame[]> {
    return activeGamesFromReport((await createAccountSession(config)).player);
}

export async function createAccountSession(config: AccountConfig): Promise<AccountSession> {
    const cookie = await login(config);
    const player = await initPlayer(config, cookie);
    return { cookie, player };
}

export function activeGamesFromReport(report: unknown): AccountGame[] {
    const player = report as InitPlayerReport;
    return (player.open_games ?? []).filter((game) => game.status === "active");
}

export async function login(config: AccountConfig): Promise<string> {
    const response = await postForm(config.baseUrl, "/account_api/login", {
        type: "login",
        alias: config.user,
        password: config.password,
    });

    const [event, report, cookie] = response;
    if (event !== "meta:login_success") {
        throw new Error(`Login failed: ${JSON.stringify(report)}`);
    }
    if (!cookie) {
        throw new Error("Login succeeded but no session cookie was returned");
    }
    return cookie;
}

export async function initPlayer(config: AccountConfig, cookie: string) {
    const [event, report] = await postForm(config.baseUrl, "/account_api/init_player", {
        type: "init_player",
    }, cookie);
    if (event !== "meta:init_player") {
        throw new Error(`Unexpected init_player response: ${JSON.stringify([event, report])}`);
    }
    return report;
}

export async function submitCommands(
    config: AccountConfig,
    commands: PlannedCommand[],
): Promise<SubmissionResult> {
    if (!config.gameId) {
        throw new Error("Live submission requires a game id");
    }
    if (commands.length === 0) {
        return { submitted: false, responses: [] };
    }

    const cookie = await login(config);
    await initPlayer(config, cookie);

    const { batchedOrders } = splitCommands(commands);
    const responses: unknown[] = [];

    if (batchedOrders.length > 0) {
        responses.push(await gamePost(config, "batched_orders", {
            order: batchedOrders.join("/"),
        }, cookie));
    }

    for (const command of commands.filter((command) => command.kind !== "batched_order")) {
        const response = await gamePost(config, "order", { order: command.order }, cookie);
        responses.push(response);
        if (command.kind === "new_fleet" && command.followUpTargetUid !== undefined) {
            const fleetUid = newFleetUidFromResponse(response.report);
            if (fleetUid === undefined) {
                throw new Error(`new_fleet response did not include a fleet uid: ${JSON.stringify(response)}`);
            }
            responses.push(await gamePost(config, "order", {
                order: `add_fleet_orders,${fleetUid},0,${command.followUpTargetUid},0,0,0`,
            }, cookie));
        }
    }

    return { submitted: true, responses };
}

function newFleetUidFromResponse(report: unknown) {
    if (!report || typeof report !== "object") return undefined;
    const uid = (report as { uid?: unknown }).uid;
    return typeof uid === "number" ? uid : undefined;
}

async function fetchFullUniverse(config: AccountConfig, cookie: string): Promise<ScanningData> {
    const response = await gamePost(config, "order", {
        order: "full_universe_report",
    }, cookie);
    if (response.event !== "order:full_universe") {
        throw new Error(`Unexpected full_universe_report response: ${JSON.stringify(response)}`);
    }
    return response.report as ScanningData;
}

async function fetchDiplomacyComments(config: AccountConfig, cookie: string, key: string) {
    const response = await gamePost(config, "fetch_game_message_comments", {
        key,
        count: "100",
        offset: "0",
    }, cookie);
    if (response.event !== "message:new_comments") {
        return [];
    }
    return messageArray(response.report);
}

function messageArray(report: unknown): unknown[] {
    if (!report || typeof report !== "object") return [];
    const messages = (report as { messages?: unknown }).messages;
    return Array.isArray(messages) ? messages : [];
}

function messageKey(message: unknown) {
    if (!message || typeof message !== "object") return undefined;
    const key = (message as { key?: unknown }).key;
    return typeof key === "string" ? key : undefined;
}

async function gamePost(
    config: AccountConfig,
    type: "order" | "batched_orders" | "fetch_game_messages" | "fetch_game_message_comments",
    data: Record<string, string>,
    cookie: string,
) {
    const [event, report] = await postForm(config.baseUrl, `/game_api/${type}`, {
        type,
        ...data,
        version: config.version,
        gameId: config.gameId ?? "",
    }, cookie);
    return { event, report };
}

async function postForm(
    baseUrl: string,
    path: string,
    data: Record<string, string>,
    cookie?: string,
): Promise<[string, unknown, string]> {
    const headers: Record<string, string> = {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json, text/plain, */*",
        "User-Agent": "aib-mvp/0.1",
    };
    if (cookie) {
        headers.Cookie = cookie;
    }

    const response = await fetch(new URL(path, trimTrailingSlash(baseUrl)), {
        method: "POST",
        headers,
        body: new URLSearchParams(data),
    });
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`POST ${path} failed with HTTP ${response.status}: ${text.slice(0, 500)}`);
    }

    const parsed = JSON.parse(text) as ServerResponse;
    if (!Array.isArray(parsed) || parsed.length < 2) {
        throw new Error(`Unexpected response from ${path}: ${text.slice(0, 500)}`);
    }

    return [String(parsed[0]), parsed[1], extractCookie(response)];
}

function extractCookie(response: Response) {
    const maybeGetSetCookie = (response.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
    const cookies = typeof maybeGetSetCookie === "function"
        ? maybeGetSetCookie.call(response.headers)
        : [response.headers.get("set-cookie")].filter((value): value is string => Boolean(value));

    return cookies
        .map((cookie) => cookie.split(";")[0]?.trim())
        .filter(Boolean)
        .join("; ");
}

function trimTrailingSlash(value: string) {
    return value.replace(/\/+$/, "");
}
