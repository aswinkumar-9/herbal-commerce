# 0023. Product images

- Status: Accepted and implemented (part 4D)
- Date: 2026-11-06

## Context

Parts 4A to 4C added categories, products, and pack sizes with prices (ADR 0020 to ADR 0022). A shop also needs photos: the front of the pack, and often the back label with the ingredients, the licence and the MRP. Part 4D adds them.

It is the first part in which anyone uploads a file to the API, so it adds attack surface. `docs/security.md` had listed "file upload validation" as "Later (part 4D)", with these rules: limits on size and count, the real file type checked, images re-encoded, random file names, and no SVG.

The owner made four choices on 2026-11-05:
- **At most 6 images per product.**
- **Images belong to the product, not to a pack size.** Every pack shares them.
- **A product needs at least one image to go live.**
- **Admins may delete images too.** Replacing a photo is everyday work, so this is the one deletion in the catalog that is not for Super Users only.

## Decision

### The table

`product_images` holds one image of a product:
- `productId`, with a foreign key `ON DELETE CASCADE`: the images go with their product;
- `fileKey`: a random UUID that names the image's two files. It is unique, and separate from the `id`, so the shop shows the addresses of the files and never an ID;
- `width` and `height`: the large file's size in pixels, so a page can keep room for it while it loads;
- `altText`: optional, up to 150 characters, describing the photo for people who cannot see it. Without one, the shop uses the product's name;
- `position`: a whole number from 0 to 9999. Images are listed by position, then the oldest first. The first is the main photo;
- `createdAt` and `updatedAt`.

### Two rules, in both layers

**A product has at most 6 images, and a live product at least 1.** As for a live product's details (ADR 0021), two layers enforce both:

1. **The API** checks them after a row lock on the product. Uploads, deletions and going live all lock the product first, so they take turns:
   - a 7th image answers `409 A product has at most 6 images. Delete one first.`;
   - deleting the last image of a live product answers `409 A live product needs at least one image. Add another first, or take the product offline.`;
   - going live without an image answers `400 Validation failed`, with `images` "Needed before the product can go live". A new product therefore always starts as a draft: images can only be added to a product that exists.
2. **The database** has three triggers in the migration. A check constraint sees one row only, and both rules count the rows of another table:
   - `product_images_at_most_six`, before an image is added, locks the product and counts its images;
   - `products_live_needs_an_image`, when a product goes live, refuses it without an image;
   - `product_images_keep_one_while_live`, after an image is deleted, locks the product first and refuses if a live product has none left. A product deleted together with its images is no longer found, so it passes.

The migration refused to run while any product was live, because that product would have had no image (a guard, as in ADR 0003). The triggers were tested in 12 cases on temporary tables, inside a transaction that was rolled back.

### The upload

- **`POST /v1/staff/products/:productId/images`. The request body is the image itself**, with `Content-Type: image/jpeg`, `image/png` or `image/webp`. One image per request, at most 10 MB.
- **Not a multipart form.** Windows PowerShell 5.1 sends a file with `-InFile`, and a browser sends a `File` with `fetch`. The form-upload library `multer` stays unused.
- **The body is parsed on this route only,** with Express's `raw()` parser (ADR 0008).
- **It is read only for a valid staff token.** A body is read before any guard runs, so otherwise anyone could make the API hold 10 MB per request. The parser checks the token's signature and audience first. Without a valid staff token, the upload is left unread and the guard answers `401`. For a large upload, the client may see the connection closed instead.
- Other refusals before any image work:
  - `413 Request body too large` above 10 MB;
  - `415` for a compressed body;
  - `415 Send one JPEG, PNG or WebP image as the request body, with its Content-Type` for any other body, JSON included.

### Checking and re-encoding

`catalog/image-processing.ts`, with the image library sharp 0.35.5 (libvips 8.18.7):

