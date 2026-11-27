# MyMusic Translator – Android companion (prototype)

This is a separate Android companion app for the MyMusic website. It is intended to provide a floating translation panel over other apps after the user explicitly grants Android permissions.

## Current prototype features

- Floating bubble and panel using Android's overlay permission.
- Screen capture started only after the Android system's MediaProjection confirmation.
- OCR of visible screen text using Tesseract Arabic + English models, downloaded into the app's private storage on first use.
- Microphone-based speech recognition with selectable source language.
- Translation to Arabic through the MyMemory public translation endpoint.
- Arabic text-to-speech playback of translated segments.

## Important limitations

- The microphone listens to sound audible to the phone microphone. It is not a direct capture of another app's private audio stream. Headphones may prevent the microphone from hearing the video audio.
- Android screen capture is user-approved per session. Banking, DRM-protected, secure, or otherwise restricted apps may block screenshots or return a blank frame.
- OCR samples the visible screen periodically; this prototype does not yet replace subtitles inside the video or draw translated text over the original captions.
- Speech recognition availability and quality depend on the installed Android speech service and selected language.
- Translation uses a public third-party endpoint with rate limits; it is not suitable as a guaranteed production service.
- The app is an unsigned debug prototype. It has not yet been device-tested or published to Google Play.

## Build

Open this directory in Android Studio, or run:

```bash
gradle -p android-translator :app:assembleDebug
```

The GitHub Actions workflow `.github/workflows/android-translator.yml` runs the same debug build on pushes affecting this project.

## First run

1. Install the debug APK on an Android device (Android 8.0 or later).
2. Open MyMusic Translator and tap **تشغيل المترجم العائم**.
3. Grant **Display over other apps** and microphone permission.
4. Approve Android's screen-sharing prompt.
5. Open a video or website. Tap the floating globe to open the translation panel.
6. Choose the spoken language and start microphone translation. OCR checks visible screen text automatically while the capture session is active.

The screen-sharing notification and floating panel remain visible while the service runs. Stop the service from the panel when finished.
