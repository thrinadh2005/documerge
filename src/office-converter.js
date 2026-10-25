import mammoth from 'mammoth';
import JSZip from 'jszip';
import html2canvas from 'html2canvas';
import { PDFDocument } from 'pdf-lib';

/**
 * Helper to create a hidden rendering container in the DOM
 */
function createSandbox() {
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.top = '-99999px';
  container.style.left = '-99999px';
  container.style.width = '800px';
  container.style.zIndex = '-1000';
  container.style.visibility = 'hidden';
  container.style.pointerEvents = 'none';
  document.body.appendChild(container);
  return container;
}

/**
 * Convert DOCX ArrayBuffer to PDF bytes
 */
export async function convertDocxToPdf(file, onProgress) {
  onProgress?.({ percent: 15, message: 'Reading DOCX document structure...' });
  const arrayBuffer = await file.arrayBuffer();

  // Convert docx to HTML using Mammoth
  onProgress?.({ percent: 35, message: 'Extracting text, tables, and images...' });
  const result = await mammoth.convertToHtml({ arrayBuffer });
  const htmlContent = result.value;

  // Create paginated containers
  const sandbox = createSandbox();

  // Outer document wrapper styled like a Word document
  const docWrapper = document.createElement('div');
  docWrapper.className = 'docx-render-wrapper';
  docWrapper.innerHTML = `
    <style>
      .docx-render-wrapper {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        color: #111827;
        background: #ffffff;
        line-height: 1.6;
      }
      .docx-page {
        width: 794px; /* A4 width at 96 DPI */
        min-height: 1123px; /* A4 height at 96 DPI */
        padding: 56px 64px;
        box-sizing: border-box;
        background: #ffffff;
        page-break-after: always;
        overflow: hidden;
      }
      .docx-page h1 { font-size: 24px; color: #1e293b; margin-top: 0; margin-bottom: 16px; border-bottom: 2px solid #31372b; padding-bottom: 8px; }
      .docx-page h2 { font-size: 19px; color: #334155; margin-top: 20px; margin-bottom: 12px; }
      .docx-page h3 { font-size: 16px; color: #475569; margin-top: 16px; margin-bottom: 8px; }
      .docx-page p { margin-bottom: 12px; font-size: 13.5px; line-height: 1.65; color: #1e293b; }
      .docx-page ul, .docx-page ol { margin-bottom: 14px; padding-left: 24px; font-size: 13.5px; }
      .docx-page li { margin-bottom: 6px; }
      .docx-page table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 12.5px; }
      .docx-page table, .docx-page th, .docx-page td { border: 1px solid #cbd5e1; }
      .docx-page th, .docx-page td { padding: 8px 12px; text-align: left; }
      .docx-page th { background-color: #f1f5f9; font-weight: 600; }
      .docx-page img { max-width: 100%; height: auto; margin: 12px 0; border-radius: 4px; }
      .docx-page blockquote { border-left: 3px solid #31372b; margin: 14px 0; padding-left: 16px; color: #4b5563; font-style: italic; }
    </style>
    <div class="docx-page" id="docxPageContent">${htmlContent || '<p>Empty Document</p>'}</div>
  `;
  sandbox.appendChild(docWrapper);

  onProgress?.({ percent: 55, message: 'Rendering pages to canvas...' });

  // A4 dimensions in PDF points (72 points per inch)
  const a4WidthPt = 595.28;
  const a4HeightPt = 841.89;

  const pdfDoc = await PDFDocument.create();

  // If content is very tall, paginate logically
  const contentEl = docWrapper.querySelector('.docx-page');
  const totalHeight = contentEl.scrollHeight;
  const pageHeightPx = 1123;
  const numPages = Math.max(1, Math.ceil(totalHeight / pageHeightPx));

  for (let pageIdx = 0; pageIdx < numPages; pageIdx++) {
    onProgress?.({
      percent: Math.round(55 + (pageIdx / numPages) * 35),
      message: `Rendering DOCX page ${pageIdx + 1} of ${numPages}...`
    });

    // Render slice via html2canvas
    const canvas = await html2canvas(contentEl, {
      scale: 1.5,
      useCORS: true,
      logging: false,
      y: pageIdx * pageHeightPx,
      height: Math.min(pageHeightPx, totalHeight - pageIdx * pageHeightPx),
      windowWidth: 794
    });

    const imgDataUrl = canvas.toDataURL('image/jpeg', 0.92);
    const imgBytes = await fetch(imgDataUrl).then(res => res.arrayBuffer());
    const embeddedImg = await pdfDoc.embedJpg(imgBytes);

    const pdfPage = pdfDoc.addPage([a4WidthPt, a4HeightPt]);
    
    // Scale image cleanly onto A4 page
    const imgAspect = embeddedImg.width / embeddedImg.height;
    let renderWidth = a4WidthPt;
    let renderHeight = renderWidth / imgAspect;

    if (renderHeight > a4HeightPt) {
      renderHeight = a4HeightPt;
      renderWidth = renderHeight * imgAspect;
    }

    const posX = (a4WidthPt - renderWidth) / 2;
    const posY = a4HeightPt - renderHeight;

    pdfPage.drawImage(embeddedImg, {
      x: posX,
      y: posY,
      width: renderWidth,
      height: renderHeight
    });
  }

  // Clean up DOM sandbox
  sandbox.remove();

  onProgress?.({ percent: 95, message: 'Finalizing PDF output...' });
  return await pdfDoc.save();
}