1. **The file's first bytes must show the type its `Content-Type` claims:** JPEG `FF D8 FF`, PNG `89 50 4E 47…`, WebP `RIFF…WEBP`. Only these three types ever reach the image library. It could also read SVG, GIF, TIFF and HEIF, and each one is more code that could have a flaw.
2. **The size is read from the file's header, before anything is decoded:**
   - at most 50 megapixels, so a few bytes that claim a huge image (a "decompression bomb") are refused at once;
   - at least 400 pixels on each side, so a blurry thumbnail never reaches the shop.
3. **Two WebP files are made, at quality 80:**
   - a large one, at most 1600 pixels on its longest side;
   - a small one, at most 400 pixels, for list pages.

   They are never enlarged, and they are turned upright (a phone may store a portrait photo lying on its side). **Only the pixels are kept:** EXIF data, the GPS location of a phone photo, colour profiles and anything hidden in the file are left behind. A file cut short is refused, not padded with grey.

Refusals answer `400 Validation failed` on `image`:
- `The file is not a JPEG image` (or PNG, or WebP);
- `The image could not be read. It may be damaged.`;
- `The image may have at most 50 megapixels`;
- `The image needs at least 400 pixels on each side`.

**Image work is the heaviest work the API does:**
- at most 2 images are processed at once, and 10 more wait in line. Beyond that, the answer is `503 SERVER_BUSY` with `Retry-After`, as for password hashing (ADR 0009);
- uploads have their own rate limit, `imageUploads`: 120 per hour per IP.

### Storage and serving

- **`MediaStorage`** (`src/media`) saves, deletes and gives the address of a file:
  - it never replaces a file. A new photo gets a new key, so a file can be cached for good;
  - it accepts only names the API makes, such as `products/<key>-large.webp`, so no name can lead out of the folder or to a hidden file.
- **On a laptop**, the files live in `MEDIA_DIR` (default `storage/media` inside `apps/api`, ignored by Git). The API serves them at `/media`, and links to them through `MEDIA_BASE_URL` (default `http://127.0.0.1:3000/media`; it must be `https` in production).
- **`/media` serves files only:**
  - no folder listing and no hidden file;
  - browsers may cache a file for a year (`immutable`);
  - other sites, such as the shop's website, may show it (`Cross-Origin-Resource-Policy: cross-origin`; helmet's default allows only the API's own pages).

  Like every address outside `/v1`, a missing file answers Express's plain HTML 404 page, not JSON.
- **When the API is deployed,** object storage behind a CDN takes `MediaStorage`'s place, with the same three methods.
- **A draft's images can be fetched by anyone who knows their address.** The address holds a random UUID, which cannot be guessed, and product photos are not secret.

### Files and rows

A file and a database row cannot share a transaction, so their order is fixed:
- **Upload:** the files are saved first, then the row is recorded in a transaction. If it is not recorded (a 7th image, or an unknown product), the files are deleted again.
- **Deleting an image or a product:** the row goes first. The files are deleted once the deletion is saved.

A file that cannot be deleted is logged (`Image files not deleted`), never thrown. The worst case is a stray file that only takes space, never an image whose file is missing.

### Who may do what

| | Visitor or customer | Admin | Super User |
|---|---|---|---|
| See the images of a live product | Yes | Yes | Yes |
| List a product's images, a draft's too | No | Yes | Yes |
| Upload an image, describe it, move it | No | Yes | Yes |
| Delete an image | No | **Yes** | Yes |

The staff controller is `@StaffOnly()` as a whole and has no `@SuperUserOnly()` handler. `staff/staff-routes.spec.ts` names this exception in its own test, so nobody "fixes" it by accident.

### Audit

Every change is in the audit log, in the same transaction:
- `image.created`, with the product, the key, the size, the description and the position;
- `image.updated`, with only what changed, before and after;
- `image.deleted`, with everything the image was.

A `product.deleted` entry keeps the product's images in `before.images`, next to its packs. A refused change, and a change that changes nothing, write no entry.

### The shop

| Endpoint | Shows |
|---|---|
| `GET /v1/categories/:slug/products` | Each card also has `imageUrl`: the small file of the product's main photo |
| `GET /v1/products/:slug` | The product's page also has `images`, main photo first, each with `url`, `thumbnailUrl`, `width`, `height` and `altText` |

