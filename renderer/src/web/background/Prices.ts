import { ref, watch } from 'vue'
import { MainProcess } from '@/web/background/IPC'
import { selected as selectedLeague, isPublic as isPublicLeague } from './Leagues'

interface NinjaCurrencyInfo { /* eslint-disable camelcase */
  currencyTypeName: string
  receive?: {
    get_currency_id: number
    value: number
  }
  pay?: {
    get_currency_id: number
    value: number
  }
  receiveSparkLine: {
    data: Array<number | null>
    totalChange: number
  }
  lowConfidenceReceiveSparkLine: {
    data: number[]
    totalChange: number
  }
  detailsId: string
}

interface NinjaItemInfo {
  name: string
  mapTier: number
  levelRequired: number
  baseType: string | null
  stackSize: number
  variant: null
  links: number
  itemClass: number
  sparkline: { data: Array<number | null>, totalChange: number }
  lowConfidenceSparkline: { data: number[], totalChange: number[] }
  implicitModifiers: []
  explicitModifiers: Array<{ text: string, optional: boolean }>
  corrupted: false
  gemLevel: number
  gemQuality: number
  itemType: string
  chaosValue: number
  count: number
  detailsId: string
}

interface NinjaPrice {
  chaosValue: number
  graphPoints: number[]
  detailsId: string
}

let PRICE_BY_QUERY_ID = new Map<string, NinjaPrice>()

const RETRY_TIME = 60 * 1000
const UPDATE_TIME = 10 * 60 * 1000

export const chaosExaRate = ref<number | undefined>(undefined)

const priceQueue = (() => {
  function uniqueItemKey (item: NinjaItemInfo, extra = '') {
    let key = `UNIQUE::${item.name} // ${item.baseType}`
    if (item.variant) key += ` // ${item.variant}`
    if (extra) key += ` // ${extra}`
    return key
  }

  return [
    { overview: 'currency', type: 'Currency', loaded: 0 },
    { overview: 'currency', type: 'Fragment', loaded: 0 },
    { overview: 'item', type: 'Oil', loaded: 0 },
    { overview: 'item', type: 'Incubator', loaded: 0 },
    { overview: 'item', type: 'Scarab', loaded: 0 },
    { overview: 'item', type: 'Fossil', loaded: 0 },
    { overview: 'item', type: 'Resonator', loaded: 0 },
    { overview: 'item', type: 'Essence', loaded: 0 },
    { overview: 'item', type: 'DivinationCard', loaded: 0, key: (item: NinjaItemInfo) => `DIVINATION_CARD::${item.name}` },
    { overview: 'item', type: 'SkillGem', loaded: 0, key: (item: NinjaItemInfo) => `GEM::${item.name} // ${item.gemLevel} // ${item.gemQuality ?? 0}%` + ((item.corrupted) ? ' // Corrupted' : '') },
    { overview: 'item', type: 'BaseType', loaded: 0, key: (item: NinjaItemInfo) => `ITEM::${item.name} // ${item.levelRequired}` + ((item.variant) ? ` // ${item.variant}` : '') },
    // { overview: 'item', type: 'HelmetEnchant', loaded: 0 },
    { overview: 'item', type: 'BlightedMap', loaded: 0, key: (item: NinjaItemInfo) => `ITEM::${item.name} // T${item.mapTier}` },
    { overview: 'item', type: 'BlightRavagedMap', loaded: 0, key: (item: NinjaItemInfo) => `ITEM::${item.name} // T${item.mapTier}` },
    { overview: 'item', type: 'UniqueMap', loaded: 0, key: (item: NinjaItemInfo) => `UNIQUE::${item.name} // T${item.mapTier}` },
    { overview: 'item', type: 'Map', loaded: 0, key: (item: NinjaItemInfo) => `ITEM::${item.name} // T${item.mapTier}` },
    { overview: 'item', type: 'UniqueJewel', loaded: 0, key: uniqueItemKey },
    { overview: 'item', type: 'UniqueFlask', loaded: 0, key: uniqueItemKey },
    { overview: 'item', type: 'UniqueWeapon', loaded: 0, key: (item: NinjaItemInfo) => uniqueItemKey(item, (item.links) ? `${item.links}L` : '') },
    { overview: 'item', type: 'UniqueArmour', loaded: 0, key: (item: NinjaItemInfo) => uniqueItemKey(item, (item.links) ? `${item.links}L` : '') },
    { overview: 'item', type: 'UniqueAccessory', loaded: 0, key: uniqueItemKey },
    { overview: 'item', type: 'Beast', loaded: 0, key: (item: NinjaItemInfo) => `CAPTURED_BEAST::${item.name}` },
    { overview: 'item', type: 'Vial', loaded: 0 },
    { overview: 'item', type: 'DeliriumOrb', loaded: 0 },
    { overview: 'item', type: 'Invitation', loaded: 0 },
    { overview: 'item', type: 'Artifact', loaded: 0 }
  ]
})()