/**
 * Extract slide text, images, and layout from PPTX ZIP
 */
async function parsePptxSlides(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const slides = [];

  // Find all slide XML files in ppt/slides/
  const slideFileNames = Object.keys(zip.files).filter(name => 
    /^ppt\/slides\/slide[0-9]+\.xml$/.test(name)
  );

  // Sort naturally by slide number: slide1.xml, slide2.xml, ...
  slideFileNames.sort((a, b) => {
    const numA = parseInt(a.match(/slide([0-9]+)\.xml/)[1], 10);
    const numB = parseInt(b.match(/slide([0-9]+)\.xml/)[1], 10);
    return numA - numB;
  });

  const parser = new DOMParser();

  for (let i = 0; i < slideFileNames.length; i++) {
    const slidePath = slideFileNames[i];
    const slideNumber = i + 1;
    const xmlText = await zip.files[slidePath].async('string');
    const xmlDoc = parser.parseFromString(xmlText, 'application/xml');

    // Extract text blocks
    const paragraphs = xmlDoc.getElementsByTagName('a:p');
    let title = '';
    const bodyItems = [];

    for (let p of paragraphs) {
      const textRuns = p.getElementsByTagName('a:t');
      let pText = '';
      for (let t of textRuns) {
        pText += t.textContent;
      }
      pText = pText.trim();
      if (!pText) continue;

      if (!title) {
        title = pText;
      } else {
        bodyItems.push(pText);
      }
    }

    // Extract images related to this slide
    const images = [];
    const relsPath = `ppt/slides/_rels/slide${slideNumber}.xml.rels`;
    if (zip.files[relsPath]) {
      const relsXml = await zip.files[relsPath].async('string');
      const relsDoc = parser.parseFromString(relsXml, 'application/xml');
      const relElements = relsDoc.getElementsByTagName('Relationship');

      for (let rel of relElements) {
        const type = rel.getAttribute('Type') || '';
        const target = rel.getAttribute('Target') || '';
        if (type.includes('image')) {
          // Resolve target path (usually ../media/image1.png -> ppt/media/image1.png)
          const cleanTarget = target.replace(/^\.\.\//, 'ppt/');
          if (zip.files[cleanTarget]) {
            const imgData = await zip.files[cleanTarget].async('base64');
            const ext = cleanTarget.split('.').pop().toLowerCase();
            const mime = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
            images.push(`data:${mime};base64,${imgData}`);
          }
        }
      }
    }

    slides.push({
      slideNumber,
      title: title || `Slide ${slideNumber}`,
      bodyItems,
      images
    });
  }

  return slides;
}

/**
 * Convert PPTX presentation to PDF bytes
 */
export async function convertPptxToPdf(file, onProgress) {
  onProgress?.({ percent: 15, message: 'Opening presentation package...' });
  const arrayBuffer = await file.arrayBuffer();

  onProgress?.({ percent: 35, message: 'Parsing presentation slides & graphics...' });
  const slides = await parsePptxSlides(arrayBuffer);

  if (slides.length === 0) {
    throw new Error('No slides could be extracted from this PowerPoint presentation.');
  }

  const sandbox = createSandbox();
  const pdfDoc = await PDFDocument.create();

  // Widescreen 16:9 PDF landscape dimensions (points)
  const slideWidthPt = 842;
  const slideHeightPt = 473.6;

  for (let idx = 0; idx < slides.length; idx++) {
    const slide = slides[idx];
    const pct = Math.round(40 + (idx / slides.length) * 50);
    onProgress?.({
      percent: pct,
      message: `Rendering Slide ${slide.slideNumber} of ${slides.length}: "${slide.title.substring(0, 24)}..."`
    });

    // Create styled slide element (16:9 aspect ratio, 960 x 540 px)
    const slideEl = document.createElement('div');
    slideEl.className = 'pptx-slide-canvas';
    slideEl.style.width = '960px';
    slideEl.style.height = '540px';
    slideEl.style.backgroundColor = '#FAF7EE'; // Floral White background!
    slideEl.style.color = '#31372B'; // Black Olive text!
    slideEl.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    slideEl.style.padding = '40px 50px';
    slideEl.style.boxSizing = 'border-box';
    slideEl.style.display = 'flex';
    slideEl.style.flexDirection = 'column';
    slideEl.style.justifyContent = 'space-between';
    slideEl.style.position = 'relative';
    slideEl.style.border = '2px solid #31372B';

    // Slide header
    const headerHtml = `
      <div style="border-bottom: 2px solid #31372B; padding-bottom: 12px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: baseline;">
        <h2 style="font-size: 28px; margin: 0; color: #31372B; font-weight: 700; max-width: 80%;">${slide.title}</h2>
        <span style="font-size: 14px; font-weight: 600; color: #7E8C73;">SLIDE ${slide.slideNumber}</span>
      </div>
    `;

    // Slide body
    const hasImages = slide.images.length > 0;
    let bodyContentHtml = '<div style="flex: 1; display: flex; gap: 30px; overflow: hidden;">';

    // Text column
    bodyContentHtml += `<div style="flex: ${hasImages ? '1.2' : '1'}; display: flex; flex-direction: column; gap: 12px;">`;
    if (slide.bodyItems.length > 0) {
      bodyContentHtml += '<ul style="margin: 0; padding-left: 20px; font-size: 17px; line-height: 1.6; color: #31372B;">';
      slide.bodyItems.slice(0, 7).forEach(item => {
        bodyContentHtml += `<li style="margin-bottom: 10px;">${item}</li>`;
      });
      bodyContentHtml += '</ul>';
    } else {
      bodyContentHtml += `<p style="font-size: 18px; color: #57614D; font-style: italic;">Slide Overview</p>`;
    }
    bodyContentHtml += '</div>';

    // Image column (if present)
    if (hasImages) {
      bodyContentHtml += `<div style="flex: 1; display: flex; align-items: center; justify-content: center; max-height: 320px; overflow: hidden; border-radius: 8px; border: 1px solid rgba(49, 55, 43, 0.2); background: #ffffff; padding: 10px;">`;
      bodyContentHtml += `<img src="${slide.images[0]}" style="max-width: 100%; max-height: 300px; object-fit: contain; border-radius: 6px;" />`;
      bodyContentHtml += '</div>';
    }

    bodyContentHtml += '</div>';

    // Slide footer
    const footerHtml = `
      <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #7E8C73; border-top: 1px solid rgba(49, 55, 43, 0.2); padding-top: 10px; margin-top: 16px;">
        <span>DocuMerge Presentation Converter</span>
        <span>Slide ${slide.slideNumber} of ${slides.length}</span>
      </div>
    `;

    slideEl.innerHTML = headerHtml + bodyContentHtml + footerHtml;
    sandbox.appendChild(slideEl);

    // Render to canvas
    const canvas = await html2canvas(slideEl, {
      scale: 1.5,
      useCORS: true,
      logging: false
    });

    slideEl.remove();

    const imgDataUrl = canvas.toDataURL('image/jpeg', 0.92);
    const imgBytes = await fetch(imgDataUrl).then(res => res.arrayBuffer());
    const embeddedImg = await pdfDoc.embedJpg(imgBytes);

    const pdfPage = pdfDoc.addPage([slideWidthPt, slideHeightPt]);
    pdfPage.drawImage(embeddedImg, {
      x: 0,
      y: 0,
      width: slideWidthPt,
      height: slideHeightPt
    });
  }

  sandbox.remove();
  onProgress?.({ percent: 95, message: 'Compiling presentation PDF...' });
  return await pdfDoc.save();
}
