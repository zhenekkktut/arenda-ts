package ru.zhenekkktut.arendats;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.pdf.PdfDocument;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceError;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import org.json.JSONObject;

import java.io.OutputStream;

import androidx.webkit.WebViewAssetLoader;

public class MainActivity extends Activity {
    private static final int REQUEST_OPEN_FILE = 1001;
    private static final int REQUEST_SAVE_FILE = 1002;
    private static final int REQUEST_SAVE_PDF = 1003;
    private static final int PDF_PAGE_WIDTH = 794;
    private static final int PDF_PAGE_HEIGHT = 1123;
    private static final int PDF_OUTPUT_WIDTH = 595;
    private static final int PDF_OUTPUT_HEIGHT = 842;

    private WebView webView;
    private FrameLayout rootView;
    private WebViewAssetLoader assetLoader;
    private ValueCallback<Uri[]> fileChooserCallback;
    private byte[] pendingFileBytes;
    private String pendingFileName;
    private String pendingMimeType;
    private String pendingPdfHtml;
    private String pendingPdfFileName;
    private WebView pdfWebView;
    private final Handler pdfHandler = new Handler(Looper.getMainLooper());
    private Runnable pdfTimeout;
    private Uri pdfDestination;
    private boolean pdfMediaStoreDestination;
    private boolean pdfInProgress;
    private String activeArchiveId;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().setStatusBarColor(Color.WHITE);
        getWindow().setNavigationBarColor(Color.rgb(244, 246, 249));
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        );

        WebView.enableSlowWholeDocumentDraw();
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(244, 246, 249));
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

        rootView = new FrameLayout(this);
        rootView.setBackgroundColor(Color.WHITE);
        rootView.addView(
            webView,
            new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        );
        rootView.setOnApplyWindowInsetsListener((view, windowInsets) -> {
            int insetLeft;
            int insetTop;
            int insetRight;
            int insetBottom;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                android.graphics.Insets safeInsets = windowInsets.getInsets(
                    WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout()
                );
                insetLeft = safeInsets.left;
                insetTop = safeInsets.top;
                insetRight = safeInsets.right;
                insetBottom = safeInsets.bottom;
            } else {
                insetLeft = windowInsets.getSystemWindowInsetLeft();
                insetTop = windowInsets.getSystemWindowInsetTop();
                insetRight = windowInsets.getSystemWindowInsetRight();
                insetBottom = windowInsets.getSystemWindowInsetBottom();
            }

            FrameLayout.LayoutParams layoutParams = (FrameLayout.LayoutParams) webView.getLayoutParams();
            if (
                layoutParams.leftMargin != insetLeft
                    || layoutParams.topMargin != insetTop
                    || layoutParams.rightMargin != insetRight
                    || layoutParams.bottomMargin != insetBottom
            ) {
                layoutParams.setMargins(insetLeft, insetTop, insetRight, insetBottom);
                webView.setLayoutParams(layoutParams);
            }
            return windowInsets;
        });

        setContentView(rootView);
        rootView.requestApplyInsets();
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
            return;
        }

        if (requestCode == REQUEST_SAVE_PDF) {
            if (resultCode == Activity.RESULT_OK && data != null && data.getData() != null && pendingPdfHtml != null) {
                String html = pendingPdfHtml;
                String fileName = pendingPdfFileName == null ? "document.pdf" : pendingPdfFileName;
                pendingPdfHtml = null;
                pendingPdfFileName = null;
                renderHtmlToPdf(html, fileName, data.getData(), false);
            } else {
                pendingPdfHtml = null;
                pendingPdfFileName = null;
                pdfInProgress = false;
                activeArchiveId = null;
            }
            return;
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
        if (pdfDestination != null) finishPdfSave(pdfDestination, "", pdfMediaStoreDestination, false);
        if (webView != null) {
            webView.removeJavascriptInterface("AndroidApp");
            webView.destroy();
        }
        if (pdfWebView != null) {
            pdfWebView.destroy();
            pdfWebView = null;
        }
        super.onDestroy();
    }

    private final class AndroidBridge {
        @JavascriptInterface
        public void setTheme(String theme) {
            final boolean dark = "dark".equals(theme);
            runOnUiThread(() -> {
                int background = dark ? Color.rgb(12, 17, 27) : Color.rgb(244, 246, 249);
                int statusBar = dark ? Color.rgb(12, 17, 27) : Color.WHITE;
                getWindow().setStatusBarColor(statusBar);
                getWindow().setNavigationBarColor(background);
                getWindow().getDecorView().setSystemUiVisibility(
                    dark ? 0 : View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
                );
                if (webView != null) webView.setBackgroundColor(background);
                if (rootView != null) rootView.setBackgroundColor(background);
            });
        }

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

        @JavascriptInterface
        public void saveHtmlAsPdf(String html, String fileName) {
            if (html == null || html.trim().isEmpty()) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, R.string.file_save_error, Toast.LENGTH_LONG).show());
                return;
            }
            String pdfFileName = safeFileName(fileName == null ? "document.pdf" : fileName);
            if (!pdfFileName.toLowerCase().endsWith(".pdf")) pdfFileName += ".pdf";
            final String finalPdfFileName = pdfFileName;
            runOnUiThread(() -> beginPdfSave(html, finalPdfFileName, null));
        }

        @JavascriptInterface
        public void saveArchivedHtmlAsPdf(String html, String fileName, String archiveId) {
            if (html == null || html.trim().isEmpty()) return;
            final String safeName = safeFileName(fileName);
            runOnUiThread(() -> beginPdfSave(html, safeName, archiveId));
        }

        @JavascriptInterface
        public void openArchivedPdf(String uri) {
            runOnUiThread(() -> { if (isLocalDocumentUri(uri)) openPdf(Uri.parse(uri)); });
        }

        @JavascriptInterface
        public void shareArchivedPdf(String uri) {
            runOnUiThread(() -> { if (isLocalDocumentUri(uri)) sharePdf(Uri.parse(uri)); });
        }
    }

    private boolean isLocalDocumentUri(String uri) {
        return uri != null && uri.startsWith("content://") && !uri.contains("\n");
    }

    private void beginPdfSave(String html, String pdfFileName, String archiveId) {
        if (pdfInProgress) {
            Toast.makeText(this, R.string.pdf_in_progress, Toast.LENGTH_SHORT).show();
            return;
        }
        pdfInProgress = true;
        activeArchiveId = archiveId;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                ContentValues values = new ContentValues();
                values.put(MediaStore.MediaColumns.DISPLAY_NAME, pdfFileName);
                values.put(MediaStore.MediaColumns.MIME_TYPE, "application/pdf");
                values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Аренда ТС");
                values.put(MediaStore.MediaColumns.IS_PENDING, 1);
                Uri destination = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (destination == null) throw new IllegalStateException("Не удалось создать PDF");
                renderHtmlToPdf(html, pdfFileName, destination, true);
            } catch (Exception error) {
                if (pdfDestination != null) {
                    finishPdfSave(pdfDestination, pdfFileName, true, false);
                    return;
                }
                pdfInProgress = false;
                activeArchiveId = null;
                Toast.makeText(this, R.string.file_save_error, Toast.LENGTH_LONG).show();
            }
            return;
        }

        pendingPdfHtml = html;
        pendingPdfFileName = pdfFileName;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/pdf");
        intent.putExtra(Intent.EXTRA_TITLE, pdfFileName);
        try {
            startActivityForResult(intent, REQUEST_SAVE_PDF);
        } catch (Exception error) {
            pendingPdfHtml = null;
            pendingPdfFileName = null;
            pdfInProgress = false;
            activeArchiveId = null;
            Toast.makeText(this, R.string.file_save_error, Toast.LENGTH_LONG).show();
        }
    }

    private void renderHtmlToPdf(String html, String pdfFileName, Uri destination, boolean mediaStoreDestination) {
        pdfDestination = destination;
        pdfMediaStoreDestination = mediaStoreDestination;
        pdfWebView = new WebView(this);
        pdfWebView.setBackgroundColor(Color.WHITE);
        pdfWebView.setLayerType(View.LAYER_TYPE_SOFTWARE, null);
        pdfWebView.setFocusable(false);
        pdfWebView.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        pdfWebView.setHorizontalScrollBarEnabled(false);
        pdfWebView.setVerticalScrollBarEnabled(false);
        pdfWebView.getSettings().setJavaScriptEnabled(false);
        pdfWebView.getSettings().setBlockNetworkLoads(true);
        pdfWebView.getSettings().setDefaultTextEncodingName("UTF-8");
        pdfWebView.getSettings().setUseWideViewPort(true);
        pdfWebView.getSettings().setLoadWithOverviewMode(false);
        pdfWebView.getSettings().setTextZoom(100);
        pdfWebView.setInitialScale(100);
        final WebView source = pdfWebView;
        final int pageCount = countPdfPages(html);
        final float density = getResources().getDisplayMetrics().density;
        final int renderWidth = Math.round(PDF_PAGE_WIDTH * density);
        final int renderHeight = Math.round(PDF_PAGE_HEIGHT * pageCount * density);
        // The renderer must be attached for visual callbacks and deferred work.
        // Put it behind the opaque app WebView, with an A4 viewport in CSS pixels.
        rootView.addView(source, 0, new FrameLayout.LayoutParams(renderWidth, renderHeight));
        pdfTimeout = () -> {
            if (pdfWebView == source) finishPdfSave(destination, pdfFileName, mediaStoreDestination, false);
        };
        pdfHandler.postDelayed(pdfTimeout, 30_000);
        pdfWebView.setWebViewClient(new WebViewClient() {
            private boolean renderStarted;
            @Override
            public void onPageFinished(WebView view, String url) {
                if (renderStarted || pdfWebView != view) return;
                renderStarted = true;
                pdfHandler.post(() -> {
                    if (pdfWebView != view) return;
                    view.measure(View.MeasureSpec.makeMeasureSpec(renderWidth, View.MeasureSpec.EXACTLY),
                        View.MeasureSpec.makeMeasureSpec(renderHeight, View.MeasureSpec.EXACTLY));
                    view.layout(0, 0, renderWidth, renderHeight);
                    view.scrollTo(0, 0);
                    view.postVisualStateCallback(0, new WebView.VisualStateCallback() {
                        @Override
                        public void onComplete(long requestId) {
                            if (pdfWebView == view) writeWebViewPdf(view, pageCount, density, pdfFileName, destination, mediaStoreDestination);
                        }
                    });
                });
            }
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame() && pdfWebView == view) finishPdfSave(destination, pdfFileName, mediaStoreDestination, false);
            }
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                if (pdfWebView == view) finishPdfSave(destination, pdfFileName, mediaStoreDestination, false);
                return true;
            }
        });
        pdfWebView.loadDataWithBaseURL("https://" + WebViewAssetLoader.DEFAULT_DOMAIN + "/assets/", html, "text/html", "UTF-8", null);
    }

    private void writeWebViewPdf(
        WebView source,
        int pageCount,
        float density,
        String pdfFileName,
        Uri destination,
        boolean mediaStoreDestination
    ) {
        if (source != pdfWebView) return;
        PdfDocument document = new PdfDocument();
        boolean success = false;
        try {
            float scale = Math.min(
                PDF_OUTPUT_WIDTH / (PDF_PAGE_WIDTH * density),
                PDF_OUTPUT_HEIGHT / (PDF_PAGE_HEIGHT * density)
            );
            for (int index = 0; index < pageCount; index++) {
                PdfDocument.PageInfo pageInfo = new PdfDocument.PageInfo.Builder(
                    PDF_OUTPUT_WIDTH,
                    PDF_OUTPUT_HEIGHT,
                    index + 1
                ).create();
                PdfDocument.Page page = document.startPage(pageInfo);
                Canvas canvas = page.getCanvas();
                canvas.drawColor(Color.WHITE);
                int checkpoint = canvas.save();
                canvas.scale(scale, scale);
                canvas.translate(0, -index * PDF_PAGE_HEIGHT * density);
                source.draw(canvas);
                canvas.restoreToCount(checkpoint);
                document.finishPage(page);
            }

            try (OutputStream output = getContentResolver().openOutputStream(destination, "w")) {
                if (output == null) throw new IllegalStateException("Файл недоступен");
                document.writeTo(output);
                output.flush();
            }
            success = true;
        } catch (Exception error) {
            success = false;
        } finally {
            document.close();
            finishPdfSave(destination, pdfFileName, mediaStoreDestination, success);
        }
    }

    private void finishPdfSave(Uri destination, String pdfFileName, boolean mediaStoreDestination, boolean success) {
        WebView source = pdfWebView;
        pdfWebView = null;
        if (pdfTimeout != null) pdfHandler.removeCallbacks(pdfTimeout);
        pdfTimeout = null;
        if (source != null) {
            rootView.removeView(source);
            source.destroy();
        }
        pdfDestination = null;
        if (mediaStoreDestination && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                if (success) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.MediaColumns.IS_PENDING, 0);
                    getContentResolver().update(destination, values, null, null);
                } else {
                    getContentResolver().delete(destination, null, null);
                }
            } catch (Exception ignored) {
                success = false;
            }
        }

        if (pdfWebView != null) {
            pdfWebView.destroy();
            pdfWebView = null;
        }
        pdfInProgress = false;
        String archiveId = activeArchiveId;
        activeArchiveId = null;
        if (isFinishing() || isDestroyed()) return;

        if (!success) {
            Toast.makeText(this, R.string.file_save_error, Toast.LENGTH_LONG).show();
            return;
        }

        if (archiveId != null && webView != null) {
            webView.evaluateJavascript(
                "window.onArchivePdfSaved?.(" + JSONObject.quote(archiveId) + "," +
                    JSONObject.quote(destination.toString()) + ")", null
            );
        }

        String folder = mediaStoreDestination ? "Загрузки/Аренда ТС" : "выбранная папка";
        new AlertDialog.Builder(this)
            .setTitle(R.string.pdf_saved_title)
            .setMessage("Файл: " + pdfFileName + "\nПапка: " + folder)
            .setPositiveButton(R.string.pdf_open, (dialog, which) -> openPdf(destination))
            .setNeutralButton(R.string.pdf_share, (dialog, which) -> sharePdf(destination))
            .setNegativeButton(R.string.close, null)
            .show();
    }

    private void openPdf(Uri uri) {
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/pdf");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            startActivity(Intent.createChooser(intent, getString(R.string.pdf_open)));
        } catch (Exception error) {
            Toast.makeText(this, R.string.pdf_open_error, Toast.LENGTH_LONG).show();
        }
    }

    private void sharePdf(Uri uri) {
        Intent intent = new Intent(Intent.ACTION_SEND);
        intent.setType("application/pdf");
        intent.putExtra(Intent.EXTRA_STREAM, uri);
        intent.setClipData(ClipData.newRawUri("PDF", uri));
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            startActivity(Intent.createChooser(intent, getString(R.string.pdf_share)));
        } catch (Exception error) {
            Toast.makeText(this, R.string.pdf_open_error, Toast.LENGTH_LONG).show();
        }
    }

    private int countPdfPages(String html) {
        String marker = "<section class=\"page\">";
        int count = 0;
        int cursor = 0;
        while ((cursor = html.indexOf(marker, cursor)) >= 0) {
            count += 1;
            cursor += marker.length();
        }
        return Math.max(1, count);
    }

    private String safeFileName(String value) {
        String fallback = "arenda-ts-file";
        if (value == null || value.trim().isEmpty()) return fallback;
        String cleaned = value.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
        return cleaned.isEmpty() ? fallback : cleaned;
    }
}
