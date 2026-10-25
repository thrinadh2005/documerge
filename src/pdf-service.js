import { PDFDocument, rgb, degrees, StandardFonts } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { convertDocxToPdf, convertPptxToPdf } from './office-converter.js';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

/**
 * Helper to convert file to ArrayBuffer
 */
export async function fileToArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Format bytes into human readable format
 */
export function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Render a single page thumbnail using PDF.js and canvas
 */
export async function renderPageThumbnail(pdfBytes, pageNumber = 1, maxWidth = 240) {
  try {
    // Clone buffer to prevent Web Worker detachment
    const rawBuffer = pdfBytes instanceof ArrayBuffer ? pdfBytes : pdfBytes.buffer;
    const clonedData = new Uint8Array(rawBuffer.slice(0));

    const loadingTask = pdfjsLib.getDocument({
      data: clonedData,
      isEvalSupported: false,
      useSystemFonts: true
    });
    const pdfDoc = await loadingTask.promise;
    if (pageNumber > pdfDoc.numPages) pageNumber = 1;
    const page = await pdfDoc.getPage(pageNumber);

    const viewport = page.getViewport({ scale: 1 });
    const scale = Math.min(maxWidth / viewport.width, 1.5);
    const scaledViewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = scaledViewport.width;
    canvas.height = scaledViewport.height;

    const ctx = canvas.getContext('2d', { alpha: false });
    await page.render({
      canvasContext: ctx,
      viewport: scaledViewport
    }).promise;

    return canvas.toDataURL('image/jpeg', 0.85);
  } catch (err) {
    console.warn('Thumbnail generation fallback:', err);
    return null;
  }
}

/**
 * Convert any image file (JPG, PNG, WEBP, GIF) to a PDF ArrayBuffer
 */
export async function convertImageToPdf(imageFile) {
  const imgUrl = URL.createObjectURL(imageFile);
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = imgUrl;
  });

  // Calculate dimensions (Standard A4 is 595.28 x 841.89 points)
  const a4Width = 595.28;
  const a4Height = 841.89;
  
  const isLandscape = img.naturalWidth > img.naturalHeight;
  const pageWidth = isLandscape ? a4Height : a4Width;
  const pageHeight = isLandscape ? a4Width : a4Height;

  // Render image to canvas to get pure JPEG data
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  
  const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.92);
  const jpegBytes = await fetch(jpegDataUrl).then(res => res.arrayBuffer());

  // Create PDF
  const pdfDoc = await PDFDocument.create();
  const embeddedImg = await pdfDoc.embedJpg(jpegBytes);
  const page = pdfDoc.addPage([pageWidth, pageHeight]);

  // Maintain aspect ratio with clean 32pt margins
  const margin = 32;
  const availableWidth = pageWidth - (margin * 2);
  const availableHeight = pageHeight - (margin * 2);

  const imgRatio = embeddedImg.width / embeddedImg.height;
  let renderWidth = availableWidth;
  let renderHeight = renderWidth / imgRatio;

  if (renderHeight > availableHeight) {
    renderHeight = availableHeight;
    renderWidth = renderHeight * imgRatio;
  }

  const posX = margin + (availableWidth - renderWidth) / 2;
  const posY = margin + (availableHeight - renderHeight) / 2;

  page.drawImage(embeddedImg, {
    x: posX,
    y: posY,
    width: renderWidth,
    height: renderHeight
  });

  URL.revokeObjectURL(imgUrl);
  return await pdfDoc.save();
}

/**
 * Inspect a file and return parsed document metadata
 */
