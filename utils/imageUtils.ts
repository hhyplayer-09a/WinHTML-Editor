

export interface Asset {
  fileName: string;
  data: Blob;
}

export interface ImageMap {
  [src: string]: string; // Maps blob/data URL -> new relative filename (e.g. image_1.png)
}

export interface PreparedDoc {
  html: string;
  assets: Asset[];
  imageMap: ImageMap;
}

/**
 * Converts a Base64 string to a Blob
 */
export const base64ToBlob = (base64: string, mimeType: string): Blob => {
  // Sanitize base64 string (remove whitespace/newlines)
  const cleanBase64 = base64.replace(/\s/g, '');
  
  const byteCharacters = atob(cleanBase64);
  const byteArrays = [];

  for (let offset = 0; offset < byteCharacters.length; offset += 512) {
    const slice = byteCharacters.slice(offset, offset + 512);
    const byteNumbers = new Array(slice.length);
    for (let i = 0; i < slice.length; i++) {
      byteNumbers[i] = slice.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    byteArrays.push(byteArray);
  }

  return new Blob(byteArrays, { type: mimeType });
};

/**
 * Converts a Blob to Base64 string
 */
export const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      if (!result) {
        reject(new Error("Empty result from FileReader"));
        return;
      }
      // Remove data URL prefix (e.g. "data:image/png;base64,")
      const parts = result.split(',');
      const base64 = parts.length > 1 ? parts[1] : result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

/**
 * LOAD TIME:
 * Scans HTML string for data:image Base64 URIs.
 * Converts them to Blob URLs (blob:http://...) for performance.
 */
export const convertHtmlBase64ToBlobUrls = async (html: string): Promise<string> => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const images = doc.querySelectorAll('img');
  
  // We use a counter to avoid race conditions or just simple iteration
  for (const img of Array.from(images)) {
    const src = img.getAttribute('src');
    if (src && src.startsWith('data:image')) {
       try {
         // Parse Mime and Data
         const parts = src.split(',');
         // Handle case where split might not work as expected
         if (parts.length >= 2) {
             const header = parts[0];
             const base64Data = parts.slice(1).join(','); // Rejoin in case of extra commas? unlikely for base64
             
             const mimeMatch = header.match(/:(.*?);/);
             const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
             
             if (base64Data) {
                const blob = base64ToBlob(base64Data, mimeType);
                const blobUrl = URL.createObjectURL(blob);
                img.setAttribute('src', blobUrl);
             }
         }
       } catch (e) {
         console.error("Failed to convert base64 image to blob url", e);
       }
    }
  }

  return doc.body.innerHTML;
};

/**
 * EXPORT TIME:
 * Converts all blob: images in the HTML string to Base64 data: URIs.
 * This ensures the HTML is self-contained for backend rendering.
 */
export const inlineImagesForExport = async (html: string): Promise<string> => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const images = doc.querySelectorAll('img');

  for (const img of Array.from(images)) {
    const src = img.getAttribute('src');
    if (src && src.startsWith('blob:')) {
      try {
        const response = await fetch(src);
        const blob = await response.blob();
        const base64Data = await blobToBase64(blob);
        
        let mimeType = blob.type || 'image/png';
        // Construct full Data URI
        const dataUri = `data:${mimeType};base64,${base64Data}`;
        
        img.setAttribute('src', dataUri);
      } catch (e) {
        console.error("Failed to inline image for export", e);
      }
    }
  }
  return doc.body.innerHTML;
};

/**
 * SAVE TIME:
 * Scans HTML for blob: URIs.
 * Fetches the blob data.
 * Generates a numbered filename (image_N.ext) to prevent duplicates.
 * Replaces src with relative path.
 * Returns new HTML, list of assets (as Blobs), and a map of blob->filename for editor update.
 */
export const prepareHtmlForSave = async (htmlContent: string, docName: string): Promise<PreparedDoc> => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlContent, 'text/html');
  const images = doc.querySelectorAll('img');
  const assets: Asset[] = [];
  const imageMap: ImageMap = {};

  // 1. Scan for existing "image_N" filenames to determine the next index
  let maxIndex = 0;
  // Improved regex to handle paths (./image_1.png or image_1.png)
  const nameRegex = /(?:^|[/\\])image_(\d+)\./i;

  // Check data-original-src attributes which hold the truth about file identity
  images.forEach(img => {
    const original = img.getAttribute('data-original-src');
    if (original) {
      const match = original.match(nameRegex);
      if (match) {
        const idx = parseInt(match[1], 10);
        if (idx > maxIndex) maxIndex = idx;
      }
    } else {
      // Also check standard src if it happens to be a relative path
      const src = img.getAttribute('src');
      if (src && !src.startsWith('data:') && !src.startsWith('blob:') && !src.startsWith('http')) {
         const match = src.match(nameRegex);
         if (match) {
           const idx = parseInt(match[1], 10);
           if (idx > maxIndex) maxIndex = idx;
         }
      }
    }
  });

  for (const img of Array.from(images)) {
    const src = img.getAttribute('src');
    
    if (src && (src.startsWith('blob:') || src.startsWith('data:image'))) {
      try {
        let blob: Blob;
        let ext = 'png';

        // Fetch data based on type
        if (src.startsWith('blob:')) {
            const response = await fetch(src);
            blob = await response.blob();
            
            if (blob.type === 'image/jpeg') ext = 'jpg';
            else if (blob.type === 'image/gif') ext = 'gif';
            else if (blob.type === 'image/svg+xml') ext = 'svg';
            else if (blob.type === 'image/webp') ext = 'webp';
        } else {
            // data:image...
            const parts = src.split(',');
            const header = parts[0];
            const base64Data = parts.slice(1).join(',');
            
            const mimeMatch = header.match(/:(.*?);/);
            const mime = mimeMatch ? mimeMatch[1] : 'image/png';
            if (mime.includes('jpeg')) ext = 'jpg';
            else if (mime.includes('gif')) ext = 'gif';
            else if (mime.includes('svg')) ext = 'svg';
            else if (mime.includes('webp')) ext = 'webp';
            
            blob = base64ToBlob(base64Data, mime);
        }

        // Check if we have the original filename preserved
        const originalSrc = img.getAttribute('data-original-src');
        let fileName = '';

        if (originalSrc) {
           // Case A: Existing image
           // Extract filename from potential path
           fileName = originalSrc.split(/[/\\]/).pop() || '';
           
           // Basic validation to ensure we extracted something
           if (fileName.length < 3) fileName = ''; 
        }

        if (!fileName) {
            // Case B: New Image -> Generate Numbered Name
            maxIndex++;
            fileName = `image_${maxIndex}.${ext}`;
            
            // Record this new mapping so we can update the editor state later
            imageMap[src] = fileName;
        }
        
        assets.push({
          fileName: fileName,
          data: blob
        });

        // Update HTML to relative path
        img.setAttribute('src', `./${fileName}`);
        img.setAttribute('data-original-src', fileName);
        
      } catch (e) {
        console.error("Failed to process image for save", e);
      }
    }
  }

  return {
    html: doc.body.innerHTML,
    assets: assets,
    imageMap: imageMap
  };
};