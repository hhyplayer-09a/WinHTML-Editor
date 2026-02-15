
import { 
  Document, 
  Packer, 
  Paragraph, 
  TextRun, 
  HeadingLevel, 
  Table, 
  TableRow, 
  TableCell, 
  BorderStyle, 
  WidthType, 
  ImageRun, 
  AlignmentType, 
  UnderlineType,
  ShadingType,
  ExternalHyperlink,
  CommentRangeStart,
  CommentRangeEnd,
  CommentReference
} from 'docx';
import { Editor } from '@tiptap/react';

// --- Type Definitions for Tiptap Nodes ---
interface TiptapAttributes {
  level?: number;
  textAlign?: string;
  latex?: string;
  src?: string;
  alt?: string;
  title?: string;
  width?: string | number;
  height?: string | number;
  color?: string;
  backgroundColor?: string;
  borderColor?: string;
  href?: string;
  target?: string;
  text?: string; // For comments
  [key: string]: any;
}

interface TiptapMark {
  type: string;
  attrs?: any;
}

interface TiptapNode {
  type: string;
  content?: TiptapNode[];
  text?: string;
  attrs?: TiptapAttributes;
  marks?: TiptapMark[];
}

interface ExportContext {
  listType?: 'bullet' | 'ordered';
  listLevel?: number;
  addComment?: (text: string) => number;
}

// --- Helper Functions ---

const convertColor = (color: string | undefined): string | undefined => {
  if (!color) return undefined;
  if (color.startsWith('#')) return color.slice(1);
  return undefined; 
};

/**
 * Robust Font Size Converter
 * Converts CSS units (px, em, rem, pt, %) to DOCX half-points.
 * Word stores font size in half-points (1/144 inch).
 * 12pt = 24 half-points.
 */
const convertFontSize = (sizeStr: string | undefined): number | undefined => {
  if (!sizeStr) return undefined;

  // Extract numeric value and unit
  const match = sizeStr.toString().trim().match(/^([\d.]+)([a-z%]*)$/i);
  if (!match) return undefined;

  const val = parseFloat(match[1]);
  const unit = match[2]?.toLowerCase() || 'px'; // Default to px if unit missing

  if (isNaN(val)) return undefined;

  let halfPoints = 24; // Default fallback (12pt)

  switch (unit) {
    case 'pt':
      // 1pt = 2 half-points
      halfPoints = val * 2;
      break;
    case 'px':
      // 1px ≈ 0.75pt. So 1px ≈ 1.5 half-points.
      halfPoints = val * 1.5;
      break;
    case 'em':
    case 'rem':
      // Assume base font size is 12pt (24 half-points)
      // 1em = 12pt = 24 half-points
      halfPoints = val * 24;
      break;
    case '%':
      // Assume base 100% = 12pt (24 half-points)
      halfPoints = (val / 100) * 24;
      break;
    default:
      // Fallback for unknown units, treat roughly as px
      halfPoints = val * 1.5;
  }

  // Safety Clamp: Prevent text from being microscopic (< 5pt) or gigantic (> 100pt) unless intentional
  // 10 half-points = 5pt
  if (halfPoints < 10) return 24; // Reset to 12pt if calculated size is too small (likely parsing error)
  
  return Math.round(halfPoints);
};