export async function parseDocumentFile(file, onProgress) {
  const nameLower = file.name.toLowerCase();
  const isPdf = file.type === 'application/pdf' || nameLower.endsWith('.pdf');
  const isDocx = nameLower.endsWith('.docx') || file.type.includes('wordprocessingml');
  const isPptx = nameLower.endsWith('.pptx') || nameLower.endsWith('.ppt') || file.type.includes('presentationml');
  const isImage = file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp)$/i.test(nameLower);

  if (!isPdf && !isDocx && !isPptx && !isImage) {
    throw new Error(`Unsupported file type: ${file.name}. Please upload PDF, Word (.docx), PowerPoint (.pptx), or image files.`);
  }

  let pdfBytes;
  let originalSize = file.size;
  let pageCount = 1;
  let formatType = 'PDF';

  if (isDocx) {
    formatType = 'DOCX';
    onProgress?.({ message: `Converting Word document "${file.name}" to PDF...` });
    pdfBytes = await convertDocxToPdf(file, onProgress);
    const pdfDoc = await PDFDocument.load(pdfBytes.slice(0), { ignoreEncryption: true });
    pageCount = pdfDoc.getPageCount();
  } else if (isPptx) {
    formatType = 'PPTX';
    onProgress?.({ message: `Converting PowerPoint slides "${file.name}" to PDF...` });
    pdfBytes = await convertPptxToPdf(file, onProgress);
    const pdfDoc = await PDFDocument.load(pdfBytes.slice(0), { ignoreEncryption: true });
    pageCount = pdfDoc.getPageCount();
  } else if (isImage) {
    formatType = 'IMG';
    pdfBytes = await convertImageToPdf(file);
    pageCount = 1;
  } else {
    formatType = 'PDF';
    pdfBytes = await fileToArrayBuffer(file);
    const rawBuffer = pdfBytes instanceof ArrayBuffer ? pdfBytes : pdfBytes.buffer;
    const pdfDoc = await PDFDocument.load(rawBuffer.slice(0), { ignoreEncryption: true });
    pageCount = pdfDoc.getPageCount();
  }

  // Generate thumbnail for the first page
  const thumbnail = await renderPageThumbnail(pdfBytes, 1, 300);

  // Generate page items
  const pages = [];
  for (let i = 0; i < pageCount; i++) {
    pages.push({
      pageIndex: i, // 0-based
      pageNumber: i + 1, // 1-based display
      rotation: 0, // 0, 90, 180, 270
      included: true,
      thumbnail: i === 0 ? thumbnail : null // Lazy render other page thumbnails on grid view
    });
  }

  return {
    id: 'doc_' + Math.random().toString(36).substring(2, 11),
    name: file.name,
    size: originalSize,
    formatType,
    isImage,
    isDocx,
    isPptx,
    pdfBytes,
    pageCount,
    thumbnail,
    pages,
    pageRangeInput: 'all',
    docRotation: 0 // 0, 90, 180, 270
  };
}

/**
 * Parse page range string (e.g. "1-3, 5, 8") to zero-based array of page indices
 */
export function parsePageRange(rangeStr, totalPages) {
  if (!rangeStr || rangeStr.trim().toLowerCase() === 'all') {
    return Array.from({ length: totalPages }, (_, i) => i);
  }

  const indices = new Set();
  const parts = rangeStr.split(',');

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    if (trimmed.includes('-')) {
      const [startStr, endStr] = trimmed.split('-');
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (!isNaN(start) && !isNaN(end)) {
        const from = Math.max(1, Math.min(start, end));
        const to = Math.min(totalPages, Math.max(start, end));
        for (let p = from; p <= to; p++) {
          indices.add(p - 1);
        }
      }
    } else {
      const pageNum = parseInt(trimmed, 10);
      if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) {
        indices.add(pageNum - 1);
      }
    }
  }

  const result = Array.from(indices).sort((a, b) => a - b);
  return result.length > 0 ? result : Array.from({ length: totalPages }, (_, i) => i);
}

/**
 * Merge multiple documents into a single PDF
 */
/**
 * Apply Page Numbers and Watermark
 */
async function applyPdfDecorations(mergedPdf, options = {}) {
  const total = mergedPdf.getPageCount();
  if (total === 0) return;

  // Watermark
  if (options.watermarkText && options.watermarkText.trim()) {
    const font = await mergedPdf.embedFont(StandardFonts.HelveticaBold);
    const text = options.watermarkText.trim().toUpperCase();
    for (let i = 0; i < total; i++) {
      const page = mergedPdf.getPage(i);
      const { width, height } = page.getSize();
      const textSize = Math.min(width, height) * 0.07;
      const textWidth = font.widthOfTextAtSize(text, textSize);
      page.drawText(text, {
        x: (width - textWidth) / 2,
        y: height / 2 - 20,
        size: textSize,
        font,
        color: rgb(49 / 255, 55 / 255, 43 / 255), // Black Olive
        opacity: 0.16,
        rotate: degrees(45)
      });
    }
  }

  // Page Numbers
  if (options.addPageNumbers) {
    const font = await mergedPdf.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < total; i++) {
      const page = mergedPdf.getPage(i);
      const { width } = page.getSize();
      const text = `Page ${i + 1} of ${total}`;
      const textSize = 10;
      const textWidth = font.widthOfTextAtSize(text, textSize);
      page.drawText(text, {
        x: (width - textWidth) / 2,
        y: 22,
        size: textSize,
        font,
        color: rgb(75 / 255, 85 / 255, 70 / 255)
      });
    }
  }
}