No IDs and no keys of their own: an image is known by the addresses of its files.

### Endpoints for staff

| Endpoint | Who | Purpose |
|---|---|---|
| `GET /v1/staff/products/:productId/images` | Staff | Every image of a product, main photo first, with the addresses of its files |
| `POST /v1/staff/products/:productId/images` | Staff | Upload one image (the body is the image) |
| `PATCH /v1/staff/images/:id` | Staff | Change its description (`altText`) or its place (`position`) |
| `DELETE /v1/staff/images/:id` | Staff | Delete it, with its files |

## Alternatives considered

- **A multipart form, with `multer`.** Rejected:
  - Windows PowerShell 5.1 cannot send one easily (it has no `-Form`);
  - `multer` had a denial-of-service advisory, which an override patches (`docs/security.md`, section 5);
  - one image per request is all the admin console needs.
- **Uploading straight to object storage with a signed address.** Later, when the API is deployed. Even then, the API must check and re-encode each image before the shop shows it.
- **An object store in Docker now,** such as MinIO. Rejected for now: another service on an 8 GB laptop, before any measured need (ADR 0001). `MediaStorage` keeps the switch small.
- **Keeping the uploaded file as it is.** Rejected: it would keep the photo's GPS location, and anything else hidden in the file. It would also be as large as the photo.
- **One file per image.** Rejected: list pages would load the large file for every card.
- **Trusting the `Content-Type` or the file name.** Rejected: only the first bytes say what a file is.
- **Other formats,** such as GIF, SVG, HEIC or AVIF. Not accepted. Staff send a JPEG instead; phones and browsers usually convert a photo when sharing it.
- **Images per pack size.** Rejected by the owner: the packs of a product look alike. It can be added later, if they ever differ.
- **Images optional for a live product.** Rejected by the owner: a shop page without a photo looks broken.
- **Deleting images for Super Users only,** like every other deletion in the catalog. Rejected by the owner: an Admin replaces photos often, and the audit log records who deleted which.
- **Checking the image rules in the API only.** Rejected, as in ADR 0021: a bug or a manual SQL change could break them. Three triggers cost one migration.

## Consequences

- **Tests:**
  - 494 unit tests in 65 suites.
  - The smoke test has 71 checks. The new ones:
    - every live product's page shows at least one image, each with only its addresses, size and description;
    - each card's image is the small file of the main photo on its product's page;
    - every image file is served as WebP, and other sites may show it;
    - the image folders are never listed;
    - a customer's token cannot list, upload, change or delete images.
  - **By hand, on 2026-11-06,** with PowerShell's `-InFile`:
    - an Admin created a category and a draft, and was refused going live without an image;
    - the Admin uploaded photos and saw them upright in the browser, large and small;
    - the Admin was refused a JPEG sent as a PNG, a text file sent as a JPEG, a JSON body (`415`), and a photo of 275 × 183 pixels (too small);
    - the Admin described an image, went live, saw the images in the shop, and deleted two images;
    - the smoke test ran while the product was live, so its image checks fetched real files;
    - a Super User deleted the product: its image files were gone, and the `product.deleted` entry kept the image that was left.

    The `409` for a live product's last image was not tried by hand, because the product still had another image. The trigger, the unit tests and an HTTP test cover it.
- **New dependencies:**
  - `sharp` 0.35.5, pinned exactly. It ships ready-made builds and has no install script;
  - `express` 5.2.1 as a direct dependency, for its `raw()` parser. It is the exact version Nest already uses, so nothing new is installed.

  `pnpm audit` is unchanged.
- **This part taught two rules about migrations** (ADR 0003):
  - compare a hand-written migration's SHA-256 with the file that was tested, before applying it;
  - write an SQL test as a file, which stops at the first error until its transaction has begun. A test typed through several layers of shell quoting once lost its `BEGIN` and left three functions behind, which had to be removed.
- **Still open:**
  - object storage behind a CDN before production. `/media` is served before the rate-limit guard, which is fine on a laptop but not on the internet;
  - a cleanup of stray files left by a failed deletion;
  - descriptions in Indian languages, with the website.
