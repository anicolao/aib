import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import type { PlannedCommand } from "./command.js";
import type { DecisionRecord } from "./planner.js";
import type { Fleet, ScanningData, Star } from "./types.js";

interface Point {
    x: number;
    y: number;
}

interface Rgba {
    r: number;
    g: number;
    b: number;
    a: number;
}

interface Bounds {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}

export interface DebugMapOptions {
    gameId: string;
    rootDir?: string;
    width?: number;
    height?: number;
}

const DEFAULT_WIDTH = 1400;
const DEFAULT_HEIGHT = 1000;
const PADDING = 70;

const COLORS = {
    background: rgba(4, 7, 13),
    grid: rgba(33, 43, 59),
    neutral: rgba(120, 130, 144),
    unscanned: rgba(45, 51, 62),
    text: rgba(225, 235, 247),
    mutedText: rgba(145, 158, 176),
    own: rgba(80, 210, 120),
    hub: rgba(255, 219, 88),
    threat: rgba(255, 83, 73),
    defense: rgba(60, 220, 125),
    attack: rgba(255, 92, 92),
    expansion: rgba(70, 190, 255),
    logistics: rgba(240, 195, 75),
    existingPath: rgba(112, 128, 150, 95),
    white: rgba(255, 255, 255),
    black: rgba(0, 0, 0),
};

const PLAYER_COLORS = [
    rgba(0, 159, 223),
    rgba(255, 64, 64),
    rgba(64, 192, 0),
    rgba(255, 192, 0),
    rgba(192, 96, 255),
    rgba(255, 128, 0),
    rgba(0, 192, 192),
    rgba(255, 96, 160),
];

export async function writeDebugMap(scan: ScanningData, decision: DecisionRecord, options: DebugMapOptions) {
    const width = options.width ?? DEFAULT_WIDTH;
    const height = options.height ?? DEFAULT_HEIGHT;
    const bitmap = new Bitmap(width, height, COLORS.background);
    const bounds = paddedBounds(scan, decision);
    const project = projector(bounds, width, height);

    drawGrid(bitmap, bounds, project);
    drawExistingFleetPaths(bitmap, scan, project);
    drawDefenseThreats(bitmap, scan, decision, project);
    drawDefenseHubs(bitmap, scan, decision, project);
    drawPlannedOrders(bitmap, scan, decision.commands, project);
    drawStars(bitmap, scan, decision, project);
    drawFleets(bitmap, scan, project);
    drawLegend(bitmap, scan, decision);

    const dir = join(options.rootDir ?? ".", `game-${safePathPart(options.gameId)}`);
    await mkdir(dir, { recursive: true });
    const path = join(dir, `debug-map-tick-${decision.metadata.tick}.png`);
    await writeFile(path, encodePng(bitmap));
    return path;
}

function drawGrid(bitmap: Bitmap, bounds: Bounds, project: (point: Point) => Point) {
    const xStart = Math.floor(bounds.minX * 2) / 2;
    const xEnd = Math.ceil(bounds.maxX * 2) / 2;
    for (let x = xStart; x <= xEnd; x += 0.5) {
        const a = project({ x, y: bounds.minY });
        const b = project({ x, y: bounds.maxY });
        bitmap.line(a.x, a.y, b.x, b.y, COLORS.grid, 1);
    }
    const yStart = Math.floor(bounds.minY * 2) / 2;
    const yEnd = Math.ceil(bounds.maxY * 2) / 2;
    for (let y = yStart; y <= yEnd; y += 0.5) {
        const a = project({ x: bounds.minX, y });
        const b = project({ x: bounds.maxX, y });
        bitmap.line(a.x, a.y, b.x, b.y, COLORS.grid, 1);
    }
}

function drawExistingFleetPaths(bitmap: Bitmap, scan: ScanningData, project: (point: Point) => Point) {
    for (const fleet of Object.values(scan.fleets)) {
        const firstOrder = fleet.o[0];
        if (!firstOrder) continue;
        const target = scan.stars[String(firstOrder[1])];
        if (!target) continue;
        const from = project(fleet);
        const to = project(target);
        bitmap.line(from.x, from.y, to.x, to.y, COLORS.existingPath, 1);
    }
}