/**
 * Merge multiple documents into a single PDF
 */
export async function mergeDocuments(documents, options = {}, onProgress) {
  if (typeof options === 'function') {
    onProgress = options;
    options = {};
  }

  if (!documents || documents.length === 0) {
    throw new Error('No documents to merge.');
  }

  onProgress?.({ step: 'init', percent: 5, message: 'Initializing PDF merger engine...' });
  const mergedPdf = await PDFDocument.create();

  const totalDocs = documents.length;
  let totalProcessedPages = 0;

  for (let docIdx = 0; docIdx < totalDocs; docIdx++) {
    const doc = documents[docIdx];
    const progressPercent = Math.round(10 + (docIdx / totalDocs) * 70);
    onProgress?.({
      step: 'processing',
      percent: progressPercent,
      message: `Processing "${doc.name}" (${docIdx + 1} of ${totalDocs})...`
    });

    const rawBuffer = doc.pdfBytes instanceof ArrayBuffer ? doc.pdfBytes : (doc.pdfBytes.buffer ? doc.pdfBytes.buffer : doc.pdfBytes);
    const sourcePdf = await PDFDocument.load(rawBuffer.slice(0), { ignoreEncryption: true });
    const targetIndices = parsePageRange(doc.pageRangeInput, doc.pageCount);

    if (targetIndices.length === 0) continue;

    const copiedPages = await mergedPdf.copyPages(sourcePdf, targetIndices);

    for (let i = 0; i < copiedPages.length; i++) {
      const page = copiedPages[i];
      const pageIndex = targetIndices[i];
      const pageMeta = doc.pages[pageIndex];

      // Calculate total rotation
      const extraRotation = ((doc.docRotation || 0) + (pageMeta ? pageMeta.rotation || 0 : 0)) % 360;
      if (extraRotation !== 0) {
        const currentAngle = page.getRotation().angle;
        page.setRotation(degrees((currentAngle + extraRotation) % 360));
      }

      mergedPdf.addPage(page);
      totalProcessedPages++;
    }
  }

  if (totalProcessedPages === 0) {
    throw new Error('No pages were selected to merge. Please check your page ranges.');
  }

  onProgress?.({ step: 'decorating', percent: 85, message: 'Applying headers, footers & decorations...' });
  await applyPdfDecorations(mergedPdf, options);

  onProgress?.({ step: 'compiling', percent: 92, message: 'Compiling final merged document...' });
  const mergedBytes = await mergedPdf.save({ useObjectStreams: true });
  onProgress?.({ step: 'complete', percent: 100, message: 'Done!' });

  return {
    pdfBytes: mergedBytes,
    totalPages: totalProcessedPages,
    size: mergedBytes.length
  };
}

/**
 * Merge from flat page organizer grid
 */