// Convert Base64 Data URL to Uint8Array for docx
const base64ToUint8Array = (dataURL: string): Uint8Array | null => {
  try {
    const base64Regex = /^data:image\/(png|jpg|jpeg|gif|svg\+xml);base64,/;
    if (!base64Regex.test(dataURL)) return null;
    
    const stringBase64 = dataURL.replace(base64Regex, "");
    const binaryString = window.atob(stringBase64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  } catch (e) {
    console.warn("Failed to convert image", e);
    return null;
  }
};

const mapAlignment = (align: string | undefined) => {
  switch (align) {
    case 'center': return AlignmentType.CENTER;
    case 'right': return AlignmentType.RIGHT;
    case 'justify': return AlignmentType.JUSTIFIED;
    default: return AlignmentType.LEFT;
  }
};

// --- Recursive Node Processor ---

const processNodes = async (nodes: TiptapNode[], context: ExportContext = {}): Promise<any[]> => {
  const children: any[] = [];

  for (const node of nodes) {
    switch (node.type) {
      
      // --- Blocks ---
      
      case 'heading': {
        const level = node.attrs?.level || 1;
        const headingLevel = 
          level === 1 ? HeadingLevel.HEADING_1 :
          level === 2 ? HeadingLevel.HEADING_2 :
          level === 3 ? HeadingLevel.HEADING_3 :
          level === 4 ? HeadingLevel.HEADING_4 :
          level === 5 ? HeadingLevel.HEADING_5 :
          HeadingLevel.HEADING_6;

        children.push(new Paragraph({
          children: await processInlineNodes(node.content || [], context),
          heading: headingLevel,
          alignment: mapAlignment(node.attrs?.textAlign),
          spacing: { before: 240, after: 120 } 
        }));
        break;
      }

      case 'paragraph': {
        // Collect text runs from content
        const runs = node.content ? await processInlineNodes(node.content, context) : [];
        
        // List handling
        let numbering;
        let bullet;
        let indent;
        
        if (context.listType === 'bullet') {
             bullet = { level: context.listLevel || 0 };
        } else if (context.listType === 'ordered') {
             // For ordered lists, we map to bullets simply because managing numbering IDs dynamically 
             // without a global numbering registry in 'docx' is complex. 
             // Ideally this should use a proper numbering reference.
             bullet = { level: context.listLevel || 0 }; 
        }

        children.push(new Paragraph({
          children: runs,
          alignment: mapAlignment(node.attrs?.textAlign),
          bullet: bullet,
          indent: indent,
          spacing: { after: 120 }
        }));
        break;
      }

      case 'bulletList':
      case 'orderedList': {
        // Recurse into list items, passing down context
        const listType = node.type === 'bulletList' ? 'bullet' : 'ordered';
        const nextLevel = (context.listLevel ?? -1) + 1;
        
        if (node.content) {
          const listChildren = await processNodes(node.content, { ...context, listType, listLevel: nextLevel });
          children.push(...listChildren);
        }
        break;
      }

      case 'listItem': {
        // List Items in Tiptap are wrappers around blocks (usually paragraphs).
        if (node.content) {
           children.push(...await processNodes(node.content, context));
        }
        break;
      }

      case 'blockquote': {
        if (node.content) {
          // Blockquotes usually contain paragraphs. We process them, then check if they are Paragraphs
          // and apply specific styling (indentation + border) to simulate a blockquote.
          const bqChildren = await processNodes(node.content, context);
          
          bqChildren.forEach(child => {
            if (child instanceof Paragraph) {
              // Apply Left Indent to simulate blockquote
              // 720 twips = 0.5 inch
              (child as any).root[1] = (child as any).root[1] || {}; // properties
            }
          });
          
          // Re-create the paragraphs with indentation
          for (const subNode of node.content) {
             if (subNode.type === 'paragraph') {
               const runs = subNode.content ? await processInlineNodes(subNode.content, context) : [];
               children.push(new Paragraph({
                 children: runs,
                 indent: { left: 720 }, // Indent contents
                 border: {
                   left: { color: "CCCCCC", space: 1, style: BorderStyle.SINGLE, size: 12 }
                 },
                 spacing: { after: 120 }
               }));
             } else {
               // Fallback for non-paragraphs inside blockquote
               children.push(...await processNodes([subNode], context));
             }
          }
        }
        break;
      }

      case 'codeBlock': {
        // Code blocks are usually one big text node or lines of text
        const codeText = node.content?.map(c => c.text).join('\n') || '';
        children.push(new Paragraph({
          children: [
            new TextRun({
              text: codeText,
              font: "Consolas",
              size: 20, // 10pt
            })
          ],
          shading: { fill: "F5F5F5", type: ShadingType.CLEAR, color: "auto" },
          border: {
            top: { style: BorderStyle.SINGLE, size: 1, color: "E5E7EB" },
            bottom: { style: BorderStyle.SINGLE, size: 1, color: "E5E7EB" },
            left: { style: BorderStyle.SINGLE, size: 1, color: "E5E7EB" },
            right: { style: BorderStyle.SINGLE, size: 1, color: "E5E7EB" },
          },
          spacing: { after: 240 }
        }));
        break;
      }

      case 'horizontalRule': {
        children.push(new Paragraph({
          text: "",
          border: {
            bottom: { color: "AAAAAA", space: 1, style: BorderStyle.SINGLE, size: 6 }
          },
          spacing: { after: 240 }
        }));
        break;
      }

      case 'table': {
        if (node.content) {
          const rows = await Promise.all(node.content.map(async (row) => {
             const cells = await Promise.all((row.content || []).map(async (cell) => {
                const cellChildren = await processNodes(cell.content || [], context);
                
                // Extract background color if present (CustomTableCell)
                let cellShading = undefined;
                const bgColor = convertColor(cell.attrs?.backgroundColor);
                if (bgColor) {
                    cellShading = { fill: bgColor, type: ShadingType.CLEAR, color: "auto" };
                } else if (cell.type === 'tableHeader') {
                    cellShading = { fill: "F3F4F6", type: ShadingType.CLEAR, color: "auto" };
                }

                return new TableCell({
                  children: cellChildren,
                  shading: cellShading,
                  width: { size: 100, type: WidthType.PERCENTAGE }, // Auto width
                });
             }));
             return new TableRow({ children: cells });
          }));

          children.push(new Table({
             rows: rows,
             width: { size: 100, type: WidthType.PERCENTAGE },
             borders: {
               top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
               bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
               left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
               right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
               insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
               insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
             }
          }));
          
          children.push(new Paragraph({ text: "", spacing: { after: 120 } }));
        }
        break;
      }

      case 'textBox': {
        // Convert custom Text Box into a 1-row, 1-cell Table for DOCX compatibility
        if (node.content) {
           const cellChildren = await processNodes(node.content, context);
           
           const bgColor = convertColor(node.attrs?.backgroundColor) || "F9FAFB";
           const borderColor = convertColor(node.attrs?.borderColor) || "D1D5DB";

           children.push(new Table({
             rows: [
               new TableRow({
                 children: [
                   new TableCell({
                     children: cellChildren,
                     shading: {
                       fill: bgColor,
                       type: ShadingType.CLEAR,
                       color: "auto"
                     },
                     borders: {
                        top: { style: BorderStyle.SINGLE, size: 8, color: borderColor },
                        bottom: { style: BorderStyle.SINGLE, size: 8, color: borderColor },
                        left: { style: BorderStyle.SINGLE, size: 8, color: borderColor },
                        right: { style: BorderStyle.SINGLE, size: 8, color: borderColor },
                     },
                     width: { size: 100, type: WidthType.PERCENTAGE },
                     margins: { top: 144, bottom: 144, left: 144, right: 144 }
                   })
                 ]
               })
             ],
             width: { size: 100, type: WidthType.PERCENTAGE },
             borders: {
                top: { style: BorderStyle.NONE },
                bottom: { style: BorderStyle.NONE },
                left: { style: BorderStyle.NONE },
                right: { style: BorderStyle.NONE },
                insideVertical: { style: BorderStyle.NONE },
                insideHorizontal: { style: BorderStyle.NONE },
             }
           }));
           
           // Add a spacer after the box
           children.push(new Paragraph({ text: "", spacing: { after: 120 } }));
        }
        break;
      }
      
      case 'image': {
        const src = node.attrs?.src;
        if (src) {
           const imageBuffer = base64ToUint8Array(src);
           if (imageBuffer) {
             const width = node.attrs?.width ? parseInt(String(node.attrs.width)) : 400;
             const height = node.attrs?.height ? parseInt(String(node.attrs.height)) : 300;
             
             children.push(new Paragraph({
               children: [
                 new ImageRun({
                   data: imageBuffer,
                   transformation: { width: width, height: height },
                   type: "png" 
                 })
               ],
               alignment: AlignmentType.CENTER
             }));
           }
        }
        break;
      }

      // Handle raw text nodes that might be loose at the root (not inside a paragraph)
      case 'text': {
        if (node.text && node.text.trim()) {
           children.push(new Paragraph({
             children: [new TextRun(node.text)]
           }));
        }
        break;
      }

      // Fallback for divs or unknown blocks: treat as container
      default: {
         if (node.content) {
            children.push(...await processNodes(node.content, context));
         }
         break;
      }
    }
  }

  return children;
};

// --- Inline Node Processor ---
// Converts Tiptap text/marks to docx TextRuns or Hyperlinks
const processInlineNodes = async (nodes: TiptapNode[], context: ExportContext): Promise<(TextRun | ImageRun | ExternalHyperlink | CommentRangeStart | CommentRangeEnd | CommentReference)[]> => {
  const runs: (TextRun | ImageRun | ExternalHyperlink | CommentRangeStart | CommentRangeEnd | CommentReference)[] = [];
  
  // Track active comment to merge contiguous text runs with the same comment
  let activeCommentId: number | null = null;
  let activeCommentText: string | null = null;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    
    // Check for comments on this node
    let commentText: string | null = null;
    if (node.marks) {
        const commentMark = node.marks.find(m => m.type === 'comment');
        if (commentMark && commentMark.attrs?.text) {
            commentText = commentMark.attrs.text;
        }
    }

    // State Transition: Handle changes in comment state
    if (commentText !== activeCommentText) {
        // 1. If we were in a comment, close it
        if (activeCommentId !== null) {
            runs.push(new CommentRangeEnd(activeCommentId));
            runs.push(new CommentReference(activeCommentId));
            activeCommentId = null;
            activeCommentText = null;
        }

        // 2. If we are entering a new comment, open it
        if (commentText && context.addComment) {
            const newId = context.addComment(commentText);
            runs.push(new CommentRangeStart(newId));
            activeCommentId = newId;
            activeCommentText = commentText;
        }
    }

    if (node.type === 'text') {
       const text = node.text || '';
       let bold = false;
       let italics = false;
       let underline = undefined;
       let strike = false;
       let color = undefined;
       let highlight = undefined;
       let size = undefined;
       let font = undefined;
       let linkUrl: string | undefined = undefined;

       if (node.marks) {
         for (const mark of node.marks) {
           if (mark.type === 'bold') bold = true;
           if (mark.type === 'italic') italics = true;
           if (mark.type === 'underline') underline = { type: UnderlineType.SINGLE };
           if (mark.type === 'strike') strike = true;
           if (mark.type === 'link') {
              linkUrl = mark.attrs?.href;
           }
           if (mark.type === 'textStyle') {
              if (mark.attrs?.color) color = convertColor(mark.attrs.color);
              
              // Use Robust Font Size Converter
              if (mark.attrs?.fontSize) {
                 const docxSize = convertFontSize(mark.attrs.fontSize);
                 if (docxSize) size = docxSize;
              }
              
              if (mark.attrs?.fontFamily) {
                 font = mark.attrs.fontFamily.replace(/['"]/g, '');
              }
           }
           if (mark.type === 'highlight') {
              // Map Tiptap colors to docx highlighting names if possible, else yellow
              const c = mark.attrs?.color;
              if (c === '#a5d6a7') highlight = "green"; // rough map
              else if (c === '#80deea') highlight = "cyan";
              else if (c === '#f48fb1') highlight = "magenta";
              else highlight = "yellow"; 
           }
         }
       }

       const textRun = new TextRun({
         text: text,
         bold: bold,
         italics: italics,
         underline: underline,
         strike: strike,
         color: color,
         highlight: highlight,
         size: size,
         font: font
       });

       if (linkUrl) {
         runs.push(new ExternalHyperlink({
           children: [textRun],
           link: linkUrl
         }));
       } else {
         runs.push(textRun);
       }
    } 
    else if (node.type === 'math') {
       // Handle Math as LaTeX text for now
       runs.push(new TextRun({
         text: ` ${node.attrs?.latex || ''} `,
         italics: true,
         color: "3B82F6", 
         font: "Courier New"
       }));
    }
    // Hard break
    else if (node.type === 'hardBreak') {
        runs.push(new TextRun({ break: 1 }));
    }
  }

  // Final Cleanup: If we end the block with an active comment, close it
  if (activeCommentId !== null) {
      runs.push(new CommentRangeEnd(activeCommentId));
      runs.push(new CommentReference(activeCommentId));
  }

  return runs;
};

// --- Main Export Function ---

export const exportToDocx = async (editor: Editor, fileName: string) => {
  const json = editor.getJSON();
  
  if (!json.content) return;

  // Comment System Setup
  const comments: any[] = [];
  let commentIdCounter = 0;

  const addComment = (text: string): number => {
      const id = commentIdCounter++;
      comments.push({
          id: id,
          author: "Author",
          date: new Date(),
          children: [
              new Paragraph({
                  children: [new TextRun(text)]
              })
          ]
      });
      return id;
  };

  // Recursively process the JSON document into docx objects
  const children = await processNodes(json.content, { addComment });

  const doc = new Document({
    comments: {
        children: comments
    },
    sections: [{
      properties: {},
      children: children
    }]
  });

  const blob = await Packer.toBlob(doc);
  
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = fileName.endsWith('.docx') ? fileName : `${fileName}.docx`;
  link.click();
  URL.revokeObjectURL(link.href);
};
