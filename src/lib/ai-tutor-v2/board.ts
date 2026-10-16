import type { BoardAction, SceneNode } from "@/lib/ai-tutor-v2/types";

export type BoardNodes = Record<string, SceneNode>;

export function emptyBoard(): BoardNodes {
  return {};
}

export function applyBoardAction(
  nodes: BoardNodes,
  action: BoardAction,
): BoardNodes {
  const next = { ...nodes };
  if (action.type === "create") {
    next[action.node.id] = action.node;
    return next;
  }
  if (action.type === "update") {
    const current = next[action.target_id];
    if (!current) return next;
    next[action.target_id] = { ...current, ...action.patch } as SceneNode;
    return next;
  }
  if (action.type === "remove") {
    delete next[action.target_id];
    return next;
  }
  return next;
}

export function isBoardAction(value: unknown): value is BoardAction {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return (
    type === "create" ||
    type === "update" ||
    type === "remove" ||
    type === "point"
  );
}