function drawDefenseThreats(bitmap: Bitmap, scan: ScanningData, decision: DecisionRecord, project: (point: Point) => Point) {
    for (const threat of decision.defenseGraph.threats.slice(0, 16)) {
        const origin = threat.originName.toLowerCase().startsWith("fleet")
            ? scan.fleets[String(threat.originUid)]
            : scan.stars[String(threat.originUid)];
        const target = scan.stars[String(threat.targetUid)];
        if (!origin || !target) continue;
        const from = project(origin);
        const to = project(target);
        bitmap.dashedLine(from.x, from.y, to.x, to.y, COLORS.threat, 2, 8, 6);
        drawArrowHead(bitmap, from, to, COLORS.threat);
    }
}

function drawDefenseHubs(bitmap: Bitmap, scan: ScanningData, decision: DecisionRecord, project: (point: Point) => Point) {
    for (const hub of decision.defenseGraph.hubs) {
        const hubStar = scan.stars[String(hub.hubStarUid)];
        if (!hubStar) continue;
        const hp = project(hubStar);
        bitmap.circle(hp.x, hp.y, 20, COLORS.hub, 3);
        bitmap.circle(hp.x, hp.y, 27, rgba(255, 219, 88, 130), 1);
        bitmap.text(`HUB ${hub.currentReserveShips}/${hub.reserveShipsRequired}`, hp.x + 24, hp.y - 28, COLORS.hub, 2);
        for (const targetUid of hub.coveredTargetUids) {
            const target = scan.stars[String(targetUid)];
            if (!target || target.uid === hubStar.uid) continue;
            const tp = project(target);
            bitmap.dashedLine(hp.x, hp.y, tp.x, tp.y, rgba(255, 219, 88, 145), 2, 5, 8);
        }
    }
}

function drawPlannedOrders(bitmap: Bitmap, scan: ScanningData, commands: PlannedCommand[], project: (point: Point) => Point) {
    for (const command of commands) {
        if (command.kind === "fleet_order") {
            const parsed = parseFleetOrder(command.order);
            if (!parsed) continue;
            const fleet = scan.fleets[String(parsed.fleetUid)];
            const target = scan.stars[String(parsed.targetUid)];
            if (!fleet || !target) continue;
            const from = project(fleet);
            const to = project(target);
            const color = planColor(command.reason);
            if (fleet.ouid === target.uid && parsed.action === 2) {
                bitmap.circle(to.x, to.y, 34, COLORS.defense, 3);
                bitmap.text(`GARRISON F${fleet.uid}`, to.x + 28, to.y + 12, COLORS.defense, 2);
            } else {
                bitmap.line(from.x, from.y, to.x, to.y, color, 4);
                drawArrowHead(bitmap, from, to, color);
            }
        } else if (command.kind === "new_fleet") {
            const parsed = parseNewFleet(command.order);
            if (!parsed || command.followUpTargetUid === undefined) continue;
            const source = scan.stars[String(parsed.sourceUid)];
            const target = scan.stars[String(command.followUpTargetUid)];
            if (!source || !target) continue;
            const from = project(source);
            const to = project(target);
            const color = planColor(command.reason);
            bitmap.line(from.x, from.y, to.x, to.y, color, 4);
            drawArrowHead(bitmap, from, to, color);
            bitmap.text(`NEW ${parsed.ships}`, from.x + 12, from.y + 18, color, 2);
        }
    }
}

function drawStars(bitmap: Bitmap, scan: ScanningData, decision: DecisionRecord, project: (point: Point) => Point) {
    const hubUids = new Set(decision.defenseGraph.hubs.map((hub) => hub.hubStarUid));
    const plannedTargetUids = new Set(plannedTargetUidsFromCommands(decision.commands));
    const threatTargetUids = new Set(decision.defenseGraph.threats.map((threat) => threat.targetUid));
    for (const star of Object.values(scan.stars)) {
        const p = project(star);
        const color = starColor(scan, star);
        const radius = star.puid === scan.playerUid ? 7 : star.puid <= 0 ? 4 : 6;
        bitmap.fillCircle(p.x, p.y, radius + 2, rgba(0, 0, 0, 180));
        bitmap.fillCircle(p.x, p.y, radius, color);
        if (isScanned(star)) {
            bitmap.text(String(star.st), p.x + 8, p.y - 5, COLORS.text, 1);
        }
        if (hubUids.has(star.uid) || plannedTargetUids.has(star.uid) || threatTargetUids.has(star.uid) || star.puid === scan.playerUid) {
            const label = `${star.n} ${isScanned(star) ? `NR${star.nr}` : ""}`.trim();
            bitmap.text(label, p.x + 10, p.y + 8, star.puid === scan.playerUid ? COLORS.own : COLORS.text, 1);
        }
    }
}

