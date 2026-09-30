import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { CertificateRejected, MAX_CERTIFICATE_BYTES, activePdfFeature, cleanCertificate, isPdf } from "@/lib/coach-applications/files";

const pdf = (body: string) => new TextEncoder().encode(`%PDF-1.7\n${body}\n%%EOF`);
const file = (bytes: Uint8Array | Buffer, name = "certificate", type = "application/octet-stream") => new File([new Uint8Array(bytes)], name, { type });

test("a PDF is recognised by its own first bytes, not its name", () => {
  assert.ok(isPdf(pdf("1 0 obj << /Type /Catalog >> endobj")));
  assert.ok(!isPdf(new TextEncoder().encode("<html>not a pdf</html>")));
});

test("PDFs that run code, launch programs or carry files are refused — including escaped names", () => {
  assert.equal(activePdfFeature(pdf("<< /S /JavaScript /JS (app.alert(1)) >>")), "/JavaScript");
  assert.equal(activePdfFeature(pdf("<< /S /J#61vaScript >>")), "/JavaScript");
  assert.equal(activePdfFeature(pdf("<< /Type /Action /S /Launch >>")), "/Launch");
  assert.equal(activePdfFeature(pdf("<< /Names << /EmbeddedFiles 3 0 R >> >>")), "/EmbeddedFiles");
  assert.equal(activePdfFeature(pdf("<< /Type /EmbeddedFile >>")), "/EmbeddedFile");
  assert.equal(activePdfFeature(pdf("<< /Type /Page /JSON 1 >>")), null, "/JSON is not /JS");
  assert.equal(activePdfFeature(pdf("<< /Type /Catalog /Pages 2 0 R >>")), null);
});

test("a plain PDF is accepted unchanged; an active one is refused with a way forward", async () => {
  const plain = await cleanCertificate(file(pdf("<< /Type /Catalog >>"), "c.pdf", "application/pdf"));
  assert.equal(plain.kind, "pdf");
  assert.equal(plain.contentType, "application/pdf");
  await assert.rejects(cleanCertificate(file(pdf("<< /S /JavaScript >>"), "c.pdf")), (e: Error) => e instanceof CertificateRejected && /plain PDF|photo/.test(e.message));
});

test("anything that isn't a photo or PDF is refused, whatever it's called", async () => {
  await assert.rejects(cleanCertificate(file(new TextEncoder().encode("MZ executable"), "certificate.jpg", "image/jpeg")), CertificateRejected);
  await assert.rejects(cleanCertificate(file(new Uint8Array(0), "empty.png")), CertificateRejected);
});

test("files over the size cap are refused before being read", async () => {
  await assert.rejects(cleanCertificate(file(new Uint8Array(MAX_CERTIFICATE_BYTES + 1), "big.pdf")), /4 MB/);
});

test("a photo is re-encoded as WebP with its location and camera details removed, and not cropped", async () => {
  const jpeg = await sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: 200, g: 180, b: 150 } } })
    .jpeg()
    .withExif({ IFD0: { Make: "PhoneMaker", Model: "Phone 9" }, GPS: { GPSLatitudeRef: "N", GPSLatitude: "27/1 42/1 0/1" } } as never)
    .toBuffer();
  assert.ok((await sharp(jpeg).metadata()).exif, "the test photo really carries EXIF");

  const clean = await cleanCertificate(file(jpeg, "cert.jpg", "image/jpeg"));
  assert.equal(clean.kind, "image");
  assert.equal(clean.contentType, "image/webp");
  const meta = await sharp(clean.body).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.exif, undefined, "no EXIF (and so no GPS) survives");
  assert.equal(meta.width, 1200);
  assert.equal(meta.height, 800, "proportions kept: a certificate must stay readable");
});
