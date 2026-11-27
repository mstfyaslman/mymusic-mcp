package com.mymusic.translator

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.util.DisplayMetrics
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.ArrayAdapter
import android.widget.TextView
import com.googlecode.tesseract.android.TessBaseAPI
import java.io.File
import java.io.FileOutputStream
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.Locale
import java.util.concurrent.Executors

class TranslatorOverlayService : Service(), TextToSpeech.OnInitListener {
    companion object {
        const val EXTRA_RESULT_CODE = "projection_result_code"
        const val EXTRA_PROJECTION_DATA = "projection_data"
        private const val CHANNEL_ID = "mymusic_translator"
        private const val NOTIFICATION_ID = 71
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private lateinit var windowManager: WindowManager
    private var tessBase: TessBaseAPI? = null
    private var tts: TextToSpeech? = null
    private var speechRecognizer: SpeechRecognizer? = null
    private var listening = false
    private var speechLanguage = "en-US"
    private var lastOcrText = ""
    private var lastOcrAt = 0L
    private var bubble: Button? = null
    private var panel: LinearLayout? = null
    private var statusView: TextView? = null
    private var resultView: TextView? = null
    private var projection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private var screenWidth = 0
    private var screenHeight = 0

    override fun onCreate() {
        super.onCreate()
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        tts = TextToSpeech(this, this)
        createNotificationChannel()
        showOverlay()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        val resultCode = intent?.getIntExtra(EXTRA_RESULT_CODE, 0) ?: 0
        val data = if (Build.VERSION.SDK_INT >= 33) {
            intent?.getParcelableExtra(EXTRA_PROJECTION_DATA, Intent::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent?.getParcelableExtra(EXTRA_PROJECTION_DATA)
        }
        if (data != null && projection == null) startScreenCapture(resultCode, data)
        return START_NOT_STICKY
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            val channel = NotificationChannel(CHANNEL_ID, "MyMusic Translator", NotificationManager.IMPORTANCE_LOW)
            (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL_ID) else Notification.Builder(this)
        return builder.setContentTitle("MyMusic Translator")
            .setContentText("المترجم العائم يعمل. اضغط على الكرة لعرض الترجمة.")
            .setSmallIcon(android.R.drawable.ic_menu_translate)
            .setOngoing(true)
            .build()
    }

    private fun showOverlay() {
        val bubbleParams = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            if (Build.VERSION.SDK_INT >= 26) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY else WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply { gravity = Gravity.START or Gravity.CENTER_VERTICAL; x = 8; y = 0 }

        bubble = Button(this).apply {
            text = "🌐"
            textSize = 22f
            setOnClickListener { togglePanel() }
        }
        windowManager.addView(bubble, bubbleParams)

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(18, 14, 18, 14)
            setBackgroundColor(0xEE151515.toInt())
        }
        content.addView(TextView(this).apply {
            text = "MyMusic – ترجمة خارج المواقع"
            textSize = 16f
            setTextColor(0xFFFFFFFF.toInt())
        })
        statusView = TextView(this).apply {
            text = "جارٍ تجهيز قراءة الشاشة..."
            setTextColor(0xFFFFD166.toInt())
        }
        content.addView(statusView)
        resultView = TextView(this).apply {
            text = "ستظهر هنا ترجمة الكلام والنصوص الظاهرة على الشاشة."
            setTextColor(0xFFFFFFFF.toInt())
            textSize = 14f
        }
        val scroll = ScrollView(this).apply { addView(resultView) }
        content.addView(scroll, LinearLayout.LayoutParams(-1, 260))
        content.addView(TextView(this).apply { text = "لغة الصوت الأصلية:"; setTextColor(0xFFFFFFFF.toInt()) })
        content.addView(Spinner(this).apply {
            val labels = listOf("English" to "en-US", "العربية" to "ar-EG", "Français" to "fr-FR", "Deutsch" to "de-DE", "Español" to "es-ES", "Türkçe" to "tr-TR", "Italiano" to "it-IT", "Русский" to "ru-RU")
            adapter = ArrayAdapter(this@TranslatorOverlayService, android.R.layout.simple_spinner_dropdown_item, labels.map { it.first })
            onItemSelectedListener = object : android.widget.AdapterView.OnItemSelectedListener {
                override fun onNothingSelected(parent: android.widget.AdapterView<*>?) {}
                override fun onItemSelected(parent: android.widget.AdapterView<*>?, view: android.view.View?, position: Int, id: Long) { speechLanguage = labels[position].second }
            }
        })
        content.addView(Button(this).apply {
            text = "🎙️ ابدأ ترجمة الكلام من الميكروفون"
            setOnClickListener { startSpeechRecognition() }
        })
        content.addView(Button(this).apply {
            text = "⏹️ إيقاف الاستماع"
            setOnClickListener { stopSpeechRecognition() }
        })
        content.addView(Button(this).apply {
            text = "🔊 اقرأ آخر ترجمة"
            setOnClickListener { speak(resultView?.text?.toString().orEmpty()) }
        })
        content.addView(Button(this).apply {
            text = "إغلاق المترجم"
            setOnClickListener { stopSelf() }
        })
        panel = content
        val panelParams = WindowManager.LayoutParams(
            (resources.displayMetrics.widthPixels * 0.86f).toInt(),
            WindowManager.LayoutParams.WRAP_CONTENT,
            if (Build.VERSION.SDK_INT >= 26) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY else WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply { gravity = Gravity.CENTER; }
        content.tag = panelParams
    }

    private fun togglePanel() {
        val view = panel ?: return
        val params = view.tag as WindowManager.LayoutParams
        if (view.parent == null) windowManager.addView(view, params) else windowManager.removeView(view)
    }

    private fun startScreenCapture(resultCode: Int, data: Intent) {
        try {
            val manager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            projection = manager.getMediaProjection(resultCode, data)
            projection?.registerCallback(object : MediaProjection.Callback() {
                override fun onStop() {
                    virtualDisplay?.release()
                    virtualDisplay = null
                    stopSelf()
                }
            }, mainHandler)
            val metrics = DisplayMetrics()
            @Suppress("DEPRECATION")
            windowManager.defaultDisplay.getRealMetrics(metrics)
            screenWidth = metrics.widthPixels
            screenHeight = metrics.heightPixels
            imageReader = ImageReader.newInstance(screenWidth, screenHeight, PixelFormat.RGBA_8888, 3)
            virtualDisplay = projection?.createVirtualDisplay(
                "MyMusicScreenTranslator",
                screenWidth,
                screenHeight,
                metrics.densityDpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                imageReader?.surface,
                null,
                mainHandler
            )
            imageReader?.setOnImageAvailableListener({ reader ->
                val image = reader.acquireLatestImage() ?: return@setOnImageAvailableListener
                val now = System.currentTimeMillis()
                if (now - lastOcrAt < 2500L) { image.close(); return@setOnImageAvailableListener }
                lastOcrAt = now
                val bitmap = imageToBitmap(image)
                image.close()
                if (bitmap != null) recognizeScreen(bitmap)
            }, mainHandler)
            statusView?.text = "✅ قراءة الشاشة مفعلة. شغّل فيديو أو افتح صفحة."
        } catch (error: Exception) {
            statusView?.text = "تعذر التقاط الشاشة: ${error.message}"
        }
    }

    private fun imageToBitmap(image: Image): Bitmap? {
        return try {
            val plane = image.planes[0]
            val pixelStride = plane.pixelStride
            val rowStride = plane.rowStride
            val paddedWidth = rowStride / pixelStride
            val padded = Bitmap.createBitmap(paddedWidth, image.height, Bitmap.Config.ARGB_8888)
            padded.copyPixelsFromBuffer(plane.buffer)
            val cropped = Bitmap.createBitmap(padded, 0, 0, image.width, image.height)
            if (cropped !== padded) padded.recycle()
            cropped
        } catch (_: Exception) { null }
    }

    private fun ensureTesseract(): Boolean {
        if (tessBase != null) return true
        val root = File(filesDir, "tesseract")
        val data = File(root, "tessdata")
        if (!data.exists()) data.mkdirs()
        val languages = listOf("eng", "ara")
        for (language in languages) {
            val model = File(data, "$language.traineddata")
            if (!model.exists()) {
                val source = URL("https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/$language.traineddata")
                source.openConnection().apply { connectTimeout = 20000; readTimeout = 30000 }.getInputStream().use { input ->
                    FileOutputStream(model).use { output -> input.copyTo(output) }
                }
            }
        }
        val engine = TessBaseAPI()
        if (!engine.init(root.absolutePath, "eng+ara")) {
            engine.recycle()
            return false
        }
        tessBase = engine
        return true
    }

    private fun recognizeScreen(bitmap: Bitmap) {
        worker.execute {
            try {
                if (!ensureTesseract()) throw IllegalStateException("تعذر تشغيل محرك قراءة النص")
                val engine = tessBase ?: throw IllegalStateException("OCR engine unavailable")
                engine.setImage(bitmap)
                val text = engine.getUTF8Text().orEmpty().trim()
                engine.clear()
                bitmap.recycle()
                if (text.isNotBlank() && text != lastOcrText) {
                    lastOcrText = text
                    translateAndShow(text, "🖼️ نص الشاشة")
                }
            } catch (error: Exception) {
                bitmap.recycle()
                mainHandler.post { statusView?.text = "تعذر قراءة الشاشة: ${error.message}" }
            }
        }
    }

    private fun startSpeechRecognition() {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            statusView?.text = "التعرف على الكلام غير متاح على هذا الجهاز."
            return
        }
        stopSpeechRecognition()
        speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this)
        speechRecognizer?.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: android.os.Bundle?) { statusView?.text = "🎙️ يستمع من الميكروفون الآن..." }
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onError(error: Int) { if (listening) restartSpeechSoon() }
            override fun onResults(results: android.os.Bundle?) {
                val heard = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                if (heard.isNotBlank()) translateAndShow(heard, "🎙️ الكلام المسموع", speechLanguage.substringBefore("-"))
                if (listening) restartSpeechSoon()
            }
            override fun onPartialResults(partialResults: android.os.Bundle?) {}
            override fun onEvent(eventType: Int, params: android.os.Bundle?) {}
        })
        listening = true
        startSpeechOnce()
    }

    private fun startSpeechOnce() {
        if (!listening) return
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, speechLanguage)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
        }
        try { speechRecognizer?.startListening(intent) } catch (_: Exception) { restartSpeechSoon() }
    }

    private fun restartSpeechSoon() {
        mainHandler.postDelayed({ if (listening) startSpeechOnce() }, 450)
    }

    private fun stopSpeechRecognition() {
        listening = false
        try { speechRecognizer?.stopListening(); speechRecognizer?.destroy() } catch (_: Exception) {}
        speechRecognizer = null
        statusView?.text = "تم إيقاف الاستماع."
    }

    private fun translateAndShow(text: String, label: String, sourceOverride: String? = null) {
        worker.execute {
            try {
                val source = sourceOverride ?: if (text.any { it in '\u0600'..'\u06FF' }) "ar" else "en"
                val encoded = URLEncoder.encode(text.take(500), "UTF-8")
                val url = URL("https://api.mymemory.translated.net/get?q=$encoded&langpair=$source%7Car")
                val connection = (url.openConnection() as HttpURLConnection).apply {
                    connectTimeout = 12000
                    readTimeout = 12000
                    setRequestProperty("Accept", "application/json")
                }
                val json = connection.inputStream.bufferedReader().use { it.readText() }
                connection.disconnect()
                val translated = JSONObject(json).optJSONObject("responseData")?.optString("translatedText").orEmpty()
                mainHandler.post {
                    statusView?.text = "✅ تمت الترجمة – $label"
                    resultView?.text = "الأصل:\n$text\n\nالعربية:\n${translated.ifBlank { "لم تتوفر ترجمة." }}"
                    if (translated.isNotBlank()) speak(translated)
                }
            } catch (error: Exception) {
                mainHandler.post { statusView?.text = "تعذرت الترجمة: ${error.message}" }
            }
        }
    }

    private fun speak(text: String) {
        val clean = text.substringAfter("العربية:", text).trim()
        if (clean.isNotBlank()) tts?.speak(clean, TextToSpeech.QUEUE_FLUSH, null, "mymusic-translation")
    }

    override fun onInit(status: Int) {
        if (status == TextToSpeech.SUCCESS) tts?.language = Locale("ar")
    }

    override fun onDestroy() {
        stopSpeechRecognition()
        try { if (panel?.parent != null) windowManager.removeView(panel) } catch (_: Exception) {}
        try { bubble?.let { windowManager.removeView(it) } } catch (_: Exception) {}
        virtualDisplay?.release()
        imageReader?.close()
        projection?.stop()
        tessBase?.recycle()
        tessBase = null
        tts?.stop()
        tts?.shutdown()
        worker.shutdown()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
