package com.rcsdnj.weatherstation

import android.content.Context
import android.os.SystemClock
import android.util.Log
import androidx.wear.protolayout.ActionBuilders.LoadAction
import androidx.wear.protolayout.DimensionBuilders.expand
import androidx.wear.protolayout.DimensionBuilders.wrap
import androidx.wear.protolayout.LayoutElementBuilders.Box
import androidx.wear.protolayout.LayoutElementBuilders.Column
import androidx.wear.protolayout.LayoutElementBuilders.HORIZONTAL_ALIGN_START
import androidx.wear.protolayout.LayoutElementBuilders.LayoutElement
import androidx.wear.protolayout.LayoutElementBuilders.Row
import androidx.wear.protolayout.ModifiersBuilders.Clickable
import androidx.wear.protolayout.TimelineBuilders.Timeline
import androidx.wear.protolayout.TypeBuilders.StringLayoutConstraint
import androidx.wear.protolayout.expression.DynamicBuilders.DynamicInstant
import androidx.wear.protolayout.expression.DynamicBuilders.DynamicInt32
import androidx.wear.protolayout.expression.DynamicBuilders.DynamicString
import androidx.wear.protolayout.material3.MaterialScope
import androidx.wear.protolayout.material3.Typography
import androidx.wear.protolayout.material3.primaryLayout
import androidx.wear.protolayout.material3.text
import androidx.wear.protolayout.types.LayoutString
import androidx.wear.protolayout.types.layoutString
import androidx.wear.tiles.Material3TileService
import androidx.wear.tiles.RequestBuilders.TileRequest
import androidx.wear.tiles.TileBuilders.Tile
import androidx.wear.tiles.TileService
import androidx.wear.tiles.tile
import java.time.Instant
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * How often the tile asks to be redrawn. Google's guidance is not to go below once a
 * minute: faster requests may be throttled, and the timing is approximate anyway.
 * The footer's age counts up live between redraws, and a tap refreshes on demand.
 */
private val FRESHNESS_INTERVAL = 60.seconds

/** Don't contact the server more often than this on automatic redraws. */
private const val MIN_FETCH_INTERVAL_MS = 20_000L

/** Shortest gap between fetches when refreshing by tapping, to absorb double taps. */
private const val MIN_TAP_FETCH_INTERVAL_MS = 5_000L

/** How long a tile request waits for the network before drawing the cached values. */
private const val MAX_WAIT_FOR_NETWORK_MS = 2_000L

private const val REFRESH_CLICK_ID = "refresh"

/** Widest footer text, so the live age never needs more space than was laid out. */
private const val FOOTER_WIDEST_TEXT = "há 000 min"

// Lives outside the service so a slow request can finish after the tile was drawn.
private val fetchScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
private val fetchLock = Any()
private var fetchInFlight: Deferred<Boolean>? = null
private var redrawScheduledFor: Deferred<Boolean>? = null

/** Set when we ask for a redraw ourselves, so that redraw uses the cache. */
@Volatile
private var redrawingAfterLateFetch = false

@Volatile
private var lastRequestAtMs = 0L

class WeatherTileService : Material3TileService() {

    override suspend fun MaterialScope.tileResponse(requestParams: TileRequest): Tile {
        // The ID of the last tap can stay set on later requests, so this means "the
        // last tap was a refresh", not necessarily "this request came from a tap".
        val tapped = requestParams.currentState.lastClickableId == REFRESH_CLICK_ID
        logRequest(tapped)

        val repository = StatusRepository(this@WeatherTileService)
        refreshIfDue(this@WeatherTileService, repository, tapped)

        val cached = repository.cached()
        val content = buildContent(
            cached.status,
            cached.secondsSinceFetch,
            cached.lastFetchFailed,
            nowEpochSeconds = System.currentTimeMillis() / 1000,
        )

        return tile(
            timeline = Timeline.fromLayoutElement(stationLayout(content)),
            freshness = FRESHNESS_INTERVAL,
        )
    }
}

private fun logRequest(tapped: Boolean) {
    val now = SystemClock.elapsedRealtime()
    val sinceLast = if (lastRequestAtMs == 0L) "first" else "${(now - lastRequestAtMs) / 1000} s since last"
    lastRequestAtMs = now
    Log.i(TAG, "tile request ($sinceLast, last tap=${if (tapped) "refresh" else "none"})")
}

/**
 * Waits briefly for new data. If the network is slower than that (common when the
 * watch connects through the phone), the tile draws the cached values now and asks
 * for one redraw once the fetch succeeds. That redraw uses the cache, so a slow
 * network can't start a chain of fetches and redraws.
 */
