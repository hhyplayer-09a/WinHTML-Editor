
import { marked } from 'marked';

// Helper to load PDF.js via script tag injection
// This avoids Vite trying to bundle /libs/pdf.js which causes build errors
const loadPdfJs = (): Promise<any> => {
  return new Promise((resolve, reject) => {
    if ((window as any).pdfjsLib) {
      resolve((window as any).pdfjsLib);
      return;
    }

    const script = document.createElement('script');
    script.src = '/libs/pdf.js';
    script.onload = () => {
      if ((window as any).pdfjsLib) {
        resolve((window as any).pdfjsLib);
      } else {
        reject(new Error("PDF.js script loaded but window.pdfjsLib is undefined."));
      }
    };
    script.onerror = () => reject(new Error("Failed to load PDF.js script from /libs/pdf.js"));
    document.head.appendChild(script);
  });
};

// Common function to initialize PDF.js library
const initPdfJs = async () => {
  const libObj = await loadPdfJs();
  
  if (!libObj) {
    throw new Error("PDF Library could not be loaded.");
  }

  const getDocument = libObj.getDocument;
  const GlobalWorkerOptions = libObj.GlobalWorkerOptions;

  if (!getDocument) {
     throw new Error("PDF.js module loaded but getDocument not found.");
  }

  // Set Worker Path
  if (GlobalWorkerOptions && !GlobalWorkerOptions.workerSrc) {
     GlobalWorkerOptions.workerSrc = `/libs/pdf.worker.js`;
  }

  return { getDocument, libObj };
};

// 2. Mammoth Configuration
declare global {
  interface Window {
    mammoth?: {
      convertToHtml: (
        input: { arrayBuffer: ArrayBuffer },
        options?: any
      ) => Promise<{ value: string; messages: any[] }>;
    };
    pdfjsLib?: any; 
  }
}

// --- Configure marked for Math Support ---
marked.use({
  extensions: [{
    name: 'math',
    level: 'inline',
    start(src) { return src.match(/\$/)?.index; },
    tokenizer(src, tokens) {
      // Block math $$...$$
      const blockRule = /^\$\$([\s\S]*?)\$\$/;
      const blockMatch = blockRule.exec(src);
      if (blockMatch) {
        return {
          type: 'math',
          raw: blockMatch[0],
          latex: blockMatch[1].trim(),
          display: true
        };
      }
      
      // Inline math $...$
      const inlineRule = /^\$([^\$\n]+)\$/;
      const inlineMatch = inlineRule.exec(src);
      if (inlineMatch) {
        return {
          type: 'math',
          raw: inlineMatch[0],
          latex: inlineMatch[1].trim(),
          display: false
        };
      }
    },
    renderer(token) {
      return `<span data-type="math" data-latex="${token.latex}"></span>`;
    }
  }]
});

export interface ProcessedFile {
  bodyHTML: string;
  styles: string;
  name: string;
}

export const convertMarkdownToHtml = (markdown: string): string => {
  try {
    return marked.parse(markdown) as string;
  } catch (e) {
    console.error("Markdown conversion failed", e);
    return "<p>Error converting Markdown content.</p>";
  }
};

/**
 * Helper: Process a cluster of items into a coherent line string
 */
const processVisualLine = (line: any, pageWidth: number) => {
    // 1. Sort items by X to read left-to-right
    line.items.sort((a: any, b: any) => a.x - b.x);

    // 2. Concatenate text with intelligent spacing
    let text = "";
    let lastXEnd = -1;

    for (const item of line.items) {
        if (lastXEnd !== -1) {
            const gap = item.x - lastXEnd;
            if (gap > (item.h * 0.2)) {
                text += " ";
            }
        }
        text += item.str;
        lastXEnd = item.x + item.w;
    }

    const xStart = line.items[0].x;
    const xEnd = lastXEnd;
    const width = xEnd - xStart;

    // 3. Detect Centering
    const lineMid = xStart + width / 2;
    const pageMid = pageWidth / 2;
    const diff = Math.abs(lineMid - pageMid);
    
    const isCentered = diff < (pageWidth * 0.05) && width < (pageWidth * 0.9);

    return {
        y: line.y,
        h: line.h,
        text: text.trim(),
        isCentered,
        xStart,
        xEnd
    };
};

/**
 * Advanced Heuristic PDF Conversion (Local)
 */
