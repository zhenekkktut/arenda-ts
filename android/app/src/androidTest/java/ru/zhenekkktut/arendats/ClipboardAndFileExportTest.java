package ru.zhenekkktut.arendats;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.SystemClock;
import android.text.InputType;
import android.util.Base64;
import android.webkit.WebView;
import android.webkit.WebChromeClient;
import android.webkit.ConsoleMessage;
import android.view.MotionEvent;
import android.widget.EditText;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class ClipboardAndFileExportTest {
    private final Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();

    @Test
    public void checkedClipboardPreservesInvoiceTextWhenPastedIntoAnEditableField() throws Exception {
        MainActivity activity = start();
        ClipboardManager clipboard = (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
        AtomicReference<ClipData> previous = new AtomicReference<>();
        try {
            WebView page = page(activity);
            instrumentation.runOnMainSync(() -> previous.set(clipboard.getPrimaryClip()));
            String text = "Часть постоянной аренды: 12\u00a0500,50 ₽\n"
                + "Переменная часть: 17\u202f000,51 ₽\n\nСчёт № 31 от 13.10.2026. Без НДС.\n"
                + "Договор № 002-АР/2026, VIN TEST-VIN. \"Реквизиты\"";
            assertEquals("true", evaluate(page, "AndroidApp.copyTextChecked(" + JSONObject.quote(text) + ")"));
            instrumentation.runOnMainSync(() -> {
                assertEquals(text, clipboard.getPrimaryClip().getItemAt(0).getText().toString());
                EditText field = new EditText(activity);
                field.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
                activity.setContentView(field);
                field.requestFocus();
                assertTrue("Paste action must be accepted", field.onTextContextMenuItem(android.R.id.paste));
                assertEquals("The pasted invoice must retain all Unicode and line breaks", text, field.getText().toString());
            });
            // Rejected input must not clear a successfully copied invoice.
            assertEquals("false", evaluate(page, "AndroidApp.copyTextChecked('')"));
            assertEquals("false", evaluate(page, "AndroidApp.copyTextChecked(null)"));
            instrumentation.runOnMainSync(() ->
                assertEquals(text, clipboard.getPrimaryClip().getItemAt(0).getText().toString()));
        } finally {
            instrumentation.runOnMainSync(() -> {
                clipboard.setPrimaryClip(previous.get() != null ? previous.get() : ClipData.newPlainText("", ""));
                activity.finish();
            });
        }
    }

    @Test
    public void fileCompletionReportsActualSavedCancelledAndFailedResultsAndAllowsRetry() throws Exception {
        MainActivity activity = start();
        File output = File.createTempFile("export-result-", ".json", activity.getCacheDir());
        try {
            WebView page = page(activity);
            installCapture(page);
            String json = "{\"text\":\"Счёт № 31\\n12 500,50 ₽\",\"version\":6}";
            byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
            String encoded = Base64.encodeToString(bytes, Base64.NO_WRAP);
            String quotedId = "backup-\"quoted\\id\nline";

            withPickerResult(Activity.RESULT_OK, new Intent().setData(Uri.fromFile(output)), () -> {
                assertEquals("true", export(page, encoded, quotedId));
                assertEvent(page, 0, quotedId, "saved");
            });
            assertArrayEquals("Saved callback must follow the completed UTF-8 write", bytes, Files.readAllBytes(output.toPath()));

            withPickerResult(Activity.RESULT_CANCELED, null, () -> {
                assertEquals("true", export(page, encoded, "cancelled-backup"));
                assertEvent(page, 1, "cancelled-backup", "cancelled");
            });
            withPickerResult(Activity.RESULT_OK, new Intent().setData(Uri.parse("content://ru.zhenekkktut.arendats.missing/document")), () -> {
                assertEquals("true", export(page, encoded, "failed-backup"));
                assertEvent(page, 2, "failed-backup", "error");
            });
            withPickerResult(Activity.RESULT_OK, new Intent().setData(Uri.fromFile(output)), () -> {
                assertEquals("true", export(page, encoded, "retry-backup"));
                assertEvent(page, 3, "retry-backup", "saved");
            });
            assertEquals("Exactly one result per accepted operation", 4, events(page).length());
        } finally {
            output.delete();
            instrumentation.runOnMainSync(activity::finish);
        }
    }

    @Test
    public void systemBackClosesTheTopSelectThenItsFormWithoutExitingTheApplication() throws Exception {
        MainActivity activity = start();
        try {
            WebView page = page(activity);
            saveScreenshot(activity, "app-startup.png");
            assertFitsViewport(page, "[aria-label=\"Настройки приложения\"]");
            tapElement(page, "document.querySelector('[aria-label=\"Настройки приложения\"]')");
            waitFor(page, "!!document.querySelector('[role=\"dialog\"][data-state=\"open\"]')");
            saveScreenshot(activity, "app-settings.png");
            assertFitsViewport(page, "[role=\"dialog\"][data-state=\"open\"]");
            instrumentation.runOnMainSync(activity::onBackPressed);
            waitFor(page, "!document.querySelector('[role=\"dialog\"][data-state=\"open\"]')");
            assertFalse("Back must dismiss settings, not finish the app", activity.isFinishing());

            tapElement(page, "Array.from(document.querySelectorAll('[role=\"tab\"]')).find(el=>el.textContent.trim()==='Расходы')");
            waitFor(page, "Array.from(document.querySelectorAll('button')).some(el=>el.textContent.trim()==='Добавить расход')");
            tapElement(page, "Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='Добавить расход')");
            waitFor(page, "!!document.querySelector('[role=\"dialog\"][data-state=\"open\"] [role=\"combobox\"]')");
            saveScreenshot(activity, "app-expense.png");
            assertFitsViewport(page, "[role=\"dialog\"][data-state=\"open\"]");
            assertFitsViewport(page, "[role=\"dialog\"][data-state=\"open\"] [role=\"combobox\"]");
            tapElement(page, "document.querySelector('[role=\"dialog\"][data-state=\"open\"] [role=\"combobox\"]')");
            waitFor(page, "!!document.querySelector('[role=\"listbox\"][data-state=\"open\"]')");
            instrumentation.runOnMainSync(activity::onBackPressed);
            waitFor(page, "!document.querySelector('[role=\"listbox\"][data-state=\"open\"]')");
            assertEquals("The expense form must remain open after dismissing its selector", "true",
                evaluate(page, "!!document.querySelector('[role=\"dialog\"][data-state=\"open\"]')"));
            assertFalse(activity.isFinishing());
            instrumentation.runOnMainSync(activity::onBackPressed);
            waitFor(page, "!document.querySelector('[role=\"dialog\"][data-state=\"open\"]')");
            assertFalse("A second Back must dismiss the expense form", activity.isFinishing());
        } finally { instrumentation.runOnMainSync(activity::finish); }
    }

    @Test
    public void invalidOrBusyExportsCannotOverwritePendingBytesOrSendFalseCompletion() throws Exception {
        MainActivity activity = start();
        File output = File.createTempFile("export-reserved-", ".json", activity.getCacheDir());
        try {
            WebView page = page(activity);
            installCapture(page);
            assertEquals("false", export(page, "not % base64", "invalid"));
            assertEquals("false", export(page, Base64.encodeToString(new byte[] {1}, Base64.NO_WRAP), ""));
            assertEquals(0, events(page).length());

            byte[] bytes = "Сохранённая резервная копия".getBytes(StandardCharsets.UTF_8);
            String encoded = Base64.encodeToString(bytes, Base64.NO_WRAP);
            Method reserve = MainActivity.class.getDeclaredMethod("reserveFileExport", String.class, String.class, String.class, String.class);
            reserve.setAccessible(true);
            assertNotNull(reserve.invoke(activity, encoded, "reserved.json", "application/json", "first"));
            assertEquals("false", export(page, Base64.encodeToString("wrong".getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP), "second"));
            assertEquals(0, events(page).length());
            instrumentation.runOnMainSync(() -> activity.onActivityResult(1002, Activity.RESULT_OK,
                new Intent().setData(Uri.fromFile(output))));
            assertEvent(page, 0, "first", "saved");
            assertArrayEquals(bytes, Files.readAllBytes(output.toPath()));
            // A duplicate result must not notify JavaScript again.
            instrumentation.runOnMainSync(() -> activity.onActivityResult(1002, Activity.RESULT_CANCELED, null));
            assertEquals(1, events(page).length());

            withPickerResult(Activity.RESULT_CANCELED, null, () -> {
                assertEquals("true", export(page, encoded, "after-busy"));
                assertEvent(page, 1, "after-busy", "cancelled");
            });
        } finally {
            output.delete();
            instrumentation.runOnMainSync(activity::finish);
        }
    }

    private MainActivity start() throws Exception {
        Intent intent = new Intent(instrumentation.getTargetContext(), MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        MainActivity activity = (MainActivity) instrumentation.startActivitySync(intent);
        WebView page = page(activity);
        List<String> console = Collections.synchronizedList(new ArrayList<>());
        instrumentation.runOnMainSync(() -> {
            page.setWebChromeClient(new WebChromeClient() {
                @Override public boolean onConsoleMessage(ConsoleMessage message) {
                    console.add(message.messageLevel() + ": " + message.message() + " @ " + message.sourceId() + ":" + message.lineNumber());
                    return true;
                }
            });
            page.reload();
        });
        long deadline = SystemClock.uptimeMillis() + 20_000;
        while (SystemClock.uptimeMillis() < deadline) {
            if ("true".equals(evaluate(page, "document.readyState === 'complete' && !!document.querySelector('.app-root') && typeof AndroidApp.copyTextChecked === 'function'"))) {
                // Let startup effects install their own optional callback before wrapping it.
                SystemClock.sleep(300);
                return activity;
            }
            SystemClock.sleep(100);
        }
        String details = evaluate(page, "JSON.stringify({url:location.href,ua:navigator.userAgent,state:document.readyState,app:!!document.querySelector('.app-root'),bridge:typeof AndroidApp,copy:typeof AndroidApp.copyTextChecked,body:document.body.innerText.slice(0,1200)})");
        instrumentation.runOnMainSync(activity::finish);
        throw new AssertionError("The offline application did not become ready: " + details + " console=" + console);
    }

    private WebView page(MainActivity activity) throws Exception {
        Field field = MainActivity.class.getDeclaredField("webView");
        field.setAccessible(true);
        return (WebView) field.get(activity);
    }

    private void saveScreenshot(MainActivity activity, String name) throws Exception {
        instrumentation.waitForIdleSync();
        SystemClock.sleep(300);
        android.graphics.Bitmap screenshot = instrumentation.getUiAutomation().takeScreenshot();
        assertNotNull("Android must provide the application screenshot", screenshot);
        android.content.ContentValues values = new android.content.ContentValues();
        values.put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, name);
        values.put(android.provider.MediaStore.MediaColumns.MIME_TYPE, "image/png");
        values.put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH,
            android.os.Environment.DIRECTORY_DOWNLOADS + "/arenda-pdf-test-output");
        Uri output = activity.getContentResolver().insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        assertNotNull(output);
        try (java.io.OutputStream stream = activity.getContentResolver().openOutputStream(output, "w")) {
            assertNotNull(stream);
            assertTrue(screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, stream));
        } finally { screenshot.recycle(); }
    }

    private String evaluate(WebView page, String script) throws Exception {
        AtomicReference<String> value = new AtomicReference<>();
        CountDownLatch done = new CountDownLatch(1);
        instrumentation.runOnMainSync(() -> page.evaluateJavascript(script, result -> {
            value.set(result);
            done.countDown();
        }));
        assertTrue("JavaScript result timed out", done.await(10, TimeUnit.SECONDS));
        return value.get();
    }

    private void installCapture(WebView page) throws Exception {
        evaluate(page, "window.__nativeFileEvents=[];window.onFileExportEnded=(id,status)=>window.__nativeFileEvents.push([id,status]);true");
    }

    private void waitFor(WebView page, String condition) throws Exception {
        long deadline = SystemClock.uptimeMillis() + 8_000;
        while (SystemClock.uptimeMillis() < deadline) {
            if ("true".equals(evaluate(page, condition))) return;
            SystemClock.sleep(50);
        }
        fail("The expected UI state did not appear: " + condition);
    }

    private void assertFitsViewport(WebView page, String selector) throws Exception {
        String condition = "(function(){var element=document.querySelector(" + JSONObject.quote(selector)
            + ");if(!element)return false;var rect=element.getBoundingClientRect();"
            + "return rect.width>0&&rect.height>0&&rect.left>=-1&&rect.top>=-1"
            + "&&rect.right<=innerWidth+1&&rect.bottom<=innerHeight+1;})()";
        waitFor(page, condition);
    }

    private void tapElement(WebView page, String expression) throws Exception {
        evaluate(page, "(function(){var element=" + expression
            + ";if(!element)throw new Error('Tap target is missing');element.scrollIntoView({block:'center',inline:'center'});return true;})()");
        SystemClock.sleep(250);
        JSONArray point = new JSONArray(evaluate(page, "(function(){var rect=(" + expression
            + ").getBoundingClientRect();return [rect.left+rect.width/2,rect.top+rect.height/2,innerWidth,innerHeight];})()"));
        assertTrue("The tap target must be visible horizontally", point.getDouble(0) >= 0 && point.getDouble(0) < point.getDouble(2));
        assertTrue("The tap target must be visible vertically", point.getDouble(1) >= 0 && point.getDouble(1) < point.getDouble(3));
        int[] origin = new int[2];
        AtomicReference<Integer> width = new AtomicReference<>();
        instrumentation.runOnMainSync(() -> { page.getLocationOnScreen(origin); width.set(page.getWidth()); });
        double scale = width.get() / point.getDouble(2);
        float x = (float) (origin[0] + point.getDouble(0) * scale);
        float y = (float) (origin[1] + point.getDouble(1) * scale);
        long downTime = SystemClock.uptimeMillis();
        MotionEvent down = MotionEvent.obtain(downTime, downTime, MotionEvent.ACTION_DOWN, x, y, 0);
        MotionEvent up = MotionEvent.obtain(downTime, downTime + 80, MotionEvent.ACTION_UP, x, y, 0);
        try {
            instrumentation.sendPointerSync(down);
            instrumentation.sendPointerSync(up);
            instrumentation.waitForIdleSync();
        } finally { down.recycle(); up.recycle(); }
    }

    private String export(WebView page, String encoded, String requestId) throws Exception {
        return evaluate(page, "AndroidApp.saveBase64FileWithResult(" + JSONObject.quote(encoded)
            + ",\"native-test.json\",\"application/json\"," + JSONObject.quote(requestId) + ")");
    }

    private JSONArray events(WebView page) throws Exception {
        return new JSONArray(evaluate(page, "window.__nativeFileEvents || []"));
    }

    private void assertEvent(WebView page, int index, String requestId, String status) throws Exception {
        long deadline = SystemClock.uptimeMillis() + 8_000;
        while (SystemClock.uptimeMillis() < deadline) {
            JSONArray captured = events(page);
            if (captured.length() > index) {
                assertEquals(requestId, captured.getJSONArray(index).getString(0));
                assertEquals(status, captured.getJSONArray(index).getString(1));
                return;
            }
            SystemClock.sleep(50);
        }
        fail("No file export completion for " + requestId);
    }

    private interface CheckedAction { void run() throws Exception; }

    private void withPickerResult(int resultCode, Intent data, CheckedAction action) throws Exception {
        IntentFilter filter = new IntentFilter(Intent.ACTION_CREATE_DOCUMENT);
        filter.addCategory(Intent.CATEGORY_OPENABLE);
        filter.addDataType("*/*");
        Instrumentation.ActivityMonitor monitor = instrumentation.addMonitor(filter,
            new Instrumentation.ActivityResult(resultCode, data), true);
        try {
            action.run();
            assertEquals("The document picker must be intercepted by the test", 1, monitor.getHits());
        } finally { instrumentation.removeMonitor(monitor); }
    }
}