function drawFleets(bitmap: Bitmap, scan: ScanningData, project: (point: Point) => Point) {
    for (const fleet of Object.values(scan.fleets)) {
        if (fleet.ouid) continue;
        const p = project(fleet);
        const color = playerColor(scan, fleet.puid);
        bitmap.fillRect(Math.round(p.x - 4), Math.round(p.y - 4), 8, 8, color);
        bitmap.text(String(fleet.st), p.x + 7, p.y - 3, COLORS.text, 1);
    }
}

function drawLegend(bitmap: Bitmap, scan: ScanningData, decision: DecisionRecord) {
    bitmap.fillRect(14, 14, 540, 104, rgba(0, 0, 0, 170));
    bitmap.rect(14, 14, 540, 104, rgba(75, 92, 116), 1);
    bitmap.text(`${scan.name} TICK ${scan.tick}  ${decision.metadata.dryRun ? "DRY RUN" : "SUBMIT"}`, 28, 30, COLORS.text, 2);
    bitmap.text(`HUBS ${decision.defenseGraph.hubs.length}  THREATS ${decision.defenseGraph.threats.length}  ORDERS ${decision.commands.length}`, 28, 54, COLORS.mutedText, 2);
    bitmap.text("YELLOW HUB/COVERAGE  RED THREAT  GREEN DEFENSE  BLUE EXPANSION  RED ATTACK", 28, 80, COLORS.mutedText, 1);
    const player = scan.players[String(scan.playerUid)];
    bitmap.text(`PLAYER ${player?.alias ?? scan.playerUid}`, 28, 96, COLORS.own, 1);
}

function parseFleetOrder(order: string) {
    const parts = order.split(",");
    if (parts[0] !== "add_fleet_orders") return undefined;
    return {
        fleetUid: Number(parts[1]),
        targetUid: Number(parts[3]),
        action: Number(parts[4]),
        amount: Number(parts[5]),
    };
}

function parseNewFleet(order: string) {
    const parts = order.split(",");
    if (parts[0] !== "new_fleet") return undefined;
    return {
        sourceUid: Number(parts[1]),
        ships: Number(parts[2]),
    };
}

function plannedTargetUidsFromCommands(commands: PlannedCommand[]) {
    const uids: number[] = [];
    for (const command of commands) {
        if (command.kind === "fleet_order") {
            const parsed = parseFleetOrder(command.order);
            if (parsed) uids.push(parsed.targetUid);
        }
        if (command.followUpTargetUid !== undefined) {
            uids.push(command.followUpTargetUid);
        }
    }
    return uids;
}

function planColor(reason: string) {
    if (/garrison|defen|reinforce|hub/i.test(reason)) return COLORS.defense;
    if (/attack|counter/i.test(reason)) return COLORS.attack;
    if (/neutral|expansion|capture/i.test(reason)) return COLORS.expansion;
    if (/return|supply|stage|resupply/i.test(reason)) return COLORS.logistics;
    return COLORS.white;
}

function drawArrowHead(bitmap: Bitmap, from: Point, to: Point, color: Rgba) {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const size = 12;
    const a = angle + Math.PI * 0.78;
    const b = angle - Math.PI * 0.78;
    bitmap.line(to.x, to.y, to.x + Math.cos(a) * size, to.y + Math.sin(a) * size, color, 3);
    bitmap.line(to.x, to.y, to.x + Math.cos(b) * size, to.y + Math.sin(b) * size, color, 3);
}

function starColor(scan: ScanningData, star: Star) {
    if (!isScanned(star)) return COLORS.unscanned;
    if (star.puid <= 0) return COLORS.neutral;
    return playerColor(scan, star.puid);
}

function playerColor(scan: ScanningData, uid: number) {
    const player = scan.players[String(uid)];
    if (!player) return COLORS.neutral;
    return PLAYER_COLORS[player.color % PLAYER_COLORS.length] ?? COLORS.white;
}

