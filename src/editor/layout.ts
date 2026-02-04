import type { DocumentState, NodeId } from "./types";

export const NODE_WIDTH = 180;
export const NODE_HEIGHT = 34;
export const H_GAP = 80;
export const V_GAP = 16;
export const PADDING_X = 32;
export const PADDING_Y = 32;

export type NodePosition = { x: number; y: number; depth: number };

export type LayoutResult = {
  positions: Record<NodeId, NodePosition>;
  contentWidth: number;
  contentHeight: number;
};

export function computeLayout(doc: DocumentState): LayoutResult {
  const positions: Record<NodeId, NodePosition> = {};
  let nextY = PADDING_Y;
  let maxDepth = 0;
  let maxY = 0;

  const visit = (nodeId: NodeId, depth: number): number => {
    const node = doc.nodes[nodeId];
    if (!node) return nextY;
    maxDepth = Math.max(maxDepth, depth);

    if (node.childrenIds.length === 0) {
      const y = nextY;
      nextY += NODE_HEIGHT + V_GAP;
      positions[nodeId] = { x: PADDING_X + depth * (NODE_WIDTH + H_GAP), y, depth };
      maxY = Math.max(maxY, y);
      return y;
    }

    const childYs = node.childrenIds.map((childId) => visit(childId, depth + 1));
    const min = Math.min(...childYs);
    const max = Math.max(...childYs);
    const y = (min + max) / 2;
    positions[nodeId] = { x: PADDING_X + depth * (NODE_WIDTH + H_GAP), y, depth };
    maxY = Math.max(maxY, y);
    return y;
  };

  visit(doc.rootId, 0);

  const contentWidth =
    PADDING_X + (maxDepth + 1) * NODE_WIDTH + maxDepth * H_GAP + PADDING_X;
  const contentHeight = maxY + NODE_HEIGHT + PADDING_Y;

  return { positions, contentWidth, contentHeight };
}

export function svgPathForEdge(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const midX = (from.x + to.x) / 2;
  return `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`;
}

