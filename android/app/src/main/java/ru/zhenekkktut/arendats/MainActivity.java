package ru.zhenekkktut.arendats;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.OutputStream;

import androidx.webkit.WebViewAssetLoader;

public class MainActivity extends Activity {
    private static final int REQUEST_OPEN_FILE = 1001;
    private static final int REQUEST_SAVE_FILE = 1002;

    private WebView webView;
    private WebViewAssetLoader assetLoader;
    private ValueCallback<Uri[]> fileChooserCallback;
    private byte[] pendingFileBytes;
    private String pendingFileName;
    private String pendingMimeType;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().setStatusBarColor(Color.rgb(8, 29, 49));
        getWindow().setNavigationBarColor(Color.rgb(243, 246, 248));
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(243, 246, 248));
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setBlockNetworkLoads(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setTextZoom(100);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        assetLoader = new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
            .build();

        webView.addJavascriptInterface(new AndroidBridge(), "AndroidApp");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
                return assetLoader.shouldInterceptRequest(Uri.parse(url));
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (WebViewAssetLoader.DEFAULT_DOMAIN.equals(uri.getHost())) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
                    Toast.makeText(MainActivity.this, "Не удалось открыть ссылку", Toast.LENGTH_SHORT).show();
                }
                return true;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                WebView view,
                ValueCallback<Uri[]> callback,
                FileChooserParams params
            ) {
                if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
                fileChooserCallback = callback;
                Intent intent;
                try {
                    intent = params.createIntent();
                } catch (Exception error) {
                    intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("*/*");
                }
                try {
                    startActivityForResult(intent, REQUEST_OPEN_FILE);
                    return true;
                } catch (Exception error) {
                    fileChooserCallback = null;
                    Toast.makeText(MainActivity.this, "Не удалось открыть файлы", Toast.LENGTH_SHORT).show();
                    return false;
                }
            }
        });

        setContentView(webView);
        webView.loadUrl("https://" + WebViewAssetLoader.DEFAULT_DOMAIN + "/assets/index.html");
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == REQUEST_OPEN_FILE) {
            if (fileChooserCallback == null) return;
            Uri[] result = null;
            if (resultCode == Activity.RESULT_OK && data != null) {
                if (data.getData() != null) {
                    result = new Uri[] { data.getData() };
                } else if (data.getClipData() != null) {
                    int count = data.getClipData().getItemCount();
                    result = new Uri[count];
                    for (int index = 0; index < count; index++) {
                        result[index] = data.getClipData().getItemAt(index).getUri();
                    }
                }
            }
            fileChooserCallback.onReceiveValue(result);
            fileChooserCallback = null;
            return;
        }

        if (requestCode == REQUEST_SAVE_FILE) {
            if (resultCode == Activity.RESULT_OK && data != null && data.getData() != null && pendingFileBytes != null) {
                try (OutputStream output = getContentResolver().openOutputStream(data.getData(), "w")) {
                    if (output == null) throw new IllegalStateException("Файл недоступен");
                    output.write(pendingFileBytes);
                    output.flush();
                    Toast.makeText(this, R.string.file_saved, Toast.LENGTH_SHORT).show();
                } catch (Exception error) {
                    Toast.makeText(this, R.string.file_save_error, Toast.LENGTH_LONG).show();
                }
            }
            pendingFileBytes = null;
            pendingFileName = null;
            pendingMimeType = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("AndroidApp");
            webView.destroy();
        }
        super.onDestroy();
    }

    private final class AndroidBridge {
        @JavascriptInterface
        public void copyText(String text) {
            ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            clipboard.setPrimaryClip(ClipData.newPlainText("Текст", text));
        }

        @JavascriptInterface
        public void saveBase64File(String base64, String fileName, String mimeType) {
            try {
                pendingFileBytes = Base64.decode(base64, Base64.DEFAULT);
                pendingFileName = safeFileName(fileName);
                pendingMimeType = mimeType == null || mimeType.isEmpty()
                    ? "application/octet-stream"
                    : mimeType;
                runOnUiThread(() -> {
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType(pendingMimeType);
                    intent.putExtra(Intent.EXTRA_TITLE, pendingFileName);
                    try {
                        startActivityForResult(intent, REQUEST_SAVE_FILE);
                    } catch (Exception error) {
                        pendingFileBytes = null;
                        Toast.makeText(MainActivity.this, R.string.file_save_error, Toast.LENGTH_LONG).show();
                    }
                });
            } catch (Exception error) {
                pendingFileBytes = null;
                runOnUiThread(() -> Toast.makeText(MainActivity.this, R.string.file_save_error, Toast.LENGTH_LONG).show());
            }
        }
    }

    private String safeFileName(String value) {
        String fallback = "arenda-ts-file";
        if (value == null || value.trim().isEmpty()) return fallback;
        String cleaned = value.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
        return cleaned.isEmpty() ? fallback : cleaned;
    }
}
