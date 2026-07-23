import express from "express";
import cors from "cors";
import multer from "multer";
import JSZip from "jszip";
import QRCode from "qrcode";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();

const PORT = process.env.PORT || 3003;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadsDirectory = path.join(
  __dirname,
  "uploads"
);

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

/*
|--------------------------------------------------------------------------
| Upload Configuration
|--------------------------------------------------------------------------
*/

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

/*
|--------------------------------------------------------------------------
| Helper Functions
|--------------------------------------------------------------------------
*/

function findField(fields = [], key) {
  const normalizedKey =
    String(key).toLowerCase();

  return (
    fields.find((field) => {
      return (
        String(field?.key ?? "")
          .toLowerCase() === normalizedKey
      );
    })?.value ?? ""
  );
}

function getMimeType(filename) {
  const lowerName =
    filename.toLowerCase();

  if (lowerName.endsWith(".png")) {
    return "image/png";
  }

  if (
    lowerName.endsWith(".jpg") ||
    lowerName.endsWith(".jpeg")
  ) {
    return "image/jpeg";
  }

  return "application/octet-stream";
}

async function getAssetDataUrl(
  zip,
  possibleFilenames
) {
  const zipEntries =
    Object.keys(zip.files);

  for (
    const possibleFilename
    of possibleFilenames
  ) {
    const targetName =
      possibleFilename.toLowerCase();

    const matchingPath =
      zipEntries.find((entryName) => {
        const normalizedEntry =
          entryName
            .replaceAll("\\", "/")
            .toLowerCase();

        return (
          normalizedEntry === targetName ||
          normalizedEntry.endsWith(
            `/${targetName}`
          )
        );
      });

    if (!matchingPath) {
      continue;
    }

    const assetFile =
      zip.file(matchingPath);

    if (!assetFile || assetFile.dir) {
      continue;
    }

    const assetBase64 =
      await assetFile.async("base64");

    const mimeType =
      getMimeType(matchingPath);

    return (
      `data:${mimeType};base64,` +
      assetBase64
    );
  }

  return "";
}

function getPassType(pass) {
  if (pass.eventTicket) {
    return "eventTicket";
  }

  if (pass.boardingPass) {
    return "boardingPass";
  }

  if (pass.storeCard) {
    return "storeCard";
  }

  if (pass.coupon) {
    return "coupon";
  }

  if (pass.generic) {
    return "generic";
  }

  return "unknown";
}

function getPassFields(pass) {
  return (
    pass.eventTicket ??
    pass.generic ??
    pass.boardingPass ??
    pass.coupon ??
    pass.storeCard ??
    {}
  );
}

/*
|--------------------------------------------------------------------------
| Analyze PKPass
|--------------------------------------------------------------------------
*/

