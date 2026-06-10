import type { ScanningData, Star } from "./types.js";

export interface StrategicState {
    collaboratorUids: Set<number>;
    forbiddenTargetUids: Set<number>;
}

interface DiplomacyMessage {
    key?: unknown;
    created?: unknown;
    player_uid?: unknown;
    payload?: {
        from_uid?: unknown;
        to_uids?: unknown;
        created?: unknown;
        body?: unknown;
    };
    comments?: DiplomacyComment[];
}

interface DiplomacyComment {
    created?: unknown;
    player_uid?: unknown;
    payload?: {
        senderUid?: unknown;
        from_uid?: unknown;
        created?: unknown;
        body?: unknown;
    };
}

interface DiplomacyEvent {
    created: number;
    fromUid: number;
    toUids: number[];
    body: string;
}

export function buildStrategicState(scan: ScanningData, messages: unknown[] = []): StrategicState {
    const collaboratorUids = new Set(
        Object.values(scan.players)
            .filter((player) => player.uid !== scan.playerUid && collaboratorAliases().has(normalizeName(player.alias)))
            .map((player) => player.uid),
    );
    const forbiddenTargetUids = forbiddenTargetsFromDiplomacy(scan, messages);
    for (const star of Object.values(scan.stars)) {
        if (collaboratorUids.has(star.puid)) {
            forbiddenTargetUids.add(star.uid);
        }
    }
    return { collaboratorUids, forbiddenTargetUids };
}

export function isCollaboratorAlias(alias: string) {
    return collaboratorAliases().has(normalizeName(alias));
}

export function requestedTechKindsFromUs(text: string) {
    const requested = new Set<number>();
    const lower = text.toLowerCase();
    const verbs = "(?:send|share|give|transfer|dispatch)";
    const objects = "(?:me|us|my empire|our empire)";
    for (const [kind, aliases] of techAliases()) {
        const tech = aliases.join("|");
        const patterns = [
            new RegExp(`${verbs}[^.?!\\n]{0,80}${objects}[^.?!\\n]{0,80}\\b(?:${tech})\\b`, "i"),
            new RegExp(`${verbs}[^.?!\\n]{0,80}\\b(?:${tech})\\b[^.?!\\n]{0,80}${objects}`, "i"),
            new RegExp(`i\\s+(?:would\\s+like|want|need|would\\s+welcome)[^.?!\\n]{0,80}(?:you\\s+to\\s+)?${verbs}[^.?!\\n]{0,80}\\b(?:${tech})\\b`, "i"),
            new RegExp(`please\\s+${verbs}[^.?!\\n]{0,80}\\b(?:${tech})\\b`, "i"),
        ];
        if (patterns.some((pattern) => pattern.test(lower))) {
            requested.add(kind);
        }
    }
    return [...requested];
}

function forbiddenTargetsFromDiplomacy(scan: ScanningData, messages: unknown[]) {
    const forbidden = new Set<number>();
    const starsByName = new Map(
        Object.values(scan.stars).map((star) => [normalizeName(star.n), star]),
    );
    for (const event of diplomacyEvents(messages)) {
        if (event.fromUid !== scan.playerUid) continue;
        const body = event.body;
        const linkedStars = linkedStarNames(body)
            .map((name) => starsByName.get(normalizeName(name)))
            .filter((star): star is Star => Boolean(star));
        if (linkedStars.length === 0) continue;

        if (promisesNoFurtherAttack(body)) {
            for (const star of linkedStars) {
                if (star.puid !== scan.playerUid) forbidden.add(star.uid);
            }
        }

        for (const star of starsGrantedToOtherSide(scan, body, linkedStars)) {
            forbidden.add(star.uid);
        }
    }
    return forbidden;
}

function promisesNoFurtherAttack(text: string) {
    return /no\s+further|no\s+reinforcements|no\s+follow[-\s]?up|not\s+reinforce|not\s+send\s+reinforcements|cease\s+any\s+further/i.test(text)
        && /attack|incursion|advancement|fleet|reinforcement|holding|holdings|dispatch/i.test(text);
}

