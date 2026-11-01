/**
 * dsh-mirazero-bridge — Host plugin entry.
 *
 * A MiraZero public request creates one DSH Session in the dedicated MiraZero
 * workspace. That Session has the character prompt, accepts text and images,
 * and has no executable tool surface: global tools are removed and a guard
 * denies any remaining call. The reply is sent back through MiraZero's
 * third-party plugin API with the configured key.
 */
import { MiraZeroBridge } from './lib/bridge.js'
import { registerRoutes } from './lib/routes.js'
import { createTools } from './lib/tools.js'
import { isConfigured, missingConfig } from './lib/config.js'
import { describeError } from './lib/util.js'

export const name = 'dsh-mirazero-bridge'
export const inject = ['tools', 'sessionController', 'sessions', 'systemPrompt']

export function apply(ctx, config = {}) {
  let bridge
  try {
    bridge = new MiraZeroBridge({ ctx, config })
  } catch (error) {
    // A malformed baseUrl should disable the plugin, not the whole profile.
    ctx.logger?.error?.(`mirazero: initialization failed: ${describeError(error)}`)
    return
  }
  ctx.provide('mirazeroBridge', bridge)

  ctx.effect(() => {
    const disposers = []
    try {
      disposers.push(bridge.install())
      for (const definition of createTools(bridge)) {
        disposers.push(ctx.tools.register(definition))
      }
      disposers.push(registerRoutes(ctx, bridge))
    } catch (error) {
      bridge.logger.error(`registration failed: ${describeError(error)}`)
    }

    if (bridge.config.autoStart === true) {
      void (async () => {
        if (!isConfigured(bridge.config)) {
          bridge.logger.warn(`autoStart skipped; missing ${missingConfig(bridge.config).join(', ')}`)
          return
        }
        try {
          await bridge.start()
        } catch (error) {
          bridge.logger.error(`autoStart failed: ${describeError(error)}`)
        }
      })()
    } else {
      bridge.logger.info('bridge loaded; autoStart is off')
    }

    return () => {
      try {
        bridge.stop('plugin-unload')
      } catch {
        // unload must not throw
      }
      for (const dispose of disposers.reverse()) {
        try {
          dispose?.()
        } catch {
          // ignore a broken disposer
        }
      }
    }
  })
}
