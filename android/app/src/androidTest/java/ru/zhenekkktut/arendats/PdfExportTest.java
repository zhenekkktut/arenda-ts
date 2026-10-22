package ru.zhenekkktut.arendats;

import android.app.Instrumentation;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.provider.MediaStore;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class PdfExportTest {
    @Test
    public void savesBothActsToDownloadsWithAllPagesAndAllowsAnotherExport() throws Exception {
        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        Intent intent = new Intent(instrumentation.getTargetContext(), MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        MainActivity activity = (MainActivity) instrumentation.startActivitySync(intent);
        try {
            exportAndCheck(instrumentation, activity, "reconciliation", 2);
            exportAndCheck(instrumentation, activity, "reconciliation-compact", 1);
            exportAndCheck(instrumentation, activity, "rent", 1);
            exportAndCheck(instrumentation, activity, "reconciliation-mixed", 2);
        } finally { instrumentation.runOnMainSync(activity::finish); }
    }

    private void exportAndCheck(Instrumentation instrumentation, MainActivity activity, String name, int pages) throws Exception {
        String html;
        try (java.io.InputStream input = instrumentation.getContext().getAssets().open(name + ".html")) {
            java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int length;
            while ((length = input.read(buffer)) != -1) bytes.write(buffer, 0, length);
            html = new String(bytes.toByteArray(), StandardCharsets.UTF_8);
        }
        if (name.equals("reconciliation-mixed")) assertMixedFixture(html);
        if (name.equals("rent")) assertSignedVariableRentFixture(html);
        if (name.equals("reconciliation-compact")) assertSignedVariableReconciliationFixture(html);
        Method save = MainActivity.class.getDeclaredMethod("beginPdfSave", String.class, String.class, String.class);
        save.setAccessible(true);
        Field destination = MainActivity.class.getDeclaredField("pdfDestination");
        destination.setAccessible(true);
        Field busy = MainActivity.class.getDeclaredField("pdfInProgress");
        busy.setAccessible(true);
        AtomicReference<Uri> uri = new AtomicReference<>();
        AtomicReference<Throwable> failure = new AtomicReference<>();
        instrumentation.runOnMainSync(() -> {
            try {
                save.invoke(activity, html, "test-" + name + ".pdf", null);
                uri.set((Uri) destination.get(activity));
            } catch (Throwable error) { failure.set(error); }
        });
        assertNull(failure.get());
        assertNotNull("Export did not create a Downloads destination", uri.get());
        AtomicBoolean running = new AtomicBoolean(true);
        long deadline = SystemClock.uptimeMillis() + 35_000;
        while (running.get() && SystemClock.uptimeMillis() < deadline) {
            SystemClock.sleep(100);
            instrumentation.runOnMainSync(() -> {
                try { running.set(busy.getBoolean(activity)); }
                catch (Exception error) { failure.set(error); }
            });
        }
        assertNull(failure.get());
        assertFalse("PDF export remained stuck", running.get());
        try (Cursor cursor = activity.getContentResolver().query(uri.get(),
                new String[] { MediaStore.MediaColumns.IS_PENDING }, null, null, null)) {
            assertNotNull(cursor);
            assertTrue("PDF was deleted because export failed", cursor.moveToFirst());
            assertEquals("PDF remains hidden in Downloads", 0, cursor.getInt(0));
        }
        try (java.io.InputStream input = activity.getContentResolver().openInputStream(uri.get());
             java.io.OutputStream output = testOutput(activity, name + ".pdf")) {
            assertNotNull(input);
            byte[] buffer = new byte[8192];
            int length;
            while ((length = input.read(buffer)) != -1) output.write(buffer, 0, length);
        }
        try (ParcelFileDescriptor fd = activity.getContentResolver().openFileDescriptor(uri.get(), "r");
             PdfRenderer renderer = new PdfRenderer(fd)) {
            assertEquals("PDF lost pages or added blank pages", pages, renderer.getPageCount());
            for (int i = 0; i < pages; i++) {
                try (PdfRenderer.Page page = renderer.openPage(i)) {
                    assertEquals(595, page.getWidth(), 2);
                    assertEquals(842, page.getHeight(), 2);
                    // Render at 144 dpi: thin 8.7 pt table text is mostly antialias
                    // pixels at 72 dpi and must not be mistaken for a blank page.
                    Bitmap image = Bitmap.createBitmap(page.getWidth() * 2, page.getHeight() * 2, Bitmap.Config.ARGB_8888);
                    image.eraseColor(Color.WHITE);
                    page.render(image, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                    int ink = 0;
                    for (int y = 0; y < image.getHeight(); y += 2) {
                        for (int x = 0; x < image.getWidth(); x += 2) {
                            int color = image.getPixel(x, y);
                            if (Color.red(color) < 100 && Color.green(color) < 100 && Color.blue(color) < 100) ink++;
                        }
                    }
                    try (java.io.OutputStream output = testOutput(activity, name + "-" + (i + 1) + ".png")) {
                        assertTrue(image.compress(Bitmap.CompressFormat.PNG, 100, output));
                    }
                    image.recycle();
                    assertTrue(name + " page " + (i + 1) + " is blank (ink=" + ink + ")", ink > 500);
                }
            }
        }
    }

    private void assertMixedFixture(String html) {
        String normalized = html.replace('\u00a0', ' ').replace('\u202f', ' ');
        String invoices = tableContent(normalized, "reconciliation-invoices");
        String daily = tableContent(normalized, "reconciliation-daily");
        assertEquals("The bank invoice must appear once, with one total payment", 1,
            occurrences(invoices, "№ 30<br>"));
        assertEquals("Earlier fixed invoices must retain their explicit unlinked status", 2,
            occurrences(invoices, "Без привязки к дням"));
        assertTrue("The combined face, shared receipt and remaining invoice debt must reconcile",
            Pattern.compile("№ 30<br>08\\.10\\.2026</td>\\s*<td class=\"value\">29 500,00</td>\\s*"
                + "<td class=\"value\">10 000,00</td><td class=\"value\">19 500,00</td>")
                .matcher(invoices).find());
        assertFalse("No invented day links for the earlier fixed invoice", daily.contains("№ 28"));
        assertFalse("No invented day links for the second fixed invoice", daily.contains("№ 29"));
        assertTrue("The last included day must retain its partial invoice amount", daily.contains("№ 30: 3 300,00 руб."));
        assertTrue("Physical delivery money outside the invoice must remain visible",
            daily.contains("Не включено в счета: 1 700,00 руб."));
        int[] days = {10, 11, 12, 14, 15, 16, 17, 18, 22, 23, 24, 25, 28, 29, 30};
        for (int day : days) {
            assertEquals("Every actual delivery date must occur once across PDF continuations", 1,
                occurrences(daily, "<td>" + day + ".09.2026</td>"));
        }
        assertTrue("One shared allocation must explain the complete combined invoice",
            daily.contains("включено по датам 29 500,00 руб.; итого по счёту 29 500,00 руб."));
        assertEquals("Monthly customer fuel must be deducted once", 1,
            occurrences(daily, "Вычет топлива заказчика за месяц"));
        assertTrue("Fuel rounding must use the monthly 313 bottles", daily.contains("313 бутылей"));
        assertTrue("The monthly rounded deduction must be 12,520 rubles", daily.contains("−12 520,00</td>"));
        assertTrue("The net monthly amount must remain 73,000 rubles", daily.contains("73 000,00</td>"));
        assertTrue("The physical monthly bottle count must remain unchanged", daily.contains(">2 138</td>"));
    }

    private void assertSignedVariableRentFixture(String html) {
        String normalized = html.replace('\u00a0', ' ').replace('\u202f', ' ');
        assertTrue("Fuel must never alter the fixed component or its contractual day formula", normalized.contains(
            "Постоянная часть Ф = 80 000 × d / D</td><td class=\"value\">77 333,33 руб.</td>"));
        assertTrue("The complete customer fuel deduction belongs to signed variable rent", normalized.contains(
            "Переменная часть П</td><td class=\"value\">-5 000,00 руб.</td>"));
        assertTrue("The signed components must sum to the final monthly rent", normalized.contains(
            "Итого: Ф + П</td><td class=\"value\">72 333,33 руб.</td>"));
        assertFalse("The act must not advertise a contradictory maximum formula", normalized.contains("Итого: большая из сумм"));
        assertFalse("Customer fuel details belong only in reconciliation", normalized.toLowerCase(java.util.Locale.ROOT).contains("топлив"));
    }

    private void assertSignedVariableReconciliationFixture(String html) {
        String normalized = html.replace('\u00a0', ' ').replace('\u202f', ' ');
        String daily = tableContent(normalized, "reconciliation-daily");
        assertTrue("The original monthly charge must retain fixed rent before customer fuel", daily.contains(
            "5 000,00</td><td class=\"value\">77 333,33</td>"));
        assertTrue("The complete fuel sum must be assigned to the variable component", daily.contains(
            "Вычет топлива заказчика за месяц из переменной части: 125 бутылей × 40,00 руб.</td><td class=\"value\">−5 000,00</td>"));
        assertTrue("The signed variable component must reduce the net monthly total once", daily.contains(
            "Итого к оплате за месяц после вычета топлива</td><td class=\"value\">72 333,33</td>"));
    }

    private String tableContent(String html, String className) {
        Matcher tables = Pattern.compile("<table class=\"" + className + "\">[\\s\\S]*?</table>").matcher(html);
        StringBuilder result = new StringBuilder();
        while (tables.find()) result.append(tables.group());
        assertTrue("The expected document table is missing: " + className, result.length() > 0);
        return result.toString();
    }

    private int occurrences(String text, String fragment) {
        int count = 0;
        for (int at = 0; (at = text.indexOf(fragment, at)) >= 0; at += fragment.length()) count++;
        return count;
    }

    private java.io.OutputStream testOutput(MainActivity activity, String name) throws Exception {
        android.content.ContentValues values = new android.content.ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
        values.put(MediaStore.MediaColumns.MIME_TYPE, name.endsWith(".png") ? "image/png" : "application/pdf");
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, android.os.Environment.DIRECTORY_DOWNLOADS + "/arenda-pdf-test-output");
        Uri output = activity.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        assertNotNull(output);
        java.io.OutputStream stream = activity.getContentResolver().openOutputStream(output, "w");
        assertNotNull(stream);
        return stream;
    }
}