function starsGrantedToOtherSide(scan: ScanningData, text: string, linkedStars: Star[]) {
    const granted = new Set<Star>();
    const lower = text.toLowerCase();
    if (/\bwithin\s+(?:your|yours|their|theirs)\b|\byour\s+(?:influence|sphere|territory|holdings)\b/i.test(text)) {
        const links = linkedStarNames(text);
        for (const [index, name] of links.entries()) {
            const star = linkedStars.find((candidate) => normalizeName(candidate.n) === normalizeName(name));
            if (!star) continue;
            const after = lower.slice(lower.indexOf(`[[${name.toLowerCase()}]]`) + name.length + 4, lower.indexOf(`[[${name.toLowerCase()}]]`) + name.length + 120);
            if (/within\s+(?:your|yours|their|theirs)|your\s+(?:influence|sphere|territory|holdings)/i.test(after) || index > 0 && /\bmy\s+(?:influence|sphere|territory|holdings)\b/i.test(lower)) {
                if (star.puid !== scan.playerUid) granted.add(star);
            }
        }
    }
    return [...granted];
}

function diplomacyEvents(messages: unknown[]) {
    return messages
        .flatMap((message) => messageEvents(message))
        .filter((event): event is DiplomacyEvent => event !== undefined)
        .sort((a, b) => a.created - b.created);
}

function messageEvents(message: unknown) {
    const root = message as DiplomacyMessage;
    const rootEvent = messageEvent(root);
    const threadParticipants = rootEvent
        ? new Set([rootEvent.fromUid, ...rootEvent.toUids])
        : new Set<number>();
    const events = [rootEvent];
    for (const comment of root.comments ?? []) {
        events.push(commentEvent(comment, threadParticipants));
    }
    return events;
}

function messageEvent(message: DiplomacyMessage) {
    const created = timestampMs(message.payload?.created ?? message.created);
    const fromUid = numeric(message.payload?.from_uid ?? message.player_uid);
    const toUids = numericArray(message.payload?.to_uids);
    const body = stringValue(message.payload?.body);
    if (created === undefined || fromUid === undefined || !body) return undefined;
    return { created, fromUid, toUids, body };
}

function commentEvent(comment: DiplomacyComment, threadParticipants: Set<number>) {
    const created = timestampMs(comment.payload?.created ?? comment.created);
    const fromUid = numeric(comment.payload?.senderUid ?? comment.payload?.from_uid ?? comment.player_uid);
    const body = stringValue(comment.payload?.body);
    if (created === undefined || fromUid === undefined || !body) return undefined;
    return {
        created,
        fromUid,
        toUids: [...threadParticipants].filter((uid) => uid !== fromUid),
        body,
    };
}

function linkedStarNames(text: string) {
    const names: string[] = [];
    const pattern = /\[\[([^\]]+)]]/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
        const name = match[1]?.trim();
        if (name) names.push(name);
    }
    return names;
}

function collaboratorAliases() {
    const defaults = ["calculum", "infurium", "monkeymom"];
    const configured = (process.env.AIB_COLLABORATOR_ALIASES ?? "")
        .split(",")
        .map((entry) => normalizeName(entry))
        .filter(Boolean);
    return new Set([...defaults, ...configured]);
}

function normalizeName(value: string) {
    return value.trim().toLowerCase();
}

function techAliases(): Array<[number, string[]]> {
    return [
        [0, ["banking", "bank", "banks"]],
        [1, ["experimentation", "experiment", "experiments", "research", "exp"]],
        [2, ["manufacturing", "manufacture", "manu"]],
        [3, ["propulsion", "range", "hyperspace"]],
        [4, ["scanning", "scan", "sensors"]],
        [5, ["weapons?", "weapon", "weap"]],
        [6, ["terraforming", "terra"]],
    ];
}

function timestampMs(value: unknown) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) return parsed;
        const numericValue = Number(value);
        if (Number.isFinite(numericValue)) return numericValue;
    }
    return undefined;
}

function numeric(value: unknown) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
}

function numericArray(value: unknown) {
    if (Array.isArray(value)) {
        return value.map(numeric).filter((entry): entry is number => entry !== undefined);
    }
    if (typeof value === "string") {
        return value.split(",").map(numeric).filter((entry): entry is number => entry !== undefined);
    }
    return [];
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value : undefined;
}