export async function mergePagesGrid(flatPages, options = {}, onProgress) {
  if (typeof options === 'function') {
    onProgress = options;
    options = {};
  }

  if (!flatPages || flatPages.length === 0) {
    throw new Error('No pages selected.');
  }

  onProgress?.({ step: 'init', percent: 10, message: 'Assembling pages in custom order...' });
  const mergedPdf = await PDFDocument.create();

  // Cache loaded source documents to avoid repeated decoding
  const sourceDocCache = new Map();

  const totalPages = flatPages.length;
  for (let i = 0; i < totalPages; i++) {
    const item = flatPages[i];
    const percent = Math.round(15 + (i / totalPages) * 65);
    onProgress?.({
      step: 'copying',
      percent,
      message: `Assembling page ${i + 1} of ${totalPages}...`
    });

    let sourcePdf = sourceDocCache.get(item.docId);
    if (!sourcePdf) {
      const rawBuffer = item.docPdfBytes instanceof ArrayBuffer ? item.docPdfBytes : (item.docPdfBytes.buffer ? item.docPdfBytes.buffer : item.docPdfBytes);
      sourcePdf = await PDFDocument.load(rawBuffer.slice(0), { ignoreEncryption: true });
      sourceDocCache.set(item.docId, sourcePdf);
    }

    const [copiedPage] = await mergedPdf.copyPages(sourcePdf, [item.pageIndex]);

    const totalRotation = (item.rotation || 0) % 360;
    if (totalRotation !== 0) {
      const currentAngle = copiedPage.getRotation().angle;
      copiedPage.setRotation(degrees((currentAngle + totalRotation) % 360));
    }

    mergedPdf.addPage(copiedPage);
  }

  onProgress?.({ step: 'decorating', percent: 85, message: 'Applying page numbers & watermarks...' });
  await applyPdfDecorations(mergedPdf, options);

  onProgress?.({ step: 'saving', percent: 92, message: 'Finalizing document structure...' });
  const mergedBytes = await mergedPdf.save({ useObjectStreams: true });
  onProgress?.({ step: 'complete', percent: 100, message: 'Ready!' });

  return {
    pdfBytes: mergedBytes,
    totalPages,
    size: mergedBytes.length
  };
}

/**
 * Generate 2 beautiful sample PDFs with Floral White & Black Olive theme
 * so the user can test the app instantly!
 */
