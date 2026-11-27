package com.mymusic.translator

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.ActivityCompat

class MainActivity : Activity() {
    private val overlayRequest = 4101
    private val projectionRequest = 4102
    private val audioRequest = 4103

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(28, 32, 28, 32)
        }
        layout.addView(TextView(this).apply {
            text = "MyMusic Translator\n\nمترجم عائم للصوت والنصوص الظاهرة على الشاشة.\n\nاسمح بالظهور فوق التطبيقات والميكروفون ومشاركة الشاشة لبدء الجلسة."
            textSize = 18f
            gravity = Gravity.CENTER
        })
        layout.addView(Button(this).apply {
            text = "تشغيل المترجم العائم"
            setOnClickListener { beginSetup() }
        })
        layout.addView(TextView(this).apply {
            text = "\nالصوت يُلتقط عبر الميكروفون من السماعة الخارجية أو سماعات الأذن. قراءة الشاشة تتطلب موافقتك في كل جلسة، وبعض التطبيقات قد تمنع الالتقاط."
            textSize = 13f
            gravity = Gravity.CENTER
        })
        setContentView(layout)
    }

    private fun beginSetup() {
        if (!Settings.canDrawOverlays(this)) {
            val intent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName"))
            startActivityForResult(intent, overlayRequest)
            return
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.RECORD_AUDIO), audioRequest)
            return
        }
        requestScreenCapture()
    }

    private fun requestScreenCapture() {
        val manager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        startActivityForResult(manager.createScreenCaptureIntent(), projectionRequest)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == overlayRequest) {
            if (Settings.canDrawOverlays(this)) beginSetup()
        } else if (requestCode == projectionRequest && resultCode == RESULT_OK && data != null) {
            val service = Intent(this, TranslatorOverlayService::class.java).apply {
                putExtra(TranslatorOverlayService.EXTRA_RESULT_CODE, resultCode)
                putExtra(TranslatorOverlayService.EXTRA_PROJECTION_DATA, data)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(service) else startService(service)
            finish()
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == audioRequest && grantResults.firstOrNull() == android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestScreenCapture()
        }
    }
}
