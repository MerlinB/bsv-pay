import Plugins from "./plugins"
import { DEFAULT_RATE } from "./config"

import type { ProviderPlugin, PluginOptions, broadcastResult } from "./classes"
import type { FetchFunc } from "../@types/node-fetch"
import type { Tx } from "bsv"

type Options =
  | {
      plugins?: ProviderPlugin[]
      fetchFunc: FetchFunc
      DEBUG?: boolean
    } & {
      [plugin: string]: false | PluginOptions
    }

type broadcastReport = {
  [plugin: string]: broadcastResult
}

type statusReport = {
  [plugin: string]: any
}

export default class BsvPay {
  DEBUG: boolean
  plugins: ProviderPlugin[] = []

  constructor({ fetchFunc, DEBUG = false, plugins = [], ...params }: Options) {
    this.DEBUG = DEBUG

    const usePlugins = [...plugins, ...Plugins]

    usePlugins.map(Plugin => {
      const name = Plugin.name

      if (params[name] !== false) {
        const pluginOptions: PluginOptions = {
          DEBUG,
          fetchFunc,
          ...params[name],
        }

        try {
          // @ts-ignore Doesn't recognize instance of abstract class sub-class
          const plugin = new Plugin({
            DEBUG,
            fetchFunc,
            ...params[name],
          })
          this.plugins.push(plugin)
        } catch (err) {
          console.log(
            `bsv-pay: plugin ${name} disabled. ${(err as Error).message}`
          )
        }
      }
    })
  }

  async broadcast({
    tx,
    verbose,
    callback,
  }: {
    tx: string | Tx
    verbose: boolean
    callback: (report: broadcastReport) => void
  }) {
    // Ensure backwards-compatibility if called with bsv.js tx
    const txHex = typeof tx === "string" ? tx : tx.toBuffer().toString("hex")

    // Try all plugins in parallel, resolve as soon as one returns a success message
    // Throw if no plugin was successful
    let err: string | undefined = undefined

    const result = await new Promise(async resolve => {
      const report: broadcastReport = {}

      await Promise.all(
        this.plugins.map(async plugin => {
          try {
            const result = await plugin.broadcast({ txhex: txHex, verbose })
            report[plugin.name] = result
            if ("txid" in result) {
              resolve(result)
            } else if (result.error && !err) {
              err = result.error
            }
          } catch (error) {
            this.DEBUG && console.error(`bsv-pay: broadcast error`, error)
          }
        })
      )
      if (typeof callback === "function") callback(report)
    })

    if (result) return result

    throw new Error(err)
  }

  async status({
    txid,
    verbose,
    callback,
  }: {
    txid: string
    verbose: boolean
    callback: (report: statusReport) => void
  }): Promise<statusReport | false | (any & { name: string })> {
    return await new Promise(async resolve => {
      const report: statusReport = {}

      await Promise.all(
        this.plugins.map(async plugin => {
          try {
            const status = await plugin.status({ txid, verbose })
            report[plugin.name] = status

            if (status.valid === true) {
              resolve({ ...status, name: plugin.name })
            }
          } catch (err) {
            this.DEBUG && console.error(`bsv-pay: status error`, err)
          }
        })
      )
      if (typeof callback === "function") callback(report)
      resolve(false)
    })
  }

  feePerKb() {
    return Math.min(
      ...this.plugins.map(plugin => plugin.getRate() || DEFAULT_RATE)
    )
  }
}
