# Weather station Wear OS Tile

A Tile that shows wind, temperature and humidity from
`https://rcsdnj-station.duckdns.org/api/status`.

It has no app screen, only the Tile, and it works without a phone companion app.
To use another server, change `STATUS_URL` in `StatusRepository.kt`.

## Install on the watch

You need a recent version of [Android Studio](https://developer.android.com/studio),
which must support Android Gradle Plugin 9.5.

1. On the watch, open **Settings > System > About > Versions** and tap **Build number**
   seven times to unlock developer options.
2. In **Developer options**, turn on **ADB debugging**, then connect the watch to the
   computer. A Pixel Watch 3 can use its charging cable. For Wi-Fi, turn on
   **Wireless debugging** and follow
   [Debug Wear OS over Wi-Fi](https://developer.android.com/training/wearables/get-started/debug-wifi).
3. Open this `wear-tile` folder in Android Studio.
4. Open `WeatherTileService.kt`, click the run icon next to the class name, and pick
   the watch. This installs the app and shows the Tile.

To install from a terminal instead, with `adb` and the Android SDK set up:

```
./gradlew installDebug
adb shell am broadcast -a com.google.android.wearable.app.DEBUG_SURFACE \
  --es operation add-tile \
  --ecn component com.rcsdnj.weatherstation/com.rcsdnj.weatherstation.WeatherTileService
```

The Tile stays on the watch after you disconnect. You can also add it from the watch
by long-pressing a Tile and scrolling to the add button.

## Refresh behaviour

- **Tap the Tile to refresh now.** Taps fetch at most every 5 seconds.
- The footer ("há 12 s") counts up every second on its own. The watch's clock drives
  it, so it doesn't wake the app or use the network.
- The Tile asks to refresh about every 60 seconds (`FRESHNESS_INTERVAL`). Google's
  guidance is not to go below once a minute, because faster requests may be throttled.
  The timing is approximate and generally applies while the Tile is on screen.
- Automatic refreshes contact the server at most every 20 seconds
  (`MIN_FETCH_INTERVAL_MS`).
- It waits up to 2 seconds for new data. If the network is slower, which is common
  through the phone, it draws the cached values and redraws once when the data arrives.
- A reading older than 5 minutes shows as `--`, matching the website.

## Logs

Everything the Tile does is logged under one tag:

```
adb logcat -s WeatherTile
```

Each refresh shows how long it was since the previous one, whether it fetched or used
the cache, and how long the fetch took. Watching this with the screen on and off shows
how often the Tile really refreshes, which is what decides its battery use.

## Tests

```
./gradlew testDebugUnitTest
```
