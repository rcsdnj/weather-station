package com.rcsdnj.weatherstation

import java.util.Locale
import kotlin.math.max
import org.json.JSONObject

/** Same threshold as EXPIRY_SECONDS in data-proxy/app.py. */
private const val EXPIRY_SECONDS = 300L
private const val MS_TO_KMH = 3.6
private const val NO_VALUE = "--"

data class MetricReading(val value: Double?, val ageSeconds: Long?)

data class StationStatus(
    val wind: MetricReading,
    val temperature: MetricReading,
    val humidity: MetricReading,
)

/** What the tile shows. */
data class TileContent(
    val wind: String,
    val temperature: String,
    val humidity: String,
    /** Static footer text, also the fallback when the watch can't count the age live. */
    val footer: String,
    /** When the freshest reading was taken, so the footer can count up live. Null for problem states. */
    val freshestReadingEpochSeconds: Long? = null,
)

/** Parses a /api/status response. Throws JSONException if it's malformed. */
fun parseStatus(json: String): StationStatus {
    val root = JSONObject(json)
    return StationStatus(
        wind = root.reading("vento"),
        temperature = root.reading("temperatura"),
        humidity = root.reading("humidade"),
    )
}

private fun JSONObject.reading(metric: String): MetricReading {
    val entry = getJSONObject(metric)
    return MetricReading(
        value = if (entry.isNull("valor")) null else entry.getDouble("valor"),
        ageSeconds = if (entry.isNull("idade_s")) null else entry.getLong("idade_s"),
    )
}

/**
 * Builds the tile's text from the last known status.
 *
 * Readings are aged by the time since they were fetched, so a cached value that
 * has become too old shows as "--" instead of looking current.
 *
 * Every footer stays within about 17 characters, which is what fits the bottom slot.
 */
fun buildContent(
    status: StationStatus?,
    secondsSinceFetch: Long,
    lastFetchFailed: Boolean,
    nowEpochSeconds: Long,
): TileContent {
    if (status == null) {
        return TileContent(NO_VALUE, NO_VALUE, NO_VALUE, "Sem conexão")
    }

    val elapsed = max(0L, secondsSinceFetch)
    val ages = listOf(status.wind, status.temperature, status.humidity)
        .mapNotNull { reading -> reading.ageSeconds?.plus(elapsed) }
    val freshest = ages.minOrNull()

    val (footer, readingEpochSeconds) = when {
        lastFetchFailed -> "Sem conexão" to null
        freshest == null -> "Sem dados" to null
        else -> formatAge(freshest) to nowEpochSeconds - freshest
    }

    return TileContent(
        wind = status.wind.display(elapsed, " km/h") { it * MS_TO_KMH },
        temperature = status.temperature.display(elapsed, " °C"),
        humidity = status.humidity.display(elapsed, " %"),
        footer = footer,
        freshestReadingEpochSeconds = readingEpochSeconds,
    )
}

private fun MetricReading.display(
    elapsed: Long,
    unit: String,
    convert: (Double) -> Double = { it },
): String {
    val age = ageSeconds ?: return NO_VALUE
    val reading = value ?: return NO_VALUE
    if (age + elapsed > EXPIRY_SECONDS) {
        return NO_VALUE
    }
    return String.format(Locale.ROOT, "%.1f%s", convert(reading), unit)
}

/**
 * Age as shown in the footer. WeatherTileService.liveAge builds the same text as a
 * dynamic expression, so keep the two in step.
 */
internal fun formatAge(seconds: Long): String = when {
    seconds < 5 -> "agora"
    seconds < 60 -> "há $seconds s"
    seconds < 3600 -> "há ${seconds / 60} min"
    seconds < 86400 -> "há ${seconds / 3600} h"
    else -> "há ${seconds / 86400} d"
}
