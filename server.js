import express from "express";
import cors from "cors";
import multer from "multer";
import JSZip from "jszip";
import QRCode from "qrcode";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();

// Render assigns its own port.
// Local use will remain on port 3003.
const PORT = process.env.PORT || 3003;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadsDirectory = path.join(
  __dirname,
  "uploads"
);

// Automatically create the temporary uploads folder.
await fs.mkdir(uploadsDirectory, {
  recursive: true,
});

app.disable("x-powered-by");

app.use(cors());

app.use((req, res, next) => {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, private"
  );

  next();
});

app.use(
  express.static(__dirname, {
    index: false,
  })
);

const upload = multer({
  dest: uploadsDirectory,

  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1,
  },

  fileFilter: (req, file, callback) => {
    const filename =
      file.originalname.toLowerCase();

    if (!filename.endsWith(".pkpass")) {
      return callback(
        new Error(
          "Please upload a valid .pkpass file."
        )
      );
    }

    callback(null, true);
  },
});

function findField(fields = [], key) {
  return (
    fields.find((field) => field.key === key)
      ?.value ?? ""
  );
}

app.post(
  "/analyze-pkpass",
  upload.single("pkpass"),

  async (req, res) => {
    let uploadedPath = null;

    try {
      if (!req.file) {
        return res.status(400).json({
          error: "No .pkpass file uploaded.",
        });
      }

      uploadedPath = req.file.path;

      const pkpassBuffer =
        await fs.readFile(uploadedPath);

      const zip =
        await JSZip.loadAsync(pkpassBuffer);

      const passFile = zip.file("pass.json");

      if (!passFile) {
        return res.status(400).json({
          error:
            "pass.json was not found inside the PKPass.",
        });
      }

      const passText =
        await passFile.async("string");

      const pass = JSON.parse(passText);

      const ticket =
        pass.eventTicket ??
        pass.generic ??
        pass.boardingPass ??
        pass.coupon ??
        pass.storeCard ??
        {};

      const primaryFields =
        ticket.primaryFields ?? [];

      const secondaryFields =
        ticket.secondaryFields ?? [];

      const auxiliaryFields =
        ticket.auxiliaryFields ?? [];

      const headerFields =
        ticket.headerFields ?? [];

      const backFields =
        ticket.backFields ?? [];

      const allFields = [
        ...headerFields,
        ...primaryFields,
        ...secondaryFields,
        ...auxiliaryFields,
        ...backFields,
      ];

      const barcode =
        pass.barcodes?.[0] ??
        pass.barcode ??
        null;

      if (!barcode?.message) {
        return res.status(400).json({
          error:
            "No barcode message was found in this PKPass.",
        });
      }

      /*
       * Current Version:
       * Generates a QR code from the barcode message.
       *
       * Before using non-QR NCAA passes, we will add
       * native PDF417 and Aztec rendering.
       */
      const qrDataUrl =
        await QRCode.toDataURL(
          String(barcode.message),
          {
            width: 700,
            margin: 3,
            errorCorrectionLevel: "M",
          }
        );

      const eventName =
        findField(allFields, "event") ||
        findField(allFields, "eventName") ||
        primaryFields[0]?.value ||
        secondaryFields[0]?.value ||
        pass.description ||
        "";

      return res.json({
        description:
          pass.description ?? "",

        organization:
          pass.organizationName ?? "",

        event: eventName,

        venue:
          findField(allFields, "venue") ||
          findField(allFields, "location"),

        section:
          findField(allFields, "section") ||
          findField(allFields, "sec"),

        row:
          findField(allFields, "row"),

        seat:
          findField(allFields, "seat") ||
          findField(allFields, "seatNumber"),

        date:
          findField(allFields, "date") ||
          headerFields[0]?.value ||
          "",

        time:
          findField(allFields, "time") ||
          "",

        barcodeFormat:
          barcode.format ?? "",

        barcodeMessage:
          String(barcode.message),

        barcodeAlternateText:
          barcode.altText ?? "",

        qrDataUrl,
      });
    } catch (error) {
      console.error(
        "PKPass analysis failed:",
        error instanceof Error
          ? error.message
          : error
      );

      return res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Unable to read the PKPass.",
      });
    } finally {
      if (uploadedPath) {
        await fs
          .unlink(uploadedPath)
          .catch(() => {});
      }
    }
  }
);

// Friendly handling for Multer/upload errors.
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({
      error:
        error.code === "LIMIT_FILE_SIZE"
          ? "The PKPass exceeds the 10 MB limit."
          : error.message,
    });
  }

  if (error instanceof Error) {
    return res.status(400).json({
      error: error.message,
    });
  }

  next(error);
});

app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "index.html")
  );
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `PKPass Viewer running on port ${PORT}`
  );
});