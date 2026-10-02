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
        java.io.File outputDirectory = activity.getExternalFilesDir("pdf-test-output");
        assertNotNull(outputDirectory);
        assertTrue(outputDirectory.isDirectory() || outputDirectory.mkdirs());
        try (Cursor cursor = activity.getContentResolver().query(uri.get(),
                new String[] { MediaStore.MediaColumns.IS_PENDING }, null, null, null)) {
            assertNotNull(cursor);
            assertTrue("PDF was deleted because export failed", cursor.moveToFirst());
            assertEquals("PDF remains hidden in Downloads", 0, cursor.getInt(0));
        }
        try (java.io.InputStream input = activity.getContentResolver().openInputStream(uri.get());
             java.io.OutputStream output = new java.io.FileOutputStream(new java.io.File(outputDirectory, name + ".pdf"))) {
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
                    Bitmap image = Bitmap.createBitmap(page.getWidth(), page.getHeight(), Bitmap.Config.ARGB_8888);
                    image.eraseColor(Color.WHITE);
                    page.render(image, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                    int ink = 0;
                    for (int y = 0; y < image.getHeight(); y += 2) {
                        for (int x = 0; x < image.getWidth(); x += 2) {
                            int color = image.getPixel(x, y);
                            if (Color.red(color) < 100 && Color.green(color) < 100 && Color.blue(color) < 100) ink++;
                        }
                    }
                    try (java.io.OutputStream output = new java.io.FileOutputStream(
                            new java.io.File(outputDirectory, name + "-" + (i + 1) + ".png"))) {
                        assertTrue(image.compress(Bitmap.CompressFormat.PNG, 100, output));
                    }
                    image.recycle();
                    assertTrue(name + " page " + (i + 1) + " is blank (ink=" + ink + ")", ink > 500);
                }
            }
        }
    }
}
