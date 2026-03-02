import { z } from 'zod';
import { EvaluateInputSchema, GuardResultSchema } from '@local-mcp-board/shared';
import { createBoard, getBoard, getRun, listBoards, searchEvents } from '../db/store.js';
import { evaluate } from '../engine/evaluate.js';
const BoardGetSchema = z.object({ id: z.string() });
const RunGetSchema = z.object({ id: z.string() });
const EventSearchSchema = z.object({ query: z.string().default(''), limit: z.number().int().min(1).max(500).default(100) });
function guardByType(type, input) {
    const parsed = EvaluateInputSchema.parse(input);
    return GuardResultSchema.parse(evaluate({ ...parsed, action: { ...parsed.action, type } }));
}
export const toolRegistry = {
    'guard.evaluate': {
        input: EvaluateInputSchema,
        run: (input) => GuardResultSchema.parse(evaluate(EvaluateInputSchema.parse(input)))
    },
    'guard.send_email': { input: EvaluateInputSchema, run: (input) => guardByType('send_email', input) },
    'guard.code_merge': { input: EvaluateInputSchema, run: (input) => guardByType('code_merge', input) },
    'guard.publish': { input: EvaluateInputSchema, run: (input) => guardByType('publish', input) },
    'guard.support_reply': { input: EvaluateInputSchema, run: (input) => guardByType('support_reply', input) },
    'persona.generate': {
        input: z.object({ boardName: z.string().default('default') }),
        run: (input) => ({ board: createBoard(z.object({ boardName: z.string().default('default') }).parse(input).boardName) })
    },
    'persona.respawn': {
        input: z.object({ boardId: z.string() }),
        run: (input) => ({ status: 'RESPAWN_SCaffold', board: getBoard(z.object({ boardId: z.string() }).parse(input).boardId) })
    },
    'board.list': { input: z.object({}), run: () => ({ boards: listBoards() }) },
    'board.get': { input: BoardGetSchema, run: (input) => ({ board: getBoard(BoardGetSchema.parse(input).id) }) },
    'run.get': { input: RunGetSchema, run: (input) => ({ run: getRun(RunGetSchema.parse(input).id) }) },
    'audit.search': { input: EventSearchSchema, run: (input) => ({ events: searchEvents(EventSearchSchema.parse(input).query, EventSearchSchema.parse(input).limit) }) },
    'human.approve': {
        input: z.object({ runId: z.string(), approver: z.string().default('human') }),
        run: (input) => ({ status: 'PENDING_SCaffold', input: z.object({ runId: z.string(), approver: z.string().default('human') }).parse(input) })
    }
};
export function invokeTool(name, input) {
    const tool = toolRegistry[name];
    const parsed = tool.input.parse(input);
    return tool.run(parsed);
}
export function listToolNames() {
    return Object.keys(toolRegistry);
}