const convertPdfToHtmlLocal = async (pdf: any, pdfjsLib: any, onProgress?: (current: number, total: number) => void): Promise<string> => {
    let html = '';

    for (let i = 1; i <= pdf.numPages; i++) {
        if (onProgress) onProgress(i, pdf.numPages);
        
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const viewport = page.getViewport({ scale: 1.0 });
        const pageWidth = viewport.width;

        // --- 1. Extract and Normalize Items ---
        let items = textContent.items.map((item: any) => {
            const tx = item.transform;
            const x = tx[4];
            const y = viewport.height - tx[5]; 
            
            return {
                str: item.str,
                x: x,
                y: y,
                w: item.width,
                h: item.height || 10,
                hasEOL: item.hasEOL
            };
        });

        // --- 2. Sort Items ---
        items.sort((a: any, b: any) => {
            if (Math.abs(a.y - b.y) < Math.min(a.h, b.h) * 0.5) {
                return a.x - b.x;
            }
            return a.y - b.y;
        });

        // --- 3. Cluster into Visual Lines ---
        const lines: any[] = [];
        let currentLine: any = null;

        for (const item of items) {
             if (item.str.trim().length === 0 && item.w === 0) continue;

             if (!currentLine) {
                 currentLine = { y: item.y, h: item.h, items: [item] };
                 continue;
             }
             
             const verticalDiff = Math.abs(item.y - currentLine.y);
             if (verticalDiff < Math.max(item.h, currentLine.h) * 0.6) {
                 currentLine.items.push(item);
                 currentLine.h = Math.max(currentLine.h, item.h);
             } else {
                 lines.push(processVisualLine(currentLine, pageWidth));
                 currentLine = { y: item.y, h: item.h, items: [item] };
             }
        }
        if (currentLine) lines.push(processVisualLine(currentLine, pageWidth));

        // --- 4. Calculate Statistics ---
        const heights = lines.map(l => l.h).sort((a,b) => a-b);
        const medianH = heights.length > 0 ? heights[Math.floor(heights.length / 2)] : 12;

        // --- 5. Construct HTML Blocks ---
        let pageHtml = `<div class="pdf-page" style="margin-bottom: 2rem; padding-bottom: 2rem; border-bottom: 1px dashed #e5e7eb;">`;
        
        let currentBlock = {
            lines: [] as any[],
            tag: 'p',
            align: 'left'
        };

        const flushBlock = () => {
            if (currentBlock.lines.length === 0) return;
            
            const textContent = currentBlock.lines.map(l => l.text).join(' ');
            if (!textContent.trim()) return;

            const safeText = textContent
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;");
            
            const alignStyle = currentBlock.align === 'center' ? 'text-align: center;' : '';
            pageHtml += `<${currentBlock.tag} style="${alignStyle}">${safeText}</${currentBlock.tag}>`;
            currentBlock = { lines: [], tag: 'p', align: 'left' };
        };

        for (let idx = 0; idx < lines.length; idx++) {
            const line = lines[idx];
            let tag = 'p';
            if (line.h > medianH * 2.0) tag = 'h1';
            else if (line.h > medianH * 1.5) tag = 'h2';
            else if (line.h > medianH * 1.25) tag = 'h3';
            else if (line.h > medianH * 1.1) tag = 'h4';
            const align = line.isCentered ? 'center' : 'left';

            let shouldMerge = false;
            if (currentBlock.lines.length > 0) {
                const prevLine = currentBlock.lines[currentBlock.lines.length - 1];
                const dy = line.y - prevLine.y;
                const isClose = dy < (line.h * 1.8); 
                
                if (currentBlock.tag === tag && currentBlock.align === align && isClose) {
                     shouldMerge = true;
                }
            }

            if (shouldMerge) {
                currentBlock.lines.push(line);
            } else {
                flushBlock();
                currentBlock.lines = [line];
                currentBlock.tag = tag;
                currentBlock.align = align;
            }
        }
        flushBlock();
        pageHtml += '</div>';
        html += pageHtml;
    }
    return html;
};

const convertPdfToHtml = async (file: File, onProgress?: (current: number, total: number) => void): Promise<string> => {
  try {
    const { getDocument, libObj } = await initPdfJs();
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await getDocument(arrayBuffer).promise;
    return await convertPdfToHtmlLocal(pdf, libObj, onProgress);
  } catch (e) {
    console.error("PDF conversion failed", e);
    return `<p>Error converting PDF file: ${(e as Error).message}.</p>`;
  }
};

/**
 * Renders each page of a PDF file as a PNG Blob.
 * Used for AI-based OCR/Transcription.
 */
