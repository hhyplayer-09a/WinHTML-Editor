
import katex from 'katex';
import { XmlComponent } from 'docx';
import { MML2OMML_XSLT } from './MML2OMML';

// Helper class to construct generic XML components for docx
// This allows us to inject the parsed OMML structure directly into the docx document tree
class GenericXmlComponent extends XmlComponent {
  constructor(tagName: string) {
    super(tagName);
  }

  // Helper to add children to the protected root array
  public addChild(child: XmlComponent | string) {
    (this as any).root.push(child);
  }

  // Helper to add attributes
  public addAttribute(key: string, value: string) {
    // In docx library, attributes are usually the first element in root if it's an object with _attr key
    // We need to check if attributes object exists
    const root = (this as any).root;
    if (root.length > 0 && root[0]._attr) {
      root[0]._attr[key] = value;
    } else {
      root.unshift({ _attr: { [key]: value } });
    }
  }
}

// Convert a DOM node (from the OMML XML) into a docx XmlComponent tree
const domToDocxComponent = (node: Node): XmlComponent | string | null => {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.nodeValue || '';
  }

  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as Element;
    // Map tag name (e.g. "m:oMath" -> "m:oMath")
    const component = new GenericXmlComponent(el.tagName);

    // Map Attributes
    for (let i = 0; i < el.attributes.length; i++) {
      const attr = el.attributes[i];
      component.addAttribute(attr.name, attr.value);
    }

    // Recursively Map Children
    for (let i = 0; i < el.childNodes.length; i++) {
      const child = domToDocxComponent(el.childNodes[i]);
      if (child !== null) {
        component.addChild(child);
      }
    }

    return component;
  }

  return null;
};

// Main function: LaTeX String -> docx XmlComponent (m:oMath)
export const latexToDocxMath = (latex: string): XmlComponent | null => {
  try {
    // 1. Convert LaTeX to MathML using KaTeX
    // We use 'mathml' output to get standard MathML
    const mathMLString = katex.renderToString(latex, {
      output: 'mathml',
      throwOnError: false,
    });

    // 2. Extract the inner <math> tag if wrapped (KaTeX often wraps in a generic span or div)
    // We need clean XML for the parser.
    const parser = new DOMParser();
    const mathMLDoc = parser.parseFromString(mathMLString, 'text/xml');
    
    // Check for parser errors
    const parserError = mathMLDoc.querySelector('parsererror');
    if (parserError) {
        // Fallback: If strict XML parsing fails (sometimes due to HTML entities), 
        // try parsing as HTML and extracting the <math> element.
        const htmlDoc = parser.parseFromString(mathMLString, 'text/html');
        const mathEl = htmlDoc.querySelector('math');
        if (!mathEl) return null;
        
        // Create a new XML doc from the clean math element
        const serializer = new XMLSerializer();
        const cleanMathML = serializer.serializeToString(mathEl);
        const retryDoc = parser.parseFromString(cleanMathML, 'text/xml');
        if (retryDoc.querySelector('parsererror')) return null;
        return transformAndBuild(retryDoc);
    }

    return transformAndBuild(mathMLDoc);

  } catch (e) {
    console.warn('Error converting LaTeX to OMML:', e);
    return null;
  }
};

const transformAndBuild = (mathMLDoc: Document): XmlComponent | null => {
    try {
        // 3. Prepare XSLT Processor
        const xsltProcessor = new XSLTProcessor();
        const xsltDoc = new DOMParser().parseFromString(MML2OMML_XSLT, 'text/xml');
        xsltProcessor.importStylesheet(xsltDoc);

        // 4. Transform MathML -> OMML
        const ommlDoc = xsltProcessor.transformToDocument(mathMLDoc);
        if (!ommlDoc) return null;

        // 5. Convert OMML DOM -> docx XmlComponent Tree
        // The root of OMML should be m:oMath
        const rootNode = ommlDoc.documentElement; // Usually <m:oMath>
        
        if (!rootNode) return null;

        // If the XSLT returns m:oMath, we return that component.
        // It will be embedded in a Paragraph in the main exporter.
        const result = domToDocxComponent(rootNode);
        
        return result instanceof XmlComponent ? result : null;
    } catch (e) {
        console.warn('XSLT Transformation failed:', e);
        return null;
    }
}
