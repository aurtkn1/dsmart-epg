
const fs = require("fs")
const path = require("path")

const BASE_URL =
  "https://www.dsmart.com.tr/api/v1/public/epg/schedules"

const OUTPUT_FILE = path.join(__dirname, "dsmart.xml")
const TEMP_FILE = `${OUTPUT_FILE}.tmp`

const PAGE_LIMIT = 10
const DAYS = 7
const REQUEST_DELAY = 500
const REQUEST_TIMEOUT = 20000
const MAX_RETRIES = 4

const RETRY_DELAYS = [1000, 2500, 5000, 10000]

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/*
==================================================
HTTP / JSON İSTEKLERİ
==================================================
*/

async function fetchJson(day, page) {
  const url =
    `${BASE_URL}?page=${page}` +
    `&limit=${PAGE_LIMIT}` +
    `&day=${encodeURIComponent(day)}`

  let lastError

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT
    )

    try {
      console.log(
        `  Sayfa ${page} | deneme ${attempt}/${MAX_RETRIES}`
      )

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36",
          "Accept": "application/json, text/javascript, */*; q=0.01",
          "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
          "Referer": "https://www.dsmart.com.tr/",
          "Origin": "https://www.dsmart.com.tr",
          "X-Requested-With": "XMLHttpRequest",
          "Cache-Control": "no-cache",
          "Pragma": "no-cache"
        },
        signal: controller.signal
      })

      clearTimeout(timeout)

      if (!response.ok) {
        const contentType =
          response.headers.get("content-type") || "bilinmiyor"

        const server =
          response.headers.get("server") || "bilinmiyor"

        const body = await response.text().catch(() => "")
        const preview = body.slice(0, 1500)

        console.log(`  HTTP durum kodu: ${response.status}`)
        console.log(`  Content-Type: ${contentType}`)
        console.log(`  Server: ${server}`)

        if (preview) {
          console.log(`  Yanıt içeriği: ${preview}`)
        }

        const error = new Error(
          `HTTP ${response.status}: ${url}`
        )

        error.status = response.status
        lastError = error

        const retryable = [
          408, 425, 429, 500, 502, 503, 504
        ].includes(response.status)

        // 403 gibi erişim hatalarını tekrar tekrar denemiyoruz.
        if (!retryable || attempt === MAX_RETRIES) {
          throw error
        }

        const wait = RETRY_DELAYS[attempt - 1] || 10000

        console.log(
          `  HTTP ${response.status}: ${wait / 1000} saniye sonra tekrar denenecek`
        )

        await sleep(wait)
        continue
      }

      const text = await response.text()

      if (!text.trim()) {
        throw new Error(`Boş HTTP cevabı: ${url}`)
      }

      let json

      try {
        json = JSON.parse(text)
      } catch {
        console.log(
          `  JSON olmayan yanıt: ${text.slice(0, 500)}`
        )
        throw new Error(`JSON parse hatası: ${url}`)
      }

      console.log(`  Sayfa ${page} başarılı`)
      return json

    } catch (error) {
      clearTimeout(timeout)
      lastError = error

      const status = error?.status
      const message =
        error?.name === "AbortError"
          ? `TIMEOUT (${REQUEST_TIMEOUT / 1000}s)`
          : error?.message || String(error)

      console.log(`  Sayfa ${page} hata: ${message}`)

      // HTTP hatalarını fetch katmanında tekrar değerlendirmeyelim.
      if (status) {
        throw error
      }

      if (attempt < MAX_RETRIES) {
        const wait = RETRY_DELAYS[attempt - 1] || 10000

        console.log(
          `  ${wait / 1000} saniye sonra tekrar denenecek`
        )

        await sleep(wait)
      }
    }
  }

  throw lastError || new Error(`İstek başarısız: ${url}`)
}

/*
==================================================
GENEL YARDIMCI FONKSİYONLAR
==================================================
*/

function cleanText(value) {
  if (value === null || value === undefined) return ""
  return String(value).replace(/\s+/g, " ").trim()
}

function firstValue(object, fields) {
  if (!object || typeof object !== "object") return ""

  for (const field of fields) {
    if (object[field] !== undefined && object[field] !== null) {
      const value = cleanText(object[field])
      if (value) return value
    }
  }

  return ""
}

function getChannelName(channel) {
  return firstValue(channel, [
    "channel_name",
    "name",
    "channelName",
    "title",
    "display_name",
    "displayName",
    "label"
  ])
}

function getChannelId(channel) {
  return cleanText(
    channel?._id ||
    channel?.id ||
    channel?.channel_id ||
    channel?.channelId
  )
}

function getProgramTitle(program) {
  return firstValue(program, [
    "program_name",
    "programName",
    "title",
    "name",
    "broadcast_name",
    "broadcastName",
    "event_name",
    "eventName",
    "programme",
    "program"
  ])
}

function getProgramStart(program) {
  return firstValue(program, [
    "start_date",
    "startDate",
    "start_time",
    "startTime",
    "start",
    "begin",
    "from"
  ])
}

function getProgramDay(program) {
  return firstValue(program, [
    "day",
    "date",
    "broadcast_day",
    "broadcastDay"
  ])
}

function getProgramDuration(program) {
  return firstValue(program, [
    "duration",
    "length",
    "runtime"
  ])
}

function getProgramEnd(program) {
  return firstValue(program, [
    "end_date",
    "endDate",
    "end_time",
    "endTime",
    "end",
    "stop",
    "to"
  ])
}

/*
==================================================
SÜRE VE TARİH
==================================================
*/

function parseDuration(value) {
  const text = cleanText(value)

  if (!text) throw new Error("Boş duration")

  const normalized = text.split(",").pop().trim()
  const parts = normalized.split(":").map(Number)

  if (
    parts.length !== 3 ||
    parts.some(number => !Number.isFinite(number) || number < 0)
  ) {
    throw new Error(`Geçersiz duration: ${value}`)
  }

  const [hours, minutes, seconds] = parts

  return (hours * 3600 + minutes * 60 + seconds) * 1000
}

function parseUtc(value) {
  const text = cleanText(value)

  if (!text) throw new Error("Boş tarih")

  const date = new Date(text)

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Geçersiz tarih: ${value}`)
  }

  return date
}

/*
==================================================
PROGRAM LİSTESİNİ BUL
==================================================
*/

function findSchedule(channel) {
  if (!channel) return []

  const fields = [
    "schedule",
    "schedules",
    "programs",
    "program",
    "broadcasts",
    "broadcast",
    "epg",
    "events",
    "items"
  ]

  for (const field of fields) {
    const value = channel[field]

    if (Array.isArray(value) && value.length > 0) {
      return value
    }

    if (value && typeof value === "object") {
      for (const nested of [
        "schedule",
        "schedules",
        "programs",
        "broadcasts",
        "events",
        "items",
        "data"
      ]) {
        if (Array.isArray(value[nested])) {
          return value[nested]
        }
      }
    }
  }

  return []
}

/*
==================================================
PROGRAMLARI PARSE ET
==================================================
*/

function parseSchedule(channel) {
  const channelId = getChannelId(channel)

  if (!channelId) return []

  const schedule = findSchedule(channel)
  const programs = []

  for (const program of schedule) {
    try {
      const title = getProgramTitle(program)
      const startValue = getProgramStart(program)
      const dayValue = getProgramDay