async function load (force: boolean = false) {
  if (!selectedLeague.value || !isPublicLeague.value) return
  const leagueAtStartOfLoad = selectedLeague.value

  for (const dataType of priceQueue) {
    if (!force) {
      if ((Date.now() - dataType.loaded) < UPDATE_TIME) continue
    }

    try {
      const response = await fetch(`${MainProcess.CORS}https://poe.ninja/api/data/${dataType.overview}overview?league=${leagueAtStartOfLoad}&type=${dataType.type}&language=en`)
      if (leagueAtStartOfLoad !== selectedLeague.value) return

      if (dataType.overview === 'currency') {
        const priceData: { lines: NinjaCurrencyInfo[] } = await response.json()

        for (const currency of priceData.lines) {
          if (!currency.receive) {
            continue
          }

          PRICE_BY_QUERY_ID.set(`ITEM::${currency.currencyTypeName}`, {
            detailsId: currency.detailsId,
            chaosValue: currency.receive.value,
            graphPoints: currency.receiveSparkLine.data.filter((point): point is number => point != null)
          })

          if (currency.detailsId === 'exalted-orb') {
            const receive = currency.receive.value
            const pay = currency.pay?.value ? (1 / currency.pay.value) : undefined
            // sanity check, better poe.ninja to implement this on its own end
            if (pay) {
              if (pay >= 15 && receive >= 15 &&
                  (Math.min(receive, pay) / Math.max(receive, pay)) >= 0.75) {
                chaosExaRate.value = receive
              } else {
                // fallback to sell price
                chaosExaRate.value = (pay >= 15) ? pay : undefined
              }
            } else {
              chaosExaRate.value = (receive >= 15) ? receive : undefined
            }
          }
        }
      } else if (dataType.overview === 'item') {
        const priceData: { lines: NinjaItemInfo[] } = await response.json()

        for (const item of priceData.lines) {
          PRICE_BY_QUERY_ID.set(dataType.key?.(item) ?? `ITEM::${item.name}`, {
            detailsId: item.detailsId,
            chaosValue: item.chaosValue,
            graphPoints: item.sparkline.data.filter((point): point is number => point != null)
          })
        }
      }

      dataType.loaded = Date.now()
    } catch (e) {}
  }
}

export function findPriceByQueryId (id: string) {
  return PRICE_BY_QUERY_ID.get(id)
}

export function autoCurrency (value: number, currency: 'chaos' | 'exa'): { min: number, max: number, currency: 'chaos' | 'exa' } {
  if (currency === 'chaos') {
    if (value > ((chaosExaRate.value || 9999) * 0.94)) {
      if (value < ((chaosExaRate.value || 9999) * 1.06)) {
        return { min: 1, max: 1, currency: 'exa' }
      } else {
        return { min: chaosToExa(value), max: chaosToExa(value), currency: 'exa' }
      }
    }
  } else if (currency === 'exa') {
    if (value < 1) {
      return { min: exaToChaos(value), max: exaToChaos(value), currency: 'chaos' }
    }
  }
  return { min: value, max: value, currency }
}

function chaosToExa (count: number) {
  return count / (chaosExaRate.value || 9999)
}

function exaToChaos (count: number) {
  return count * (chaosExaRate.value || 9999)
}

export function displayRounding (value: number, fraction: boolean = false): string {
  if (fraction && Math.abs(value) < 1) {
    if (value === 0) return '0'
    const r = `1\u200A/\u200A${displayRounding(1 / value)}`
    return r === '1\u200A/\u200A1' ? '1' : r
  }
  if (Math.abs(value) < 10) {
    return Number(value.toFixed(1)).toString().replace('.', '\u200A.\u200A')
  }
  return Math.round(value).toString()
}

// ---

setInterval(() => {
  load()
}, RETRY_TIME)

watch(selectedLeague, () => {
  chaosExaRate.value = undefined
  PRICE_BY_QUERY_ID = new Map<string, NinjaPrice>()
  load(true)
})