app.post(
  "/analyze-pkpass",
  upload.single("pkpass"),

  async (req, res) => {
    let uploadedPath = null;

    try {
      if (!req.file) {
        return res.status(400).json({
          error:
            "No .pkpass file uploaded.",
        });
      }

      uploadedPath = req.file.path;

      const pkpassBuffer =
        await fs.readFile(
          uploadedPath
        );

      const zip =
        await JSZip.loadAsync(
          pkpassBuffer
        );

      console.log(
        "PKPass files:",
        Object.keys(zip.files)
      );

      const passFile =
        zip.file("pass.json");

      if (!passFile) {
        return res.status(400).json({
          error:
            "pass.json was not found inside the PKPass.",
        });
      }

      const passText =
        await passFile.async("string");

      const pass =
        JSON.parse(passText);

      /*
      |--------------------------------------------------------------------------
      | Extract Original PKPass Assets
      |--------------------------------------------------------------------------
      */

      const logoImage =
        await getAssetDataUrl(
          zip,
          [
            "logo@3x.png",
            "logo@2x.png",
            "logo.png",
            "logo@3x.jpg",
            "logo@2x.jpg",
            "logo.jpg",
          ]
        );

      const stripImage =
        await getAssetDataUrl(
          zip,
          [
            "strip@3x.png",
            "strip@2x.png",
            "strip.png",
            "strip@3x.jpg",
            "strip@2x.jpg",
            "strip.jpg",
          ]
        );

      const thumbnailImage =
        await getAssetDataUrl(
          zip,
          [
            "thumbnail@3x.png",
            "thumbnail@2x.png",
            "thumbnail.png",
            "thumbnail@3x.jpg",
            "thumbnail@2x.jpg",
            "thumbnail.jpg",
          ]
        );

      const iconImage =
        await getAssetDataUrl(
          zip,
          [
            "icon@3x.png",
            "icon@2x.png",
            "icon.png",
            "icon@3x.jpg",
            "icon@2x.jpg",
            "icon.jpg",
          ]
        );

      const backgroundImage =
        await getAssetDataUrl(
          zip,
          [
            "background@3x.png",
            "background@2x.png",
            "background.png",
            "background@3x.jpg",
            "background@2x.jpg",
            "background.jpg",
          ]
        );

      const footerImage =
        await getAssetDataUrl(
          zip,
          [
            "footer@3x.png",
            "footer@2x.png",
            "footer.png",
            "footer@3x.jpg",
            "footer@2x.jpg",
            "footer.jpg",
          ]
        );

      /*
      |--------------------------------------------------------------------------
      | Read Ticket Fields
      |--------------------------------------------------------------------------
      */

      const ticket =
        getPassFields(pass);

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

      /*
      |--------------------------------------------------------------------------
      | Barcode
      |--------------------------------------------------------------------------
      */

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

      const barcodeMessage =
        String(barcode.message);

      /*
       * Current version renders the value as a QR code.
       * Native PDF417 and Aztec support can be added later.
       */
      const qrDataUrl =
        await QRCode.toDataURL(
          barcodeMessage,
          {
            width: 700,
            margin: 3,
            errorCorrectionLevel: "M",
          }
        );

      /*
      |--------------------------------------------------------------------------
      | Ticket Details
      |--------------------------------------------------------------------------
      */

      const eventName =
        findField(
          allFields,
          "event"
        ) ||
        findField(
          allFields,
          "eventName"
        ) ||
        primaryFields[0]?.value ||
        secondaryFields[0]?.value ||
        pass.description ||
        "";

      const venue =
        findField(
          allFields,
          "venue"
        ) ||
        findField(
          allFields,
          "location"
        );

      const section =
        findField(
          allFields,
          "section"
        ) ||
        findField(
          allFields,
          "sec"
        );

      const row =
        findField(
          allFields,
          "row"
        );

      const seat =
        findField(
          allFields,
          "seat"
        ) ||
        findField(
          allFields,
          "seatNumber"
        );

      const date =
        findField(
          allFields,
          "date"
        ) ||
        headerFields[0]?.value ||
        "";

      const time =
        findField(
          allFields,
          "time"
        ) ||
        headerFields[0]?.label ||
        "";

      /*
      |--------------------------------------------------------------------------
      | Response
      |--------------------------------------------------------------------------
      */

      return res.json({
        description:
          pass.description ?? "",

        organization:
          pass.organizationName ?? "",

        logoText:
          pass.logoText ||
          pass.organizationName ||
          "",

        passType:
          getPassType(pass),

        event:
          eventName,

        venue,

        section,

        row,

        seat,

        date,

        time,

        backgroundColor:
          pass.backgroundColor ||
          "#0d5db9",

        foregroundColor:
          pass.foregroundColor ||
          "#ffffff",

        labelColor:
          pass.labelColor ||
          pass.foregroundColor ||
          "#ffffff",

        logoImage,

        stripImage,

        thumbnailImage,

        iconImage,

        backgroundImage,

        footerImage,

        barcodeFormat:
          barcode.format ?? "",

        barcodeMessage,

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

/*
|--------------------------------------------------------------------------
| Upload Error Handling
|--------------------------------------------------------------------------
*/

app.use(
  (error, req, res, next) => {
    if (
      error instanceof
      multer.MulterError
    ) {
      return res.status(400).json({
        error:
          error.code ===
          "LIMIT_FILE_SIZE"
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
  }
);

/*
|--------------------------------------------------------------------------
| Frontend
|--------------------------------------------------------------------------
*/

app.get("/", (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "index.html"
    )
  );
});

/*
|--------------------------------------------------------------------------
| Start Server
|--------------------------------------------------------------------------
*/

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `PKPass Viewer running on port ${PORT}`
    );
  }
);