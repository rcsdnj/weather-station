package com.rcsdnj.weatherstation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TileContentTest {
    private val now = 1_800_000_000L

    private fun metric(valor: String, idade: String) =
        """{"valor": $valor, "idade_s": $idade, "expirado": false, "estatisticas": {}}"""

    private fun status(
        vento: String = metric("5.0", "1"),
        temperatura: String = metric("23.44", "2"),
        humidade: String = metric("61.2", "2"),
    ) = parseStatus("""{"vento": $vento, "temperatura": $temperatura, "humidade": $humidade}""")

    private val noData = metric("null", "null")

    private fun content(
        status: StationStatus? = status(),
        secondsSinceFetch: Long = 0,
        lastFetchFailed: Boolean = false,
    ) = buildContent(status, secondsSinceFetch, lastFetchFailed, now)

    @Test
    fun freshReadingsAreFormattedWithUnits() {
        val content = content()
        assertEquals("18.0 km/h", content.wind)
        assertEquals("23.4 °C", content.temperature)
        assertEquals("61.2 %", content.humidity)
        assertEquals("agora", content.footer)
    }

    @Test
    fun footerUsesFreshestReadingIncludingTimeSinceFetch() {
        val content = content(secondsSinceFetch = 11)
        assertEquals("há 12 s", content.footer)
        assertEquals(now - 12, content.freshestReadingEpochSeconds)
    }

    @Test
    fun footerAgeFormats() {
        assertEquals("agora", formatAge(4))
        assertEquals("há 5 s", formatAge(5))
        assertEquals("há 59 s", formatAge(59))
        assertEquals("há 1 min", formatAge(60))
        assertEquals("há 59 min", formatAge(3599))
        assertEquals("há 1 h", formatAge(3600))
        assertEquals("há 2 d", formatAge(2 * 86400))
    }

    @Test
    fun everyFooterFitsTheBottomSlot() {
        val footers = listOf(5L, 59, 3599, 86399, 99 * 86400).map(::formatAge) +
            listOf("Sem conexão", "Sem dados")
        footers.forEach { assertTrue("too long: $it", it.length <= 17) }
    }

    @Test
    fun sensorWithNoDataShowsDashesWithoutAffectingOthers() {
        val content = content(status(vento = noData))
        assertEquals("--", content.wind)
        assertEquals("23.4 °C", content.temperature)
        assertEquals(now - 2, content.freshestReadingEpochSeconds)
    }

    @Test
    fun readingExactlyAtTheLimitIsStillShown() {
        assertEquals("18.0 km/h", content(status(vento = metric("5.0", "300"))).wind)
    }

    @Test
    fun onlyTheExpiredSensorShowsDashes() {
        val content = content(status(temperatura = metric("23.4", "301")))
        assertEquals("--", content.temperature)
        assertEquals("18.0 km/h", content.wind)
        assertEquals("agora", content.footer)
    }

    @Test
    fun cachedValuesExpireWhileWaiting() {
        val content = content(secondsSinceFetch = 600)
        assertEquals("--", content.wind)
        assertEquals("--", content.temperature)
        assertEquals("--", content.humidity)
        assertEquals("há 10 min", content.footer)
    }

    @Test
    fun allSensorsWithoutDataSaySo() {
        val content = content(status(noData, noData, noData))
        assertEquals("Sem dados", content.footer)
        assertNull(content.freshestReadingEpochSeconds)
    }

    @Test
    fun failedFetchKeepsRecentValuesAndSaysSo() {
        val content = content(secondsSinceFetch = 119, lastFetchFailed = true)
        assertEquals("18.0 km/h", content.wind)
        assertEquals("Sem conexão", content.footer)
        assertNull(content.freshestReadingEpochSeconds)
    }

    @Test
    fun noCacheAndNoConnection() {
        val content = content(status = null, lastFetchFailed = true)
        assertEquals("--", content.wind)
        assertEquals("Sem conexão", content.footer)
    }

    @Test
    fun clockGoingBackwardsDoesNotReduceAges() {
        val content = content(secondsSinceFetch = -500)
        assertEquals("18.0 km/h", content.wind)
        assertEquals("agora", content.footer)
    }

    @Test(expected = org.json.JSONException::class)
    fun malformedResponseIsRejected() {
        parseStatus("""{"vento": {}}""")
    }
}
