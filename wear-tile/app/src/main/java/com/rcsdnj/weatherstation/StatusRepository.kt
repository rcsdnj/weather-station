package com.rcsdnj.weatherstation

import android.content.Context
import android.util.Log
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Log tag for everything the tile does: `adb logcat -s WeatherTile`. */
internal const val TAG = "WeatherTile"

private const val STATUS_URL = "https://rcsdnj-station.duckdns.org/api/status"
private const val NETWORK_TIMEOUT_MS = 10_000
private const val KEY_JSON = "json"
private const val KEY_FETCHED_AT = "fetched_at"
private const val KEY_LAST_ATTEMPT = "last_attempt"
private const val KEY_LAST_FAILED = "last_failed"

data class CachedStatus(
    val status: StationStatus?,
    val secondsSinceFetch: Long,
    val lastFetchFailed: Boolean,
)

/** Fetches /api/status and keeps the last good response on the watch. */
class StatusRepository(context: Context) {
    private val prefs = context.applicationContext
        .getSharedPreferences("station_status", Context.MODE_PRIVATE)

    fun millisSinceLastAttempt(): Long =
        System.currentTimeMillis() - prefs.getLong(KEY_LAST_ATTEMPT, 0L)

    fun cached(): CachedStatus {
        val status = prefs.getString(KEY_JSON, null)?.let { json ->
            // A cache we can't read is the same as having no cache.
            runCatching { parseStatus(json) }.getOrNull()
        }
        return CachedStatus(
            status = status,
            secondsSinceFetch =
                (System.currentTimeMillis() - prefs.getLong(KEY_FETCHED_AT, 0L)) / 1000,
            lastFetchFailed = prefs.getBoolean(KEY_LAST_FAILED, false),
        )
    }

    /** Returns whether the fetch succeeded. Failures keep the previous cache. */
    suspend fun refresh(): Boolean = withContext(Dispatchers.IO) {
        val started = System.currentTimeMillis()
        // Recorded before the request, so a slow fetch can't make the next tile
        // request think another fetch is already due.
        prefs.edit().putLong(KEY_LAST_ATTEMPT, started).apply()

        val result = runCatching { download().also(::parseStatus) }
        val json = result.getOrNull()
        val duration = System.currentTimeMillis() - started
        if (json != null) {
            Log.i(TAG, "fetch ok in $duration ms")
        } else {
            Log.i(TAG, "fetch failed in $duration ms: ${result.exceptionOrNull()}")
        }

        val editor = prefs.edit().putBoolean(KEY_LAST_FAILED, json == null)
        if (json != null) {
            editor.putString(KEY_JSON, json).putLong(KEY_FETCHED_AT, started)
        }
        editor.apply()
        json != null
    }

    private fun download(): String {
        val connection = URL(STATUS_URL).openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = NETWORK_TIMEOUT_MS
            connection.readTimeout = NETWORK_TIMEOUT_MS
            check(connection.responseCode == HttpURLConnection.HTTP_OK) {
                "HTTP ${connection.responseCode}"
            }
            return connection.inputStream.bufferedReader().use { it.readText() }
        } finally {
            connection.disconnect()
        }
    }
}