function paddedBounds(scan: ScanningData, decision: DecisionRecord): Bounds {
    const points: Point[] = [
        ...Object.values(scan.stars).filter((star) => star.puid === scan.playerUid),
        ...Object.values(scan.fleets).filter((fleet) => fleet.puid === scan.playerUid),
    ];
    for (const command of decision.commands) {
        if (command.kind === "fleet_order") {
            const parsed = parseFleetOrder(command.order);
            if (!parsed) continue;
            const fleet = scan.fleets[String(parsed.fleetUid)];
            const target = scan.stars[String(parsed.targetUid)];
            if (fleet) points.push(fleet);
            if (target) points.push(target);
        }
        if (command.kind === "new_fleet") {
            const parsed = parseNewFleet(command.order);
            if (!parsed) continue;
            const source = scan.stars[String(parsed.sourceUid)];
            const target = command.followUpTargetUid === undefined ? undefined : scan.stars[String(command.followUpTargetUid)];
            if (source) points.push(source);
            if (target) points.push(target);
        }
    }
    for (const threat of decision.defenseGraph.threats) {
        const origin = threat.originName.toLowerCase().startsWith("fleet")
            ? scan.fleets[String(threat.originUid)]
            : scan.stars[String(threat.originUid)];
        const target = scan.stars[String(threat.targetUid)];
        if (origin) points.push(origin);
        if (target) points.push(target);
    }
    for (const hub of decision.defenseGraph.hubs) {
        const hubStar = scan.stars[String(hub.hubStarUid)];
        if (hubStar) points.push(hubStar);
        for (const targetUid of hub.coveredTargetUids) {
            const target = scan.stars[String(targetUid)];
            if (target) points.push(target);
        }
    }
    if (points.length < 3) {
        points.push(...Object.values(scan.stars), ...Object.values(scan.fleets));
    }
    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    const xPad = Math.max(0.1, (maxX - minX) * 0.08);
    const yPad = Math.max(0.1, (maxY - minY) * 0.08);
    return { minX: minX - xPad, maxX: maxX + xPad, minY: minY - yPad, maxY: maxY + yPad };
}

function projector(bounds: Bounds, width: number, height: number) {
    const scale = Math.min(
        (width - PADDING * 2) / Math.max(0.001, bounds.maxX - bounds.minX),
        (height - PADDING * 2) / Math.max(0.001, bounds.maxY - bounds.minY),
    );
    const worldWidth = (bounds.maxX - bounds.minX) * scale;
    const worldHeight = (bounds.maxY - bounds.minY) * scale;
    const xOffset = (width - worldWidth) / 2;
    const yOffset = (height - worldHeight) / 2;
    return (point: Point): Point => ({
        x: xOffset + (point.x - bounds.minX) * scale,
        y: yOffset + (point.y - bounds.minY) * scale,
    });
}

function isScanned(star: Star): star is Star & { st: number; nr: number } {
    return (star as { v?: unknown }).v === 1 || (star as { v?: unknown }).v === "1";
}

function safePathPart(value: string) {
    return value.replace(/[^A-Za-z0-9_-]/g, "_");
}

class Bitmap {
    readonly data: Uint8Array;