private suspend fun refreshIfDue(context: Context, repository: StatusRepository, tapped: Boolean) {
    if (redrawingAfterLateFetch) {
        redrawingAfterLateFetch = false
        Log.i(TAG, "redraw after late fetch: using cache")
        return
    }

    val minInterval = if (tapped) MIN_TAP_FETCH_INTERVAL_MS else MIN_FETCH_INTERVAL_MS
    val sinceLastAttempt = repository.millisSinceLastAttempt()
    if (sinceLastAttempt < minInterval) {
        Log.i(TAG, "using cache: last fetch started ${sinceLastAttempt / 1000} s ago")
        return
    }

    val fetch = synchronized(fetchLock) {
        fetchInFlight?.takeIf { it.isActive }
            ?: fetchScope.async { repository.refresh() }.also { fetchInFlight = it }
    }

    if (withTimeoutOrNull(MAX_WAIT_FOR_NETWORK_MS) { fetch.await() } != null) {
        return
    }

    synchronized(fetchLock) {
        if (redrawScheduledFor === fetch) return
        redrawScheduledFor = fetch
    }
    Log.i(TAG, "fetch slower than $MAX_WAIT_FOR_NETWORK_MS ms: drawing cached values")
    val appContext = context.applicationContext
    fetchScope.launch {
        if (fetch.await()) {
            redrawingAfterLateFetch = true
            Log.i(TAG, "late fetch done: requesting redraw")
            TileService.getUpdater(appContext).requestUpdate(WeatherTileService::class.java)
        }
    }
}

/**
 * The footer's age as a dynamic expression, so the watch counts it up every second
 * without waking the app. Same text as formatAge in TileContent.kt. If the watch
 * can't evaluate it, the static text computed at the last redraw is shown instead.
 */
private fun footerText(content: TileContent): LayoutString {
    val readingAt = content.freshestReadingEpochSeconds ?: return content.footer.layoutString

    val seconds = DynamicInstant.withSecondsPrecision(Instant.ofEpochSecond(readingAt))
        .durationUntil(DynamicInstant.platformTimeWithSecondsPrecision())
        .toIntSeconds()

    fun ago(value: DynamicInt32, unit: String): DynamicString =
        DynamicString.constant("há ").concat(value.format()).concat(DynamicString.constant(" $unit"))

    val live = DynamicString.onCondition(seconds.lt(5)).use(DynamicString.constant("agora"))
        .elseUse(
            DynamicString.onCondition(seconds.lt(60)).use(ago(seconds, "s"))
                .elseUse(
                    DynamicString.onCondition(seconds.lt(3600)).use(ago(seconds.div(60), "min"))
                        .elseUse(
                            DynamicString.onCondition(seconds.lt(86400))
                                .use(ago(seconds.div(3600), "h"))
                                .elseUse(ago(seconds.div(86400), "d")),
                        ),
                ),
        )

    return LayoutString(
        content.footer,
        live,
        StringLayoutConstraint.Builder(FOOTER_WIDEST_TEXT).build(),
    )
}

private val refreshOnTap: Clickable =
    Clickable.Builder()
        .setId(REFRESH_CLICK_ID)
        .setOnClick(LoadAction.Builder().build())
        .build()

private fun MaterialScope.stationLayout(content: TileContent): LayoutElement =
    primaryLayout(
        titleSlot = { text("Estação".layoutString) },
        mainSlot = {
            Column.Builder()
                .setWidth(expand())
                .setHeight(wrap())
                .addContent(metricRow("Vento", content.wind))
                .addContent(metricRow("Temp.", content.temperature))
                .addContent(metricRow("Humid.", content.humidity))
                .build()
        },
        bottomSlot = { text(footerText(content), typography = Typography.LABEL_SMALL) },
        onClick = refreshOnTap,
    )

private fun MaterialScope.metricRow(label: String, value: String): LayoutElement =
    Row.Builder()
        .setWidth(expand())
        .setHeight(wrap())
        .addContent(
            // Takes the free width, which pushes the value to the row's right edge.
            Box.Builder()
                .setWidth(expand())
                .setHeight(wrap())
                .setHorizontalAlignment(HORIZONTAL_ALIGN_START)
                .addContent(
                    text(
                        label.layoutString,
                        typography = Typography.BODY_MEDIUM,
                        color = colorScheme.onSurfaceVariant,
                    ),
                )
                .build(),
        )
        .addContent(text(value.layoutString, typography = Typography.TITLE_MEDIUM))
        .build()
