plugins {
    id("com.android.application")
}

val buildNumber = providers.environmentVariable("GITHUB_RUN_NUMBER")
    .orElse("1")
    .get()
    .toIntOrNull() ?: 1

android {
    namespace = "ru.zhenekkktut.arendats"
    compileSdk = 36

    defaultConfig {
        applicationId = "ru.zhenekkktut.arendats"
        minSdk = 26
        targetSdk = 35
        versionCode = buildNumber
        versionName = "2.0.$buildNumber"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
}
