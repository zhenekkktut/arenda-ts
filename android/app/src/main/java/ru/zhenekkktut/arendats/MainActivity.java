package ru.zhenekkktut.arendats;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceError;
import android.webkit.WebResourceResponse;
import android.webkit.RenderProcessGoneDetail;
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
    private PrintDocumentAdapter pdfAdapter;
    private ParcelFileDescriptor pdfOutput;
    private CancellationSignal pdfCancellation;
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
                // Use the main looper: View.post waits for an unattached WebView.
                pdfHandler.post(() -> writeWebViewPdf(view, pdfFileName, destination, mediaStoreDestination));
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame() && pdfWebView == view) {
                    finishPdfSave(destination, pdfFileName, mediaStoreDestination, false);
                }
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                if (pdfWebView == view) finishPdfSave(destination, pdfFileName, mediaStoreDestination, false);
                return true;
            }
        });
        pdfWebView.loadDataWithBaseURL(
            "https://" + WebViewAssetLoader.DEFAULT_DOMAIN + "/assets/",
            html,
            "text/html",
            "UTF-8",
            null
        );
    }

    private void writeWebViewPdf(
        WebView source,
        String pdfFileName,
        Uri destination,
        boolean mediaStoreDestination
    ) {
        if (source != pdfWebView) return;
        try {
            pdfOutput = getContentResolver().openFileDescriptor(destination, "rwt");
            if (pdfOutput == null) throw new IllegalStateException("Файл недоступен");
            pdfCancellation = new CancellationSignal();
            pdfAdapter = source.createPrintDocumentAdapter(pdfFileName);
            final PrintDocumentAdapter adapter = pdfAdapter;
            PrintAttributes attributes = new PrintAttributes.Builder()
                .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                .setResolution(new PrintAttributes.Resolution("pdf", "PDF", 300, 300))
                .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                .setColorMode(PrintAttributes.COLOR_MODE_COLOR)
                .build();
            adapter.onStart();
            adapter.onLayout(null, attributes, pdfCancellation, new PrintDocumentAdapter.LayoutResultCallback() {
                @Override
                public void onLayoutFinished(PrintDocumentInfo info, boolean changed) {
                    pdfHandler.post(() -> {
                        if (source != pdfWebView) return;
                        try {
                            adapter.onWrite(new PageRange[] { PageRange.ALL_PAGES }, pdfOutput, pdfCancellation,
                                new PrintDocumentAdapter.WriteResultCallback() {
                                    @Override
                                    public void onWriteFinished(PageRange[] pages) {
                                        complete(pages.length > 0 && pdfOutput != null && pdfOutput.getStatSize() > 0);
                                    }
                                    @Override
                                    public void onWriteFailed(CharSequence error) { complete(false); }
                                    @Override
                                    public void onWriteCancelled() { complete(false); }
                                    private void complete(boolean success) {
                                        pdfHandler.post(() -> {
                                            if (source == pdfWebView) finishPdfSave(destination, pdfFileName, mediaStoreDestination, success);
                                        });
                                    }
                                });
                        } catch (Exception error) {
                            finishPdfSave(destination, pdfFileName, mediaStoreDestination, false);
                        }
                    });
                }
                @Override
                public void onLayoutFailed(CharSequence error) { complete(); }
                @Override
                public void onLayoutCancelled() { complete(); }
                private void complete() {
                    pdfHandler.post(() -> {
                        if (source == pdfWebView) finishPdfSave(destination, pdfFileName, mediaStoreDestination, false);
                    });
                }
            }, null);
        } catch (Exception error) {
            finishPdfSave(destination, pdfFileName, mediaStoreDestination, false);
        }
    }

    private void finishPdfSave(Uri destination, String pdfFileName, boolean mediaStoreDestination, boolean success) {
        WebView source = pdfWebView;
        pdfWebView = null;
        if (pdfTimeout != null) pdfHandler.removeCallbacks(pdfTimeout);
        pdfTimeout = null;
        if (!success && pdfCancellation != null) pdfCancellation.cancel();
        pdfCancellation = null;
        if (pdfAdapter != null) {
            try { pdfAdapter.onFinish(); } catch (Exception ignored) { }
            pdfAdapter = null;
        }
        if (pdfOutput != null) {
            try { pdfOutput.close(); } catch (Exception error) { success = false; }
            pdfOutput = null;
        }
        if (source != null) source.destroy();
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

    @Override
    protected void onDestroy() {
        if (pdfDestination != null) finishPdfSave(pdfDestination, "", pdfMediaStoreDestination, false);
        if (webView != null) webView.destroy();
        super.onDestroy();
    }

    private String safeFileName(String value) {
        String fallback = "arenda-ts-file";
        if (value == null || value.trim().isEmpty()) return fallback;
        String cleaned = value.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
        return cleaned.isEmpty() ? fallback : cleaned;
    }
}