export const convertPdfToImages = async (file: File, onProgress?: (current: number, total: number) => void): Promise<Blob[]> => {
  try {
    const { getDocument } = await initPdfJs();
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await getDocument(arrayBuffer).promise;
    const blobs: Blob[] = [];

    for (let i = 1; i <= pdf.numPages; i++) {
        if (onProgress) onProgress(i, pdf.numPages);
        
        const page = await pdf.getPage(i);
        // Scale 2.0 provides better quality for OCR/Vision models
        const viewport = page.getViewport({ scale: 2.0 });
        
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({
            canvasContext: context,
            viewport: viewport
        }).promise;

        // Convert canvas to blob
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
        if (blob) {
            blobs.push(blob);
        }
    }
    return blobs;
  } catch (e) {
    console.error("PDF to Image conversion failed", e);
    throw new Error(`PDF to Image conversion failed: ${(e as Error).message}`);
  }
}

const convertDocxToHtml = async (file: File): Promise<string> => {
  // Use the browser-loaded window.mammoth instance
  if (!window.mammoth) {
    return "<p>Error: Mammoth Library (DOCX) not loaded.</p>";
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    
    // Enhanced Style Map to improve Word feature recognition
    const styleMap = [
        "p[style-name='Heading 1'] => h1:fresh",
        "p[style-name='Heading 2'] => h2:fresh",
        "p[style-name='Heading 3'] => h3:fresh",
        "p[style-name='Heading 4'] => h4:fresh",
        "p[style-name='Heading 5'] => h5:fresh",
        "p[style-name='Heading 6'] => h6:fresh",
        "p[style-name='Title'] => h1:fresh",
        "p[style-name='Subtitle'] => h2:fresh",
        "p[style-name='Quote'] => blockquote:fresh",
        "p[style-name='Intense Quote'] => blockquote:fresh",
        "b => strong",
        "i => em",
        "u => u",
        "strike => s",
        "highlight => mark",
        "p[style-name='Text Box'] => div.docx-textbox:fresh",
        "p[style-name='Textbox'] => div.docx-textbox:fresh",
        "p[style-name='Box'] => div.docx-textbox:fresh",
        "p[style-name='Sidebar'] => aside.docx-sidebar:fresh"
    ];

    const result = await window.mammoth.convertToHtml(
      { arrayBuffer: arrayBuffer },
      { 
        ignoreEmptyParagraphs: false,
        styleMap: styleMap,
        includeDefaultStyleMap: true
      }
    );
    
    let html = result.value;
    html = html.replace(/<img[^>]*>/gi, "");
    return html;
  } catch (e) {
    console.error("Word conversion failed", e);
    return "<p>Error converting Word file.</p>";
  }
};

export const processLoadedFile = async (
  file: File, 
  onProgress?: (current: number, total: number) => void
): Promise<ProcessedFile> => {
  const extension = file.name.split('.').pop()?.toLowerCase();
  
  let bodyHTML = "";
  let styles = "";

  // 1. Markdown and Text Files
  if (extension === 'md' || extension === 'markdown' || extension === 'txt') {
    const content = await file.text();
    bodyHTML = convertMarkdownToHtml(content);
  }
  // 2. PDF Files
  else if (extension === 'pdf') {
    bodyHTML = await convertPdfToHtml(file, onProgress);
  }
  // 3. Word Files (DOCX - XML based)
  else if (extension === 'docx') {
    bodyHTML = await convertDocxToHtml(file);
  }
  // 4. HTML Files (Default)
  else {
    const content = await file.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'text/html');

    styles = Array.from(doc.querySelectorAll('style'))
      .map(style => style.innerHTML)
      .join('\n');
    
    bodyHTML = doc.body.innerHTML;

    // Auto-Convert legacy \( ... \) to Math Nodes if present in HTML
    bodyHTML = bodyHTML.replace(/\\\([\s\S]*?\\\)/g, (match) => {
      const formula = match.slice(2, -2);
      const span = document.createElement('span');
      span.setAttribute('data-type', 'math');
      span.setAttribute('data-latex', formula); 
      return span.outerHTML;
    });
  }

  if (extension === 'docx') {
     styles += `
       .docx-textbox {
          border: 1px solid #d1d5db;
          background-color: #f9fafb;
          padding: 1rem;
          margin: 1rem 0;
          border-radius: 0.5rem;
          box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
       }
       .docx-sidebar {
          border-left: 4px solid #3b82f6;
          background-color: #eff6ff;
          padding: 1rem;
          margin: 1rem 0;
          font-style: italic;
       }
     `;
  }
  
  return {
    bodyHTML,
    styles,
    name: file.name
  };
};
