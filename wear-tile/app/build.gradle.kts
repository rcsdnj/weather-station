plugins {
    id("com.android.application")
}

android {
    namespace = "com.rcsdnj.weatherstation"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.rcsdnj.weatherstation"
        minSdk = 30
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
    }
}

dependencies {
    implementation("androidx.wear.tiles:tiles:1.6.2")
    implementation("androidx.wear.protolayout:protolayout:1.4.2")
    implementation("androidx.wear.protolayout:protolayout-material3:1.4.2")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")

    testImplementation("junit:junit:4.13.2")
    // Android's org.json is only a stub in local unit tests.
    testImplementation("org.json:json:20250517")
}
