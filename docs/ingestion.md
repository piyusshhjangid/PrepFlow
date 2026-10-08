# Document ingestion

```
PDF   -> size/type/magic-byte checks -> extractor list (pdfjs text layer) -> per-page normalize
      -> quality checks (usable text? limits?) -> hash -> persist
TEXT  -> normalize -> quality checks -> hash -> persist
```

Nothing here calls an AI model. Uploaded files are processed in memory and never stored.

## Data model

`StudyMaterial.extractedText` holds the normalized text. For PDFs the pages are joined with a form feed
(U+000C); for pasted text there is a single segment. **Only `domain/documents/pages.ts` knows this layout.**
Everything else uses `NormalizedPage { number: number | null; text: string }`.

- `number` is the 1-based _physical_ PDF page, shown as "PDF page n". It can differ from the number printed on
  the page. Pasted text has `number = null` and is labelled "Detected in uploaded material".
- Empty pages stay as empty strings so numbering never shifts.
- `pageCount`, `lowTextPageCount` and `charCount` are stored alongside the text.

## Contract for AI analysis (implemented in Checkpoint C)

1. The chunker splits on page boundaries; code assigns every chunk `{ chunkId, pageStart, pageEnd }`.
2. The model may return a topic, a verbatim snippet and a `chunkId`. It never returns page numbers.
3. Code verifies the snippet really occurs in that chunk, then derives the page(s) itself. A snippet that is not
   found is dropped, and the topic is marked INFERRED.
4. Matching must tolerate extraction artifacts (see below) without changing the stored text.

## Known extraction limits

- **End-of-line hyphenation is preserved** (`"ac-\ntual"`). Stored text is not rewritten, because joining
  hyphenated lines is ambiguous (`trace-\nbased` vs `ac-\ntual`). The evidence matcher in Checkpoint C should
  compare using a match key that ignores hyphen + line break.
- **Text inside charts and figures** can come out as garbage when the PDF uses custom font encodings. The topic
  review screen is the safeguard.
- **Multi-column layouts** follow the PDF's content order, which can interleave columns.
- **Scanned/image-only PDFs have no text layer** and are rejected with `PDF_NO_TEXT`. There is no OCR.
- **Repeated headers/footers** stay in the text as noise.
- pdfjs parses on the main thread: about 0.3 s for a 1 MB, 14-page PDF once warm (about 1.4 s for the first
  request after start). The size and page limits bound this.
