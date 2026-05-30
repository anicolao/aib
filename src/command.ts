export type CommandKind =
    | "batched_order"
    | "fleet_order"
    | "new_fleet"
    | "tech_transfer"
    | "cash_transfer"
    | "alliance"
    | "ready";

export interface PlannedCommand {
    kind: CommandKind;
    order: string;
    reason: string;
    followUpTargetUid?: number;
    followUpReason?: string;
}

export interface SubmissionResult {
    submitted: boolean;
    responses: unknown[];
}

export function splitCommands(commands: PlannedCommand[]) {
    return {
        batchedOrders: commands
            .filter((command) => command.kind === "batched_order")
            .map((command) => command.order),
        orders: commands
            .filter((command) => command.kind !== "batched_order")
            .map((command) => command.order),
    };
}