    constructor(readonly width: number, readonly height: number, background: Rgba) {
        this.data = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                this.blendPixel(x, y, background);
            }
        }
    }

    blendPixel(xRaw: number, yRaw: number, color: Rgba) {
        const x = Math.round(xRaw);
        const y = Math.round(yRaw);
        if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
        const index = (y * this.width + x) * 4;
        const alpha = color.a / 255;
        const inv = 1 - alpha;
        this.data[index] = Math.round(color.r * alpha + (this.data[index] ?? 0) * inv);
        this.data[index + 1] = Math.round(color.g * alpha + (this.data[index + 1] ?? 0) * inv);
        this.data[index + 2] = Math.round(color.b * alpha + (this.data[index + 2] ?? 0) * inv);
        this.data[index + 3] = 255;
    }

    line(x0: number, y0: number, x1: number, y1: number, color: Rgba, width = 1) {
        const dx = x1 - x0;
        const dy = y1 - y0;
        const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
        for (let i = 0; i <= steps; i += 1) {
            const t = i / steps;
            this.fillCircle(x0 + dx * t, y0 + dy * t, Math.max(0.5, width / 2), color);
        }
    }

    dashedLine(x0: number, y0: number, x1: number, y1: number, color: Rgba, width = 1, dash = 6, gap = 4) {
        const length = Math.hypot(x1 - x0, y1 - y0);
        if (length <= 0) return;
        let pos = 0;
        while (pos < length) {
            const start = pos / length;
            const end = Math.min(length, pos + dash) / length;
            this.line(
                x0 + (x1 - x0) * start,
                y0 + (y1 - y0) * start,
                x0 + (x1 - x0) * end,
                y0 + (y1 - y0) * end,
                color,
                width,
            );
            pos += dash + gap;
        }
    }

    fillCircle(cx: number, cy: number, radius: number, color: Rgba) {
        const r = Math.ceil(radius);
        for (let y = -r; y <= r; y += 1) {
            for (let x = -r; x <= r; x += 1) {
                if (x * x + y * y <= radius * radius) this.blendPixel(cx + x, cy + y, color);
            }
        }
    }

    circle(cx: number, cy: number, radius: number, color: Rgba, width = 1) {
        const steps = Math.max(24, Math.ceil(radius * 6));
        for (let i = 0; i < steps; i += 1) {
            const a = (i / steps) * Math.PI * 2;
            this.fillCircle(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, width / 2, color);
        }
    }

    fillRect(x: number, y: number, width: number, height: number, color: Rgba) {
        for (let yy = y; yy < y + height; yy += 1) {
            for (let xx = x; xx < x + width; xx += 1) {
                this.blendPixel(xx, yy, color);
            }
        }
    }

    rect(x: number, y: number, width: number, height: number, color: Rgba, strokeWidth = 1) {
        this.fillRect(x, y, width, strokeWidth, color);
        this.fillRect(x, y + height - strokeWidth, width, strokeWidth, color);
        this.fillRect(x, y, strokeWidth, height, color);
        this.fillRect(x + width - strokeWidth, y, strokeWidth, height, color);
    }

    text(text: string, x: number, y: number, color: Rgba, scale = 1) {
        let cursor = Math.round(x);
        const upper = text.toUpperCase();
        for (const char of upper) {
            if (char === " ") {
                cursor += 4 * scale;
                continue;
            }
            const glyph = FONT[char] ?? FONT["?"];
            if (!glyph) continue;
            for (let row = 0; row < glyph.length; row += 1) {
                const bits = glyph[row] ?? "";
                for (let col = 0; col < bits.length; col += 1) {
                    if (bits[col] !== "1") continue;
                    this.fillRect(cursor + col * scale, Math.round(y) + row * scale, scale, scale, color);
                }
            }
            cursor += 6 * scale;
        }
    }
}

function encodePng(bitmap: Bitmap) {
    const raw = Buffer.alloc((bitmap.width * 4 + 1) * bitmap.height);
    for (let y = 0; y < bitmap.height; y += 1) {
        const rowStart = y * (bitmap.width * 4 + 1);
        raw[rowStart] = 0;
        Buffer.from(bitmap.data.buffer, y * bitmap.width * 4, bitmap.width * 4)
            .copy(raw, rowStart + 1);
    }
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        pngChunk("IHDR", Buffer.concat([
            uint32(bitmap.width),
            uint32(bitmap.height),
            Buffer.from([8, 6, 0, 0, 0]),
        ])),
        pngChunk("IDAT", deflateSync(raw)),
        pngChunk("IEND", Buffer.alloc(0)),
    ]);
}

function pngChunk(type: string, data: Buffer) {
    const typeBuffer = Buffer.from(type, "ascii");
    return Buffer.concat([
        uint32(data.length),
        typeBuffer,
        data,
        uint32(crc32(Buffer.concat([typeBuffer, data]))),
    ]);
}

function uint32(value: number) {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32BE(value >>> 0, 0);
    return buffer;
}

function crc32(buffer: Buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc ^= byte;
        for (let k = 0; k < 8; k += 1) {
            crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function rgba(r: number, g: number, b: number, a = 255): Rgba {
    return { r, g, b, a };
}

const FONT: Record<string, string[]> = {
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    "C": ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
    "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
    "G": ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
    "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    "I": ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
    "J": ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
    "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
    "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    "Q": ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
    "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
    "W": ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
    "X": ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
    "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
    "Z": ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
    "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
    "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
    "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
    "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
    "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
    "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
    "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
    ":": ["00000", "00100", "00100", "00000", "00100", "00100", "00000"],
    ".": ["00000", "00000", "00000", "00000", "00000", "00100", "00100"],
    "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
    "/": ["00001", "00001", "00010", "00100", "01000", "10000", "10000"],
    "?": ["01110", "10001", "00001", "00010", "00100", "00000", "00100"],
    "'": ["00100", "00100", "01000", "00000", "00000", "00000", "00000"],
};
