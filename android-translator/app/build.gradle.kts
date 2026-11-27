plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.mymusic.translator"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.mymusic.translator"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("cz.adaptech.tesseract4android:tesseract4android:4.9.0")
}
