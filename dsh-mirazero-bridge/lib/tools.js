/**
 * Model-facing tools for the local DSH user.
 *
 * MiraZero requests never reach these tools: each public request runs in its
 * own restricted Session. These tools are the operator surface for starting the
 * bridge, inspecting pending work, and editing the character card.
 */
import { describeError } from './util.js'

const objectOutput = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
}

function tool(name, description, properties, execute) {
  return {
    name,
    description,
    parameters: { type: 'object', properties, additionalProperties: false },
    output: objectOutput,
    async execute(args = {}) {
      try {
        return { ok: true, ...(await execute(args)) }
      } catch (error) {
        return { ok: false, error: describeError(error) }
      }
    },
  }
}

export function createTools(bridge) {
  return [
    tool(
      'mirazero_status',
      'Show the MiraZero bridge state: API mode, whether full request context is available, the MiraZero workspace, active sessions, character-card state, and isolation manifest.',
      {},
      async () => bridge.status(),
    ),
    tool(
      'mirazero_start',
      'Start polling the configured MiraZero site. Each new public request gets its own isolated DSH Session in the MiraZero workspace.',
      {},
      async () => bridge.start(),
    ),
    tool(
      'mirazero_stop',
      'Stop polling MiraZero and cancel in-flight bridge Sessions. Pending requests stay on the site.',
      {},
      async () => bridge.stop('tool'),
    ),
    tool(
      'mirazero_pending',
      'List pending MiraZero requests visible to the configured integration key (previews only).',
      { limit: { type: 'number', description: 'Maximum rows, 1-50. Default 20.' } },
      async (args) => ({ requests: await bridge.pending(Number(args.limit) || 20) }),
    ),
    tool(
      'mirazero_answer',
      'Answer one pending MiraZero request manually and finish it.',
      {
        id: { type: 'string', description: 'Pending request id.' },
        response: { type: 'string', description: 'Exact reply text to publish as the character.' },
      },
      async (args) => bridge.answer(args.id, args.response),
    ),
    tool(
      'mirazero_models',
      'List public models exposed by the MiraZero site.',
      {},
      async () => ({ models: await bridge.listModels() }),
    ),
    tool(
      'mirazero_character',
      'Read or patch the structured role-play card. Supported fields: enabled, name, description, personality, scenario, speechStyle, relationship, likes, boundaries, exampleDialogue, firstMessage, authorNote, postHistory, lorebook.',
      {
        patch: {
          type: 'object',
          additionalProperties: true,
          description: 'Partial character card. Omit to read the current card.',
        },
      },
      async (args) => {
        if (!args.patch || Object.keys(args.patch).length === 0) return { character: bridge.character() }
        return { character: bridge.setCharacter(args.patch) }
      },
    ),
    tool(
      'mirazero_isolation',
      'Show the isolation wall contract for public requests.',
      {},
      async () => isolation(bridge),
    ),
  ]
}

function isolation(bridge) {
  return bridge.status().isolation
}