export async function generateSampleDocuments() {
  // Sample 1: Project Proposal (2 pages)
  const doc1 = await PDFDocument.create();
  const fontHelveticaBold = await doc1.embedFont(StandardFonts.HelveticaBold);
  const fontHelvetica = await doc1.embedFont(StandardFonts.Helvetica);

  // Page 1
  const page1 = doc1.addPage([595.28, 841.89]);
  // Black Olive header block
  page1.drawRectangle({
    x: 0,
    y: 720,
    width: 595.28,
    height: 121.89,
    color: rgb(49 / 255, 55 / 255, 43 / 255) // #31372B Black Olive
  });
  // Floral White Header Title
  page1.drawText('PROJECT PROPOSAL', {
    x: 48,
    y: 770,
    size: 26,
    font: fontHelveticaBold,
    color: rgb(250 / 255, 247 / 255, 238 / 255) // #FAF7EE
  });
  page1.drawText('DocuMerge Studio - Offline Document Processing', {
    x: 48,
    y: 745,
    size: 13,
    font: fontHelvetica,
    color: rgb(220 / 255, 215 / 255, 200 / 255)
  });

  // Body content
  page1.drawText('1. Executive Overview', {
    x: 48,
    y: 660,
    size: 18,
    font: fontHelveticaBold,
    color: rgb(49 / 255, 55 / 255, 43 / 255)
  });
  page1.drawText('This proposal outlines the deployment of a 100% offline document merger.', {
    x: 48,
    y: 630,
    size: 12,
    font: fontHelvetica,
    color: rgb(70 / 255, 75 / 255, 65 / 255)
  });
  page1.drawText('Operating entirely in client browser memory guarantees zero privacy breaches.', {
    x: 48,
    y: 610,
    size: 12,
    font: fontHelvetica,
    color: rgb(70 / 255, 75 / 255, 65 / 255)
  });

  // Accent card box
  page1.drawRectangle({
    x: 48,
    y: 460,
    width: 499.28,
    height: 120,
    color: rgb(245 / 255, 242 / 255, 232 / 255),
    borderColor: rgb(49 / 255, 55 / 255, 43 / 255),
    borderWidth: 1.5
  });
  page1.drawText('KEY HIGHLIGHTS', {
    x: 68,
    y: 550,
    size: 12,
    font: fontHelveticaBold,
    color: rgb(49 / 255, 55 / 255, 43 / 255)
  });
  page1.drawText('- Zero Cloud Dependence: Instant merge speeds without internet.', {
    x: 68,
    y: 525,
    size: 11,
    font: fontHelvetica,
    color: rgb(50 / 255, 55 / 255, 45 / 255)
  });
  page1.drawText('- Mobile & Desktop Optimized: Intuitive touch & drag interfaces.', {
    x: 68,
    y: 505,
    size: 11,
    font: fontHelvetica,
    color: rgb(50 / 255, 55 / 255, 45 / 255)
  });
  page1.drawText('- Visual Page Sorting: Reorganize, rotate, or omit pages seamlessly.', {
    x: 68,
    y: 485,
    size: 11,
    font: fontHelvetica,
    color: rgb(50 / 255, 55 / 255, 45 / 255)
  });

  // Page 2
  const page2 = doc1.addPage([595.28, 841.89]);
  page2.drawText('2. Technical Specifications & PWA Capabilities', {
    x: 48,
    y: 770,
    size: 18,
    font: fontHelveticaBold,
    color: rgb(49 / 255, 55 / 255, 43 / 255)
  });
  page2.drawText('DocuMerge registers an advanced Service Worker for full offline caching.', {
    x: 48,
    y: 735,
    size: 12,
    font: fontHelvetica,
    color: rgb(70 / 255, 75 / 255, 65 / 255)
  });
  page2.drawText('Can be installed directly onto home screens on iOS, Android, and Desktop.', {
    x: 48,
    y: 715,
    size: 12,
    font: fontHelvetica,
    color: rgb(70 / 255, 75 / 255, 65 / 255)
  });

  const pdf1Bytes = await doc1.save();

  // Sample 2: Financial Annexure & Signoff (1 page)
  const doc2 = await PDFDocument.create();
  const pAnnex = doc2.addPage([595.28, 841.89]);
  
  // Olive top accent stripe
  pAnnex.drawRectangle({
    x: 0,
    y: 825,
    width: 595.28,
    height: 16.89,
    color: rgb(49 / 255, 55 / 255, 43 / 255)
  });

  pAnnex.drawText('ANNEXURE A: SIGN-OFF & APPROVAL', {
    x: 48,
    y: 770,
    size: 22,
    font: fontHelveticaBold,
    color: rgb(49 / 255, 55 / 255, 43 / 255)
  });
  pAnnex.drawText('Document Verification & Delivery Confirmation', {
    x: 48,
    y: 745,
    size: 12,
    font: fontHelvetica,
    color: rgb(110 / 255, 120 / 255, 100 / 255)
  });

  // Table header
  pAnnex.drawRectangle({
    x: 48,
    y: 670,
    width: 499.28,
    height: 36,
    color: rgb(49 / 255, 55 / 255, 43 / 255)
  });
  pAnnex.drawText('Milestone Item', {
    x: 64,
    y: 683,
    size: 12,
    font: fontHelveticaBold,
    color: rgb(250 / 255, 247 / 255, 238 / 255)
  });
  pAnnex.drawText('Status', {
    x: 340,
    y: 683,
    size: 12,
    font: fontHelveticaBold,
    color: rgb(250 / 255, 247 / 255, 238 / 255)
  });
  pAnnex.drawText('Security', {
    x: 450,
    y: 683,
    size: 12,
    font: fontHelveticaBold,
    color: rgb(250 / 255, 247 / 255, 238 / 255)
  });

  // Row 1
  pAnnex.drawRectangle({
    x: 48,
    y: 630,
    width: 499.28,
    height: 40,
    color: rgb(250 / 255, 247 / 255, 238 / 255),
    borderColor: rgb(215 / 255, 210 / 255, 195 / 255),
    borderWidth: 1
  });
  pAnnex.drawText('Offline PDF Core Engine', {
    x: 64,
    y: 645,
    size: 11,
    font: fontHelvetica,
    color: rgb(49 / 255, 55 / 255, 43 / 255)
  });
  pAnnex.drawText('PASSED (100%)', {
    x: 340,
    y: 645,
    size: 11,
    font: fontHelveticaBold,
    color: rgb(40 / 255, 110 / 255, 45 / 255)
  });
  pAnnex.drawText('Air-gapped', {
    x: 450,
    y: 645,
    size: 11,
    font: fontHelvetica,
    color: rgb(70 / 255, 75 / 255, 65 / 255)
  });

  // Row 2
  pAnnex.drawRectangle({
    x: 48,
    y: 590,
    width: 499.28,
    height: 40,
    color: rgb(245 / 255, 242 / 255, 232 / 255),
    borderColor: rgb(215 / 255, 210 / 255, 195 / 255),
    borderWidth: 1
  });
  pAnnex.drawText('Progressive Web App Manifest', {
    x: 64,
    y: 605,
    size: 11,
    font: fontHelvetica,
    color: rgb(49 / 255, 55 / 255, 43 / 255)
  });
  pAnnex.drawText('INSTALLED', {
    x: 340,
    y: 605,
    size: 11,
    font: fontHelveticaBold,
    color: rgb(40 / 255, 110 / 255, 45 / 255)
  });
  pAnnex.drawText('Self-contained', {
    x: 450,
    y: 605,
    size: 11,
    font: fontHelvetica,
    color: rgb(70 / 255, 75 / 255, 65 / 255)
  });

  // Signature line
  pAnnex.drawText('Authorized Signature: __________________________    Date: 2026-10-24', {
    x: 48,
    y: 420,
    size: 12,
    font: fontHelvetica,
    color: rgb(49 / 255, 55 / 255, 43 / 255)
  });

  const pdf2Bytes = await doc2.save();

  // Sample 3: Presentation Slide (16:9 Landscape)
  const doc3 = await PDFDocument.create();
  const slidePage = doc3.addPage([842, 473.6]);
  
  // Slide background in Floral White
  slidePage.drawRectangle({
    x: 0,
    y: 0,
    width: 842,
    height: 473.6,
    color: rgb(250 / 255, 247 / 255, 238 / 255)
  });
  
  // Olive top accent header
  slidePage.drawRectangle({
    x: 0,
    y: 400,
    width: 842,
    height: 73.6,
    color: rgb(49 / 255, 55 / 255, 43 / 255)
  });
  
  slidePage.drawText('KEYNOTE: PPTX & DOCX OFFLINE ECOSYSTEM', {
    x: 48,
    y: 434,
    size: 18,
    font: fontHelveticaBold,
    color: rgb(250 / 255, 247 / 255, 238 / 255)
  });
  slidePage.drawText('Slide Deck Presentation Export (16:9 Widescreen)', {
    x: 48,
    y: 414,
    size: 11,
    font: fontHelvetica,
    color: rgb(215 / 255, 225 / 255, 205 / 255)
  });

  // Slide Body items
  slidePage.drawText('• Cross-Format Integration: Merge PDF + Word (.docx) + PPT (.pptx) + Images', {
    x: 60,
    y: 330,
    size: 14,
    font: fontHelveticaBold,
    color: rgb(49 / 255, 55 / 255, 43 / 255)
  });
  slidePage.drawText('• Client-Side Processing: Zero server latency and enterprise-grade privacy', {
    x: 60,
    y: 290,
    size: 14,
    font: fontHelvetica,
    color: rgb(65 / 255, 75 / 255, 60 / 255)
  });
  slidePage.drawText('• Mobile & Desktop Responsive: Touch controls, page reordering & rotation', {
    x: 60,
    y: 250,
    size: 14,
    font: fontHelvetica,
    color: rgb(65 / 255, 75 / 255, 60 / 255)
  });

  // Slide visual stat box
  slidePage.drawRectangle({
    x: 60,
    y: 110,
    width: 722,
    height: 90,
    color: rgb(240 / 255, 235 / 255, 222 / 255),
    borderColor: rgb(49 / 255, 55 / 255, 43 / 255),
    borderWidth: 1.5
  });
  slidePage.drawText('STATUS: PPTX & DOCX COMPATIBILITY ACTIVE', {
    x: 84,
    y: 155,
    size: 13,
    font: fontHelveticaBold,
    color: rgb(49 / 255, 55 / 255, 43 / 255)
  });
  slidePage.drawText('Converted offline via local DOM parser and canvas into vector-grade PDF pages.', {
    x: 84,
    y: 132,
    size: 11,
    font: fontHelvetica,
    color: rgb(85 / 255, 95 / 255, 80 / 255)
  });

  const pdf3Bytes = await doc3.save();

  return [
    {
      name: '01_Project_Proposal.pdf',
      bytes: pdf1Bytes,
      size: pdf1Bytes.length
    },
    {
      name: '02_Annexure_Signoff.docx',
      bytes: pdf2Bytes,
      size: pdf2Bytes.length
    },
    {
      name: '03_Keynote_Deck.pptx',
      bytes: pdf3Bytes,
      size: pdf3Bytes.length
    }
  ];
}
