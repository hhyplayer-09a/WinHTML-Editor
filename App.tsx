import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useEditor, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import { TextStyle } from '@tiptap/extension-text-style';
import FontFamily from '@tiptap/extension-font-family';
import CharacterCount from '@tiptap/extension-character-count';
import { Color } from '@tiptap/extension-color';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TextAlign from '@tiptap/extension-text-align';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import Image from '@tiptap/extension-image';
import { Extension, Mark, Node, mergeAttributes } from '@tiptap/core';
import katex from 'katex';
import TurndownService from 'turndown';
// @ts-ignore
import { gfm } from 'turndown-plugin-gfm';

import { Toolbar } from './components/Toolbar';
import { EditorComponent } from './components/Editor';
import { Toast, ToastType } from './components/Toast';
import { HIGHLIGHT_COLORS, ExportType, FileSource, AiSettings, AiProvider } from './types';
import { ColorUtils } from './utils/ColorUtils';
import { processLoadedFile, convertMarkdownToHtml, convertPdfToImages } from './utils/convert';
import { exportToDocx } from './utils/docxExport';
import { convertHtmlBase64ToBlobUrls, prepareHtmlForSave, base64ToBlob, inlineImagesForExport } from './utils/imageUtils';
import { transcribeImage } from './utils/ai';
import { createPortal } from 'react-dom';
import { Settings, Sparkles, ChevronDown, Check, Server, Globe, Monitor, Cpu } from 'lucide-react';

// --- Global Type Declarations ---
declare global {
  interface Window {
    launchQueue?: {
      setConsumer(consumer: (launchParams: { files: readonly any[] }) => void): void;
    };
    htmlDocx?: {
      asBlob: (html: string) => Blob;
    };
    queryLocalFonts?: () => Promise<any[]>;
    katex?: any; // Allow global access for PDF export iframe
  }
}

// --- Custom Extensions ---

// Extended Image to support data-original-src
const CustomImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      'data-original-src': {
        default: null,
        parseHTML: element => element.getAttribute('data-original-src'),
        renderHTML: attributes => {
          if (!attributes['data-original-src']) {
            return {}
          }
          return {
            'data-original-src': attributes['data-original-src'],
          }
        },
      },
    }
  }
});

// 1. Math/KaTeX Extension
const MathComponent = ({ node, updateAttributes, selected }: any) => {
  const [latex, setLatex] = useState(node.attrs.latex);

  useEffect(() => {
    setLatex(node.attrs.latex);
  }, [node.attrs.latex]);

  const renderedLatex = React.useMemo(() => {
    try {
      return katex.renderToString(latex, { throwOnError: false });
    } catch (e) {
      return latex;
    }
  }, [latex]);

  const handleClick = () => {
     const newLatex = prompt("Edit Formula:", latex);
     if (newLatex !== null) {
        updateAttributes({ latex: newLatex });
     }
  };

  return (
    <NodeViewWrapper className={`math-node ${selected ? 'ProseMirror-selectednode' : ''}`} as="span">
      <span 
        dangerouslySetInnerHTML={{ __html: renderedLatex }} 
        title="Click to edit formula"
        onClick={handleClick}
      />
    </NodeViewWrapper>
  );
};

const MathExtension = Node.create({
  name: 'math',
  group: 'inline',
  inline: true,
  atom: true, 

  addAttributes() {
    return {
      latex: {
        default: 'E=mc^2',
        parseHTML: element => element.getAttribute('data-latex'),
        renderHTML: attributes => {
          return {
            'data-latex': attributes.latex,
            'data-type': 'math'
          }
        },
      },
    }
  },

  parseHTML() {
    return [
      { tag: 'span[data-type="math"]' },
      { tag: 'span[data-latex]' }
    ]
  },

  renderHTML({ HTMLAttributes }) {
    // FIX: Include the latex formula as text content. 
    // This ensures that 'turndown' (Markdown exporter) does not treat the span as empty and strip it.
    return ['span', mergeAttributes(HTMLAttributes), HTMLAttributes['data-latex'] || '']
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathComponent);
  },
});

// 2. Comment Extension
const Comment = Mark.create({
  name: 'comment',
  addOptions() { return { HTMLAttributes: {} } },
  addAttributes() {
    return {
      text: {
        default: null,
        parseHTML: element => element.getAttribute('data-comment'),
        renderHTML: attributes => {
          if (!attributes.text) return {}
          return {
            'data-comment': attributes.text,
            'title': attributes.text,
            'class': 'annotation-mark',
          }
        },
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-comment]', priority: 51 }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0]
  },
});

// 3. TextBox Extension (Custom Styled Div)
const TextBox = Node.create({
  name: 'textBox',
  group: 'block',
  content: 'block+', 
  defining: true,

  addAttributes() {
    return {
      backgroundColor: {
        default: '#f9fafb',
        parseHTML: element => element.style.backgroundColor,
      },
      borderColor: {
        default: '#d1d5db',
        parseHTML: element => element.style.borderColor,
      }
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div.winhtml-textbox',
        priority: 51, // Higher priority than generic div
      }
    ]
  },

  renderHTML({ HTMLAttributes }) {
    const styles = [];
    if (HTMLAttributes.backgroundColor) styles.push(`background-color: ${HTMLAttributes.backgroundColor}`);
    if (HTMLAttributes.borderColor) styles.push(`border-color: ${HTMLAttributes.borderColor}`);
    
    return ['div', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { 
      class: 'winhtml-textbox',
      style: styles.join('; ')
    }), 0]
  }
});

// 4. Generic Div Support
const Div = Node.create({
  name: 'div',
  group: 'block',
  content: 'block+', 
  addOptions() { return { HTMLAttributes: {} } },
  addAttributes() {
    return {
      class: {
        default: null,
        parseHTML: element => element.getAttribute('class'),
        renderHTML: attributes => {
          if (!attributes.class) return {}
          return { class: attributes.class }
        },
      },
      style: {
        default: null,
        parseHTML: element => element.getAttribute('style'),
        renderHTML: attributes => {
          if (!attributes.style) return {}
          return { style: attributes.style }
        },
      },
    }
  },
  parseHTML() { return [{ tag: 'div' }] },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0]
  },
});

// 5. Legacy Font Support
const CustomTextStyle = TextStyle.extend({
  parseHTML() {
    return [
      {
        tag: 'span',
        getAttrs: (element) => {
          if (element.hasAttribute('style')) return {}; 
          return false;
        },
      },
      { tag: 'font' },
    ];
  },
});

// 6. Class Attribute Preservation
const ClassAttribute = Extension.create({
  name: 'classAttribute',
  addGlobalAttributes() {
    return [
      {
        types: ['heading', 'paragraph', 'textStyle', 'listItem', 'orderedList', 'bulletList', 'table', 'tableRow', 'tableHeader', 'tableCell', 'div', 'textBox'],
        attributes: {
          class: {
            default: null,
            parseHTML: element => element.getAttribute('class'),
            renderHTML: attributes => {
              if (!attributes.class) return {}
              return { class: attributes.class }
            },
          },
        },
      },
    ]
  },
});

// 7. Legacy Color Support
const CustomColor = Color.extend({
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          color: {
            default: null,
            parseHTML: (element) => {
              const styleColor = element.style.color?.replace(/['"]+/g, '');
              if (styleColor) return styleColor;
              if (element.hasAttribute('color')) return element.getAttribute('color');
              return null;
            },
            renderHTML: (attributes) => {
              if (!attributes.color) return {};
              return { style: `color: ${attributes.color}` };
            },
          },
        },
      },
    ];
  },
});

// 8. Improved Font Size Support
const LEGACY_SIZE_MAPPING: Record<string, string> = {
  '1': '10px', '2': '13px', '3': '16px', '4': '18px', '5': '24px', '6': '32px', '7': '48px'
};

const FontSize = Extension.create({
  name: 'fontSize',
  addOptions() { return { types: ['textStyle'] }; },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => {
              const styleSize = element.style.fontSize;
              if (styleSize) return styleSize.replace(/['"]+/g, '');
              if (element.hasAttribute('size')) {
                const val = element.getAttribute('size');
                if (val && LEGACY_SIZE_MAPPING[val]) return LEGACY_SIZE_MAPPING[val];
              } 
              return null;
            },
            renderHTML: (attributes) => {
              if (!attributes.fontSize) return {};
              return { style: `font-size: ${attributes.fontSize}` };
            },
          },
        },
      },
    ];
  },
});

// 9. Custom Table Header & Cell to preserve background colors
const CustomTableHeader = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      backgroundColor: {
        default: null,
        parseHTML: element => element.style.backgroundColor || element.getAttribute('bgcolor'),
        renderHTML: attributes => {
          if (!attributes.backgroundColor) return {}
          return {
            style: `background-color: ${attributes.backgroundColor}`,
          }
        },
      },
    }
  },
});

const CustomTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      backgroundColor: {
        default: null,
        parseHTML: element => element.style.backgroundColor || element.getAttribute('bgcolor'),
        renderHTML: attributes => {
          if (!attributes.backgroundColor) return {}
          return {
            style: `background-color: ${attributes.backgroundColor}`,
          }
        },
      },
    }
  },
});

// 10. Table Shortcuts: Ctrl+Enter (or Cmd+Enter) to add row
const TableShortcuts = Extension.create({
  name: 'tableShortcuts',
  addKeyboardShortcuts() {
    return {
      'Mod-Enter': () => {
        // If the cursor is inside a table, add a row after the current one
        if (this.editor.isActive('table')) {
          return (this.editor.commands as any).addRowAfter();
        }
        return false;
      },
    };
  },
});

// Helper to convert ArrayBuffer to Base64
const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

// --- AI Modal Component ---
const PROVIDERS: { id: AiProvider; name: string; icon: any; defaultBaseUrl: string; defaultModel: string }[] = [
  { id: 'zhipu', name: 'Zhipu AI (GLM)', icon: Sparkles, defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', defaultModel: 'glm-4.6v-flash' },
  { id: 'openai', name: 'OpenAI', icon: Globe, defaultBaseUrl: 'https://api.openai.com/v1/chat/completions', defaultModel: 'gpt-4o' },
  { id: 'ollama', name: 'Ollama (Local)', icon: Server, defaultBaseUrl: 'http://localhost:11434/v1/chat/completions', defaultModel: 'llava:latest' },
  { id: 'lmstudio', name: 'LM Studio (Local)', icon: Monitor, defaultBaseUrl: 'http://localhost:1234/v1/chat/completions', defaultModel: 'vision-model' },
  { id: 'custom', name: 'Custom / Other', icon: Cpu, defaultBaseUrl: '', defaultModel: '' },
];

const AIModal = ({ 
  isOpen, 
  onClose, 
  onImport, 
  settings, 
  setSettings, 
  isDarkMode 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  onImport: () => void; 
  settings: AiSettings;
  setSettings: (s: AiSettings) => void;
  isDarkMode: boolean;
}) => {
  const [showDropdown, setShowDropdown] = useState(false);

  const handleProviderChange = (provider: AiProvider) => {
    // 1. Try to load saved profile for the target provider from localStorage
    const savedProfileKey = `winhtml_ai_profile_${provider}`;
    const savedProfileStr = localStorage.getItem(savedProfileKey);

    if (savedProfileStr) {
      try {
        const parsed = JSON.parse(savedProfileStr);
        setSettings({
          provider,
          apiKey: parsed.apiKey || '',
          baseUrl: parsed.baseUrl || '',
          model: parsed.model || ''
        });
        setShowDropdown(false);
        return;
      } catch (e) {
        console.warn("Failed to parse saved profile", e);
      }
    }

    // 2. If no saved profile, load defaults from PROVIDERS list
    const config = PROVIDERS.find(p => p.id === provider);
    if (config) {
      setSettings({
        provider,
        baseUrl: config.defaultBaseUrl,
        model: config.defaultModel,
        apiKey: '' // Reset API key when switching to a new provider to avoid leaking keys
      });
    }
    setShowDropdown(false);
  };

  if (!isOpen) return null;

  const currentProvider = PROVIDERS.find(p => p.id === settings.provider) || PROVIDERS[0];
  const Icon = currentProvider.icon;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className={`p-6 rounded-xl shadow-2xl w-[450px] flex flex-col gap-4 border ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'}`}>
        <div className="flex items-center gap-2 text-lg font-bold pb-2 border-b border-slate-200/20">
          <Sparkles className="text-purple-500" />
          <h3>AI Import (File &rarr; Markdown)</h3>
        </div>
        
        {/* Provider Selection */}
        <div className="relative">
          <label className="text-xs font-semibold uppercase opacity-60 mb-1 block">AI Provider</label>
          <button 
            onClick={() => setShowDropdown(!showDropdown)}
            className={`w-full p-2 rounded border flex items-center justify-between transition-colors ${isDarkMode ? 'bg-slate-900 border-slate-600 hover:bg-slate-700' : 'bg-slate-50 border-slate-300 hover:bg-slate-100'}`}
          >
            <div className="flex items-center gap-2">
              <Icon size={16} />
              <span>{currentProvider.name}</span>
            </div>
            <ChevronDown size={14} />
          </button>

          {showDropdown && (
            <div className={`absolute top-full left-0 right-0 mt-1 rounded-lg border shadow-xl z-20 overflow-hidden ${isDarkMode ? 'bg-slate-800 border-slate-600' : 'bg-white border-slate-300'}`}>
              {PROVIDERS.map(p => {
                const PIcon = p.icon;
                return (
                  <button 
                    key={p.id}
                    onClick={() => handleProviderChange(p.id)}
                    className={`w-full text-left p-2.5 flex items-center gap-2 text-sm transition-colors ${isDarkMode ? 'hover:bg-slate-700' : 'hover:bg-slate-100'} ${settings.provider === p.id ? (isDarkMode ? 'bg-slate-700' : 'bg-slate-100') : ''}`}
                  >
                    <PIcon size={16} />
                    <span>{p.name}</span>
                    {settings.provider === p.id && <Check size={14} className="ml-auto text-purple-500" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex gap-2">
            <div className="flex-1 flex flex-col gap-1">
              <label className="text-xs font-semibold uppercase opacity-60">Model Name</label>
              <input 
                type="text" 
                value={settings.model}
                onChange={(e) => setSettings({ ...settings, model: e.target.value })}
                placeholder="e.g. gpt-4o"
                className={`w-full p-2 rounded border focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm ${isDarkMode ? 'bg-slate-900 border-slate-600' : 'bg-slate-50 border-slate-300'}`}
              />
            </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold uppercase opacity-60">API Endpoint (Base URL)</label>
          <input 
            type="text" 
            value={settings.baseUrl}
            onChange={(e) => setSettings({ ...settings, baseUrl: e.target.value })}
            placeholder="https://..."
            className={`w-full p-2 rounded border focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm ${isDarkMode ? 'bg-slate-900 border-slate-600' : 'bg-slate-50 border-slate-300'}`}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold uppercase opacity-60">API Key</label>
          <input 
            type="password" 
            value={settings.apiKey}
            onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })}
            placeholder={settings.provider === 'ollama' ? "Not required for Ollama" : "sk-..."}
            className={`w-full p-2 rounded border focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm ${isDarkMode ? 'bg-slate-900 border-slate-600' : 'bg-slate-50 border-slate-300'}`}
          />
        </div>
        
        {settings.provider === 'ollama' && (
           <p className="text-[10px] text-yellow-500 opacity-90">
             Note: Ensure Ollama is running with <code>OLLAMA_ORIGINS="*"</code> to allow browser requests.
           </p>
        )}

        <div className="flex justify-end gap-2 mt-2 pt-2 border-t border-slate-200/20">
           <button onClick={onClose} className={`px-4 py-2 rounded text-sm ${isDarkMode ? 'hover:bg-slate-700' : 'hover:bg-slate-100'}`}>Cancel</button>
           <button 
             onClick={onImport} 
             disabled={!settings.apiKey && settings.provider !== 'ollama' && settings.provider !== 'lmstudio'}
             className={`px-4 py-2 rounded text-sm font-medium flex items-center gap-2 text-white shadow-md transition-transform hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed bg-purple-600 hover:bg-purple-700`}
           >
             <Settings size={14} /> Select File & Start
           </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default function App() {
  const [fileName, setFileName] = useState<string>('untitled.html');
  const [fileSource, setFileSource] = useState<FileSource>('NEW');
  
  // originalPath stores the disk path if opened via CLI/Association when source is 'PATH'
  const [originalPath, setOriginalPath] = useState<string | null>(null);
  
  const [isDirty, setIsDirty] = useState(false);
  
  // Refined Toast State
  const [toast, setToast] = useState<{ message: string; type: ToastType; isVisible: boolean }>({
    message: '',
    type: 'success',
    isVisible: false
  });
  
  const showToast = useCallback((message: string, type: ToastType = 'success') => {
    setToast({ message, type, isVisible: true });
  }, []);

  const closeToast = useCallback(() => {
    setToast(prev => ({ ...prev, isVisible: false }));
  }, []);
  
  const [isToolbarOpen, setIsToolbarOpen] = useState(true);
  const [customStyles, setCustomStyles] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  
  const [isHighlighterMode, setIsHighlighterMode] = useState(false);
  const [highlighterColor, setHighlighterColor] = useState<string>(HIGHLIGHT_COLORS.yellow);
  const [isDarkMode, setIsDarkMode] = useState(false);
  
  // Progress State for Document Conversion / Loading
  const [progress, setProgress] = useState<{current: number, total: number, message?: string} | null>(null);
  const [isProcessing, setIsProcessing] = useState(false); // General loading spinner
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  // AI Settings
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [aiSettings, setAiSettings] = useState<AiSettings>(() => {
    const saved = localStorage.getItem('winhtml_ai_settings');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) { console.error("Failed to parse settings", e); }
    }
    // Backward compatibility for old key
    const oldKey = localStorage.getItem('winhtml_ai_key');
    return {
      provider: 'zhipu',
      apiKey: oldKey || '',
      baseUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
      model: "glm-4.6v-flash"
    };
  });

  const isHighlighterModeRef = useRef(isHighlighterMode);
  const highlighterColorRef = useRef(highlighterColor);

  useEffect(() => { isHighlighterModeRef.current = isHighlighterMode; }, [isHighlighterMode]);
  useEffect(() => { highlighterColorRef.current = highlighterColor; }, [highlighterColor]);

  // Save AI Settings when changed (Global + Per Provider)
  useEffect(() => {
    // 1. Save global "last active" settings
    localStorage.setItem('winhtml_ai_settings', JSON.stringify(aiSettings));
    
    // 2. Automatically update the profile for the current provider
    if (aiSettings.provider) {
        const profile = {
          apiKey: aiSettings.apiKey,
          baseUrl: aiSettings.baseUrl,
          model: aiSettings.model
        };
        localStorage.setItem(`winhtml_ai_profile_${aiSettings.provider}`, JSON.stringify(profile));
    }
  }, [aiSettings]);

  // --- Helpers for explicit file locking ---
  const lockFileAPI = async (path: string) => {
      try { await fetch('/api/file/lock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) }); } catch(e) {}
  }
  const unlockFileAPI = async (path: string) => {
      try { await fetch('/api/file/unlock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) }); } catch(e) {}
  }

  // --- Automatic Locking on Dirty State ---
  useEffect(() => {
    if (isDirty && fileSource === 'PATH' && originalPath) {
        lockFileAPI(originalPath);
    }
    // Note: We intentionally do NOT unlock automatically when isDirty becomes false here,
    // because "Save" handles unlocking via the backend save API, and we don't want to conflict with other flows.
  }, [isDirty, fileSource, originalPath]);

  // --- Window Title & Unsaved Changes Warning ---
  useEffect(() => {
    document.title = `${fileName}${isDirty ? '*' : ''} - WinHTML Editor`;
    
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = ''; 
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [fileName, isDirty]);

  // Initialize Tiptap
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        history: {
          depth: 1000, 
        },
      } as any),
      Underline,
      Highlight.configure({ multicolor: true }),
      CustomTextStyle, 
      FontSize,
      FontFamily,
      CharacterCount,
      CustomColor, 
      ClassAttribute,
      Comment, 
      TextBox,
      Div, 
      Subscript, 
      Superscript, 
      MathExtension, 
      Table.configure({ resizable: true }),
      TableRow, 
      CustomTableHeader, 
      CustomTableCell,
      TableShortcuts,
      TextAlign.configure({ types: ['heading', 'paragraph', 'div', 'textBox'] }),
      CustomImage.configure({
        inline: true,
        allowBase64: true,
      }),
    ],
    content: ``,
    onUpdate: () => {
      if (!isInitialLoad && !isDirty) setIsDirty(true);
    },
    editorProps: {
      attributes: { class: 'focus:outline-none min-h-full' },
      transformPastedHTML(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const elements = doc.querySelectorAll('*');
        
        elements.forEach(el => {
          const htmlEl = el as HTMLElement;
          if (htmlEl.style) {
            htmlEl.style.color = '';
            htmlEl.style.backgroundColor = '';
            if (htmlEl.hasAttribute('color')) htmlEl.removeAttribute('color');
            if (htmlEl.hasAttribute('bgcolor')) htmlEl.removeAttribute('bgcolor');
          }
        });
        
        return doc.body.innerHTML;
      },
      handleDOMEvents: {
        copy: (view, event) => {
          const { state } = view;
          if (state.selection.empty) return false;

          event.preventDefault();
          const clipboardData = event.clipboardData;
          if (!clipboardData) return false;

          const slice = state.selection.content();
          
          // 1. Plain Text: Use single newline (\n) instead of default double newline
          const plainText = slice.content.textBetween(0, slice.content.size, '\n', '\n');
          clipboardData.setData('text/plain', plainText);

          // 2. HTML: Preserve rich text using default serializer
          const serializer = view.someProp('clipboardSerializer');
          if (serializer) {
             const fragment = serializer.serializeFragment(slice.content, { document: document });
             const div = document.createElement('div');
             div.appendChild(fragment);
             clipboardData.setData('text/html', div.innerHTML);
          }

          return true;
        }
      }
    },
  });

  // --- Pen Mode (Highlighter) Logic ---
  useEffect(() => {
    if (!editor) return;

    const handleMouseUp = () => {
      setTimeout(() => {
        if (isHighlighterModeRef.current && highlighterColorRef.current) {
           const { empty } = editor.state.selection;
           if (!empty) {
               (editor.chain() as any).setHighlight({ color: highlighterColorRef.current }).run();
           }
        }
      }, 10);
    };

    const dom = editor.view.dom;
    dom.addEventListener('mouseup', handleMouseUp);
    return () => { dom.removeEventListener('mouseup', handleMouseUp); };
  }, [editor]);

  // --- Startup: Check for file passed via CLI (Windows Open With) ---
  useEffect(() => {
    if (!editor) return;

    const checkInitialFile = async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const fileId = params.get('fileId');
        
        // Only fetch if a fileId or special path is present.
        if (!fileId && !params.get('path')) return;

        setIsProcessing(true); // Show loading spinner
        
        const url = fileId ? `/api/open-file?fileId=${fileId}` : `/api/open-file?path=${encodeURIComponent(params.get('path') || '')}`;
        
        const response = await fetch(url);
        if (!response.ok) {
           setIsProcessing(false);
           return;
        }

        // --- NEW: Handle Binary Response ---
        const blob = await response.blob();
        const headerFileName = response.headers.get('X-File-Name');
        // Fallback name if header missing
        const fileName = headerFileName ? decodeURIComponent(headerFileName) : 'imported_file.html';
        
        // Convert Blob to File for unified processing
        const file = new File([blob], fileName, { type: blob.type });

        // Convert content
        const { bodyHTML, styles, name } = await processLoadedFile(file, (c, t) => setProgress({ current: c, total: t }));
        const htmlWithBlobs = await convertHtmlBase64ToBlobUrls(bodyHTML);

        setProgress(null);
        setCustomStyles(styles);
        editor.commands.setContent(htmlWithBlobs, { emitUpdate: false });
        
        const isSafeHtml = /\.(html|htm)$/i.test(fileName);

        if (!isSafeHtml) {
            const nameWithoutExt = fileName.split(/[/\\]/).pop()?.replace(/\.[^/.]+$/, "") || "untitled";
            setFileName(`${nameWithoutExt}.html`);
            setFileSource('IMPORTED');
            setOriginalPath(null); 
            setIsDirty(true);      
        } else {
            setFileName(name);
            setFileSource('PATH');
            
            // Use X-File-Path header if available (preferred for CLI), else try to infer from params
            const headerPath = response.headers.get('X-File-Path');
            const finalPath = headerPath ? decodeURIComponent(headerPath) : (params.get('path') || fileName);
            setOriginalPath(finalPath);
            
            setIsDirty(false);
        }
        
        // Clear URL params to prevent reloading loop and clean up UI
        window.history.replaceState({}, '', '/');
      } catch (e) {
        console.log("WinHTML: Error loading initial file", e);
      } finally {
        setIsInitialLoad(false);
        setIsProcessing(false);
      }
    };

    checkInitialFile();
  }, [editor]); // Runs when editor is ready

  // --- Helper: Register File with Backend to get URL ---
  const registerFile = useCallback(async (file: File) => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const base64Data = arrayBufferToBase64(arrayBuffer);

      const response = await fetch('/api/cli-handover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          data: base64Data
        })
      });

      if (response.ok) {
        const id = await response.text();
        if (/^[a-f0-9]{16}$/.test(id)) {
           // We don't change URL here for new files usually, but if needed for persistence
        }
      }
    } catch (e) {
      console.error("WinHTML: Failed to register file with backend", e);
    }
  }, []);

  // --- New File Logic ---
  const handleNewFile = useCallback(async () => {
    if (isDirty && !window.confirm("Discard changes?")) return;

    // Explicitly unlock the current file if we are discarding changes and switching to new
    if (originalPath) {
        unlockFileAPI(originalPath);
    }

    if (editor) {
        editor.commands.setContent('<p></p>');
        setFileName('untitled.html');
        setFileSource('NEW');
        setOriginalPath(null);
        setCustomStyles('');
        setIsDirty(false);
    }
  }, [isDirty, editor, originalPath]);

  // --- Insert Image Logic (From Toolbar) ---
  const handleInsertImage = () => {
    imageInputRef.current?.click();
  };

  const onImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0] && editor) {
      const file = e.target.files[0];
      const objectUrl = URL.createObjectURL(file);
      (editor.chain().focus() as any).setImage({ src: objectUrl }).run();
      e.target.value = '';
    }
  };

  // --- AI Import Logic ---
  const handleAiImportStart = () => {
    setIsAiModalOpen(true);
  };

  const handleAiImportExecute = async () => {
    if (!editor) return;
    setIsAiModalOpen(false);

    try {
      // 1. Open File Dialog (Backend)
      const res = await fetch('/api/dialog/open');
      if (!res.ok) throw new Error("Failed to open dialog");
      const { path } = await res.json();
      if (!path) return; // User cancelled

      const lowerPath = path.toLowerCase();
      const isPdf = lowerPath.endsWith('.pdf');
      const isImage = /\.(png|jpg|jpeg|webp|bmp)$/.test(lowerPath);

      if (!isPdf && !isImage) {
        alert("Please select a PDF or Image file for AI Import.");
        return;
      }

      // 2. Load File Data (Binary)
      setIsProcessing(true);
      const loadRes = await fetch(`/api/open-file?path=${encodeURIComponent(path)}`);
      if (!loadRes.ok) throw new Error("Failed to load file");
      
      const blob = await loadRes.blob();
      const headerFileName = loadRes.headers.get('X-File-Name') || path.split(/[/\\]/).pop() || "import";
      const file = new File([blob], headerFileName, { type: blob.type });

      let images: Blob[] = [];

      if (isPdf) {
          // 3. Convert PDF to Images
          setProgress({ current: 0, total: 100, message: "Rendering PDF to Images..." });
          images = await convertPdfToImages(file, (c, t) => {
             setProgress({ current: c, total: t, message: `Rendering Page ${c} of ${t}` });
          });
      } else {
          // It's an image
          images = [file];
      }

      // 4. Send to AI (Generic)
      let fullMarkdown = "";
      for (let i = 0; i < images.length; i++) {
        setProgress({ 
          current: i + 1, 
          total: images.length, 
          message: `AI Transcribing Page ${i + 1} of ${images.length} (${aiSettings.model})` 
        });
        
        try {
          // Use generic transcribe function
          const md = await transcribeImage(images[i], aiSettings, (status) => {
             // Optional fine-grained status update
          });
          fullMarkdown += md + "\n\n";
        } catch (e) {
          console.error(`Page ${i+1} failed`, e);
          fullMarkdown += `\n> [Error processing Page ${i+1}: ${(e as Error).message}]\n\n`;
        }
      }

      // 5. Convert MD to HTML and Insert
      setProgress({ current: 100, total: 100, message: "Converting Markdown..." });
      const html = convertMarkdownToHtml(fullMarkdown);
      
      const nameWithoutExt = headerFileName.replace(/\.[^/.]+$/, "");
      setFileName(`${nameWithoutExt}_AI_Imported.html`);
      setFileSource('IMPORTED');
      setOriginalPath(null);
      setCustomStyles(''); // Reset styles for new content
      editor.commands.setContent(html);
      setIsDirty(true);

    } catch (e) {
      console.error("AI Import Failed", e);
      alert(`AI Import Failed: ${(e as Error).message}`);
    } finally {
      setIsProcessing(false);
      setProgress(null);
    }
  };


  // --- Paste Markdown Logic ---
  const handlePasteMarkdown = useCallback(async () => {
    if (!editor) return;
    let text = '';
    try {
      text = await navigator.clipboard.readText();
    } catch (err) {
      const input = prompt("Paste your Markdown text here:");
      if (input !== null) text = input;
    }
    if (!text) return;
    const html = convertMarkdownToHtml(text);
    if (html) editor.chain().focus().insertContent(html).run();
  }, [editor]);

  // --- Paste From Web (Clean) Logic ---
  const handlePasteFromWeb = useCallback(async () => {
    if (!editor) return;
    try {
      const items = await navigator.clipboard.read();
      let html = '';
      for (const item of items) {
        if (item.types.includes('text/html')) {
          const blob = await item.getType('text/html');
          html = await blob.text();
          break;
        }
      }
      if (!html) {
         try {
           html = await navigator.clipboard.readText();
           if (!/<[a-z][\s\S]*>/i.test(html)) {
              html = html.replace(/\n/g, '<br>');
           }
         } catch(e) {
           alert("Clipboard access denied or empty.");
           return;
         }
      }
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const allElements = doc.querySelectorAll('*');
      allElements.forEach((el) => {
         const element = el as HTMLElement;
         const isCodeTag = element.tagName === 'CODE' || element.tagName === 'PRE';
         const hasCodeClass = element.className && (
            element.className.includes('code') || 
            element.className.includes('highlight') || 
            element.className.includes('blob-code') ||
            element.className.includes('token')
         );
         const style = element.getAttribute('style') || '';
         const isMono = /font-family:.*(mono|courier|consolas)/i.test(style);

         element.removeAttribute('class');
         Object.keys(element.dataset).forEach(key => delete element.dataset[key]);

         if (isCodeTag || hasCodeClass || isMono) {
            element.style.fontFamily = 'Consolas, "Courier New", monospace';
            element.style.backgroundColor = '#f3f4f6'; 
            element.style.color = '#d63384'; 
            element.style.padding = '2px 4px';
            element.style.borderRadius = '4px';
            element.style.fontSize = '0.9em';
         }

         if (element.style.backgroundColor === 'white' || element.style.backgroundColor === '#ffffff' || element.style.backgroundColor === 'rgb(255, 255, 255)') {
             element.style.backgroundColor = '';
         }
         if (element.style.color === 'black' || element.style.color === '#000000' || element.style.color === 'rgb(0, 0, 0)') {
             element.style.color = ''; 
         }
      });
      editor.chain().focus().insertContent(doc.body.innerHTML).run();
    } catch (err) {
      console.error("Paste from Web failed", err);
      alert("Failed to read from clipboard. Please allow clipboard permissions.");
    }
  }, [editor]);

  // --- Add Comment ---
  const handleAddComment = useCallback(() => {
    if (!editor) return;
    const currentAttrs = editor.getAttributes('comment');
    const previousText = currentAttrs.text || '';
    const text = window.prompt('Enter comment/annotation:', previousText);
    if (text === null) return; 
    editor.chain().focus().run();
    if (text === '') {
      editor.chain().focus().unsetMark('comment').run();
      return;
    }
    editor.chain().focus().setMark('comment', { text }).run();
  }, [editor]);

  // --- Dynamic Dark Mode Styles ---
  const darkModeStyles = useMemo(() => {
    if (!isDarkMode) return '';
    const processedCustomStyles = ColorUtils.processCSSForDarkMode(customStyles);
    return `
      ${processedCustomStyles}
      .ProseMirror { background-color: transparent !important; color: #e0e0e0; caret-color: #e0e0e0; }
      .ProseMirror h1, .ProseMirror h2, .ProseMirror h3, 
      .ProseMirror h4, .ProseMirror h5, .ProseMirror h6 { color: #f3f3f3 !important; }
      .ProseMirror a { color: #8ab4f8 !important; text-decoration: underline; }
      .ProseMirror blockquote { color: #81c784 !important; border-left-color: #81c784 !important; background: rgba(129, 199, 132, 0.1); }
      .ProseMirror div:not([data-type]), .ProseMirror section, .ProseMirror article, .ProseMirror .section-box {
        background-color: transparent !important; box-shadow: 0 0 0 1px #444 !important; border-color: #444; 
      }
      .ProseMirror [style*="color: black"], 
      .ProseMirror [style*="color: #000"], 
      .ProseMirror [style*="color: #000000"], 
      .ProseMirror [style*="color: rgb(0, 0, 0)"],
      .ProseMirror [style*="color: rgb(0,0,0)"],
      .ProseMirror [style*="color: #333"],
      .ProseMirror [style*="color: #333333"],
      .ProseMirror [style*="color: rgb(51, 51, 51)"],
      .ProseMirror font[color="black"],
      .ProseMirror font[color="#000000"],
      .ProseMirror font[color="#000"]
      { color: #e0e0e0 !important; }
      .ProseMirror mark { color: #000 !important; }
      .ProseMirror ::selection { background: #1a73e8 !important; color: #fff !important; }
      .ProseMirror pre { background-color: #202020 !important; border: 1px solid #444; color: #d4d4d4; }
      .ProseMirror code { color: #f28b82 !important; background-color: rgba(255,255,255, 0.08) !important; }
      .ProseMirror .annotation-mark { background-color: transparent !important; border-bottom: 2px solid #fdd835 !important; color: inherit !important; }
      .ProseMirror .winhtml-textbox { 
        background-color: #333 !important; 
        border-color: #555 !important; 
      }
      .ProseMirror h1, .ProseMirror h2, .ProseMirror h3, 
      .ProseMirror h4, .ProseMirror h5, .ProseMirror h6,
      .ProseMirror p, .ProseMirror ul, .ProseMirror ol, .ProseMirror li {
        background-color: transparent !important;
      }
      .ProseMirror table {
        background-color: transparent !important;
      }
      .ProseMirror tr, 
      .ProseMirror td {
        background-color: transparent !important; 
        border-color: #4a4a4a !important;        
        color: #e0e0e0 !important;               
      }
      .ProseMirror th {
        background-color: #2d2d2d !important;   
        border-color: #555555 !important;
        font-weight: bold !important;
        color: #f3f3f3 !important;
      }
      .ProseMirror .docx-textbox {
        background-color: #333333 !important; 
        border: 1px solid #555555 !important; 
        color: #e0e0e0 !important;            
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.5) !important; 
      }
    `;
  }, [isDarkMode, customStyles]);

  const activeStyles = isDarkMode ? darkModeStyles : customStyles;

  const generateDocContent = useCallback((bodyHTML: string) => {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${fileName.replace('.html', '')}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
<style>
  body { margin: 8px; font-family: "Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI", sans-serif; } 
  table { border-collapse: collapse; } td, th { border: 1px solid #ccc; padding: 4px; }
  .annotation-mark { border-bottom: 2px solid #fbbf24; cursor: help; background-color: #fef3c7; }
  pre { background-color: #f6f8fa; padding: 1em; overflow-x: auto; border: 1px solid #e1e4e8; border-radius: 0.5rem; color: #24292e; }
  code { font-family: monospace; background-color: rgba(0,0,0,0.05); padding: 0.1em; } 
  .winhtml-textbox { border-width: 1px; border-style: solid; border-radius: 0.5rem; padding: 1rem; margin: 1rem 0; page-break-inside: avoid; }
${customStyles}</style></head>
<body>${bodyHTML}</body></html>`;
  }, [fileName, customStyles]);

  // --- Export Logic ---
  const handleExport = useCallback(async (type: ExportType) => {
    if (!editor) return;
    const baseName = fileName.replace(/\.[^/.]+$/, "");

    if (type === 'pdf') {
       try {
           // 1. Prompt for Zoom/Scale (default 100%)
           const scaleInput = prompt("Enter Scale Percentage (e.g. 100):", "100");
           if (scaleInput === null) return; // Cancelled
           
           let scale = parseFloat(scaleInput);
           if (isNaN(scale) || scale <= 0) scale = 100;
           // Convert to decimal (100% -> 1.0)
           scale = scale / 100;

           // 2. Ask User where to save PDF (with correct PDF filter)
           const saveRes = await fetch('/api/dialog/save?filter=pdf');
           if (!saveRes.ok) throw new Error("Failed to open save dialog");
           const { path } = await saveRes.json();
           if (!path) return;

           setIsProcessing(true);

           // 3. Prepare HTML (Ensure images are inlined as base64 so backend can see them)
           const currentHtml = editor.getHTML();
           const inlinedBody = await inlineImagesForExport(currentHtml);
           
           // 4. Wrap in Print-Friendly HTML Template
           const fullHtml = `<!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8">
              <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
              <script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
              <style>
                body { 
                    margin: 0; 
                    font-family: "Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI", sans-serif; 
                    background-color: #ffffff;
                    color: #000000;
                    width: 100%;
                    box-sizing: border-box;
                    -webkit-print-color-adjust: exact;
                }
                .ProseMirror { outline: none; width: 100%; }
                
                img { max-width: 100%; height: auto; display: block; }
                
                table { width: 100% !important; border-collapse: collapse; table-layout: fixed !important; }
                td, th { border: 1px solid #ccc; padding: 4px; word-wrap: break-word; }
                
                pre { background-color: #f6f8fa; padding: 1em; border: 1px solid #e1e4e8; border-radius: 0.5rem; white-space: pre-wrap; word-break: break-word; }
                code { font-family: monospace; background-color: rgba(0,0,0,0.05); padding: 0.1em; }
                
                .winhtml-textbox { border-width: 1px; border-style: solid; border-radius: 0.5rem; padding: 1rem; margin: 1rem 0; page-break-inside: avoid; }
                .math-node { display: inline-block; }
                
                /* Apply Custom User Styles (forced light mode for print) */
                ${customStyles} 
              </style>
            </head>
            <body>
              <div class="ProseMirror">
                ${inlinedBody}
              </div>
              <script>
                document.addEventListener("DOMContentLoaded", function() {
                  if (window.katex) {
                      const mathElements = document.querySelectorAll('span[data-type="math"]');
                      mathElements.forEach(el => {
                           const latex = el.getAttribute('data-latex');
                           if (latex) {
                              try {
                                  window.katex.render(latex, el, {
                                      throwOnError: false,
                                      displayMode: false
                                  });
                              } catch(e) { console.error(e); }
                           }
                      });
                  }
                });
              </script>
            </body>
            </html>`;

           // 5. Send to Backend to Generate PDF with Scale
           const response = await fetch('/api/export/pdf', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    html: fullHtml,
                    path: path,
                    scale: scale // Send the scale factor
                })
           });

           if (!response.ok) {
                const errText = await response.text();
                throw new Error(errText || "Backend PDF generation failed");
           }
           
           showToast("PDF Exported Successfully", 'success');

       } catch (e) {
           console.error("PDF Export Failed", e);
           showToast(`PDF Export failed: ${(e as Error).message}`, 'error');
       } finally {
           setIsProcessing(false);
       }
    } else if (type === 'docx') {
       await exportToDocx(editor, baseName);
    } else if (type === 'png' || type === 'png-desktop' || type === 'png-mobile') {
        setIsProcessing(true);
        try {
            const isMobile = type === 'png-mobile';
            const width = isMobile ? 414 : 1200;

            // 1. Prepare HTML with inlined images (convert blob: to data:base64)
            const currentHtml = editor.getHTML();
            let inlinedBody = await inlineImagesForExport(currentHtml);

            // MOBILE SCALING: Adjust text size only (keep borders/layout widths fixed)
            if (isMobile) {
               const parser = new DOMParser();
               const doc = parser.parseFromString(inlinedBody, 'text/html');
               // Select elements that specifically have an inline font-size set
               const styledElements = doc.querySelectorAll('[style*="font-size"]');
               styledElements.forEach((el) => {
                   const htmlEl = el as HTMLElement;
                   const currentSize = htmlEl.style.fontSize;
                   if (currentSize) {
                       const match = currentSize.match(/^(\d+(\.\d+)?)(px|pt|em|rem|%)$/);
                       if (match) {
                           const val = parseFloat(match[1]);
                           const unit = match[3];
                           htmlEl.style.fontSize = `${val * 0.75}${unit}`;
                       }
                   }
               });
               inlinedBody = doc.body.innerHTML;
            }

            // 2. Wrap with full document structure
            const fullHtml = `<!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8">
              <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
              <script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
              <style>
                html, body {
                    min-height: 0 !important;
                    height: auto !important;
                    overflow: visible !important; /* Allow content to dictate height/width without clipping */
                }
                body { 
                    margin: 0; 
                    padding: ${isMobile ? '20px' : '40px'}; 
                    font-family: "Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI", sans-serif; 
                    background-color: ${isDarkMode ? '#2e2e2e' : '#ffffff'};
                    color: ${isDarkMode ? '#e0e0e0' : '#000000'};
                    width: 100%;
                    box-sizing: border-box;
                }
                .ProseMirror { outline: none; width: 100%; }
                
                /* Responsive Images */
                img {
                    max-width: 100%;
                    height: auto;
                    display: block;
                }
                
                /* Responsive Tables - Enforce Equal Column Widths */
                table {
                    width: 100% !important;
                    max-width: 100% !important;
                    /* Use fixed layout to ensure it doesn't overflow page width */
                    table-layout: fixed !important; 
                    border-collapse: collapse; 
                }
                
                /* Reset any specific column widths from Tiptap to ensure equal distribution */
                colgroup, col {
                    width: auto !important;
                }

                td, th { 
                    border: 1px solid ${isDarkMode ? '#555' : '#ccc'}; 
                    padding: 4px; 
                    /* Ensure text wraps inside cells */
                    word-wrap: break-word;
                    overflow-wrap: break-word;
                    word-break: normal;
                    white-space: normal !important;
                    
                    /* Force cells to ignore inline width and distribute equally via table-layout: fixed */
                    width: auto !important;
                }

                .annotation-mark { border-bottom: 2px solid #fbbf24; background-color: ${isDarkMode ? 'transparent' : '#fef3c7'}; }
                pre { background-color: ${isDarkMode ? '#202020' : '#f6f8fa'}; padding: 1em; border: 1px solid ${isDarkMode ? '#444' : '#e1e4e8'}; border-radius: 0.5rem; white-space: pre-wrap; word-break: break-word; }
                code { font-family: monospace; background-color: ${isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'}; padding: 0.1em; }
                .winhtml-textbox { border-width: 1px; border-style: solid; border-radius: 0.5rem; padding: 1rem; margin: 1rem 0; page-break-inside: avoid; }
                .math-node { display: inline-block; }

                /* Mobile Text Scaling (75%) */
                ${isMobile ? `
                  .ProseMirror {
                      font-size: 75%;
                  }
                ` : ''}

                /* Apply user styles and dark mode adjustments */
                ${activeStyles} 
              </style>
            </head>
            <body>
              <div class="ProseMirror">
                ${inlinedBody}
              </div>
              <script>
                document.addEventListener("DOMContentLoaded", function() {
                  if (window.katex) {
                      const mathElements = document.querySelectorAll('span[data-type="math"]');
                      mathElements.forEach(el => {
                           const latex = el.getAttribute('data-latex');
                           if (latex) {
                              try {
                                  window.katex.render(latex, el, {
                                      throwOnError: false,
                                      displayMode: false
                                  });
                              } catch(e) { console.error(e); }
                           }
                      });
                  }
                });
              </script>
            </body>
            </html>`;

            // 3. Send to Backend
            const response = await fetch('/api/export/screenshot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    html: fullHtml,
                    width: width
                })
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(errText || "Backend screenshot failed");
            }

            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${baseName}-${isMobile ? 'mobile' : 'desktop'}.png`;
            link.click();
            URL.revokeObjectURL(url);

        } catch (e) {
            console.error("PNG Export Failed", e);
            showToast(`Screenshot export failed: ${(e as Error).message}`, 'error');
        } finally {
            setIsProcessing(false);
        }
    } else if (type === 'md') {
       const turndownService = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', emDelimiter: '_', strongDelimiter: '**' });
       turndownService.use(gfm);
       turndownService.addRule('gfm-table-manual', {
         filter: 'table',
         replacement: function (content, node) {
           const element = node as HTMLElement;
           const rows = Array.from(element.querySelectorAll('tr'));
           if (rows.length === 0) return '';
           let markdownTable = '\n\n';
           rows.forEach((row, rowIndex) => {
             const tr = row as HTMLElement;
             const cells = Array.from(tr.querySelectorAll('td, th'));
             const cellContents = cells.map(cell => cell.textContent?.trim().replace(/\n/g, '<br>') || ' ');
             markdownTable += '| ' + cellContents.join(' | ') + ' |\n';
             if (rowIndex === 0) markdownTable += '| ' + cellContents.map(() => '---').join(' | ') + ' |\n';
           });
           return markdownTable + '\n';
         }
       });
       turndownService.addRule('math', { 
           filter: (n: any) => n.nodeName === 'SPAN' && (n.getAttribute('data-type') === 'math' || n.hasAttribute('data-latex')), 
           replacement: (c, n: any) => `$${n.getAttribute('data-latex') || ''}$` 
       });
       turndownService.addRule('comment', { filter: (n: any) => n.nodeName === 'SPAN' && n.hasAttribute('data-comment'), replacement: (c, n: any) => `[${c}](comment: ${n.getAttribute('data-comment')})` });
       const markdown = turndownService.turndown(editor.getHTML());
       const blob = new Blob([markdown], { type: 'text/markdown' });
       const link = document.createElement('a');
       link.href = URL.createObjectURL(blob);
       link.download = `${baseName}.md`;
       link.click();
       URL.revokeObjectURL(link.href);
    }
  }, [editor, fileName, customStyles, activeStyles, isDarkMode]);

  // --- Helper to update Editor State after save ---
  const updateEditorImages = useCallback((imageMap: Record<string, string>) => {
    if (!editor) return;
    
    // Collect updates first to avoid modifying document while iterating
    const updates: { pos: number; attrs: any }[] = [];
    
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'image') {
        const src = node.attrs.src;
        // Check if this image source was mapped to a new filename
        if (imageMap[src]) {
          updates.push({
            pos,
            attrs: { ...node.attrs, 'data-original-src': imageMap[src] },
          });
        }
      }
    });

    if (updates.length > 0) {
      const tr = editor.state.tr;
      updates.forEach(({ pos, attrs }) => {
        tr.setNodeMarkup(pos, undefined, attrs);
      });
      editor.view.dispatch(tr);
    }
  }, [editor]);

  // --- Save As Logic (Using Native Dialog) ---
  const performSaveAs = async () => {
    if (!editor) return;

    try {
      const res = await fetch('/api/dialog/save');
      if (!res.ok) throw new Error("Failed to open dialog");
      
      const { path } = await res.json();
      if (!path) return; // User cancelled

      // Set initial path info
      const oldPath = originalPath;
      setOriginalPath(path);
      const name = path.split(/[/\\]/).pop();
      setFileName(name);
      setFileSource('PATH');

      // Now save content
      const { html, assets, imageMap } = await prepareHtmlForSave(editor.getHTML(), name);
      const content = generateDocContent(html);

      // --- NEW: FormData Implementation ---
      const formData = new FormData();
      formData.append('filePath', path);
      
      // Append main HTML file as blob
      const htmlBlob = new Blob([content], { type: 'text/html' });
      formData.append('html', htmlBlob, 'index.html');
      
      // Append assets
      assets.forEach(asset => {
        formData.append('assets', asset.data, asset.fileName);
      });

      const saveRes = await fetch('/api/save-file', {
        method: 'POST',
        // No Content-Type header needed; fetch sets multipart boundary automatically
        body: formData
      });

      if (saveRes.ok) {
        // Parse the response to get the final path (backend might have created a subfolder)
        const data = await saveRes.json();
        if (data.path) {
           // Check if we switched files completely
           if (oldPath && oldPath !== data.path) {
              unlockFileAPI(oldPath);
           }

           setOriginalPath(data.path);
           setFileName(data.path.split(/[/\\]/).pop());
        }
        
        // Critical: Update editor state with new filenames so subsequent saves don't duplicate
        updateEditorImages(imageMap);

        setIsDirty(false);
        showToast("Saved to disk", 'success');
      } else {
        const errData = await saveRes.json().catch(() => ({}));
        const msg = errData.error || "Failed to save file.";
        showToast(msg, 'error');
      }

    } catch (e) {
      console.error("Save As failed", e);
      showToast("Save operation failed.", 'error');
    }
  };

  // --- Main Save Handler ---
  const handleSaveFile = useCallback(async (silent: boolean = false) => {
    if (!editor) return;
    
    // 1. IMPORTED or NEW -> Must use "Save As" logic (get path first)
    if (fileSource === 'IMPORTED' || fileSource === 'NEW') {
        if (silent) return; 
        await performSaveAs();
        return;
    }

    // 2. PATH -> Write to backend API
    if (fileSource === 'PATH' && originalPath) {
        try {
           const { html, assets, imageMap } = await prepareHtmlForSave(editor.getHTML(), fileName);
           const content = generateDocContent(html);

           // --- NEW: FormData Implementation ---
           const formData = new FormData();
           formData.append('filePath', originalPath);
           const htmlBlob = new Blob([content], { type: 'text/html' });
           formData.append('html', htmlBlob, 'index.html');
           assets.forEach(asset => {
             formData.append('assets', asset.data, asset.fileName);
           });

           const response = await fetch('/api/save-file', {
             method: 'POST',
             body: formData
           });
           
           if (response.ok) {
             // Backend might return a new path if it auto-created a smart folder
             const resData = await response.json();
             if (resData.path) {
                setOriginalPath(resData.path);
                setFileName(resData.path.split(/[/\\]/).pop());
             }
             
             // Critical: Update editor state with new filenames
             updateEditorImages(imageMap);

             setIsDirty(false);
             if (!silent) showToast("Saved to disk", 'success');
           } else {
             // Try to parse JSON error from backend
             let errorMsg = "Backend save failed";
             try {
                const errData = await response.json();
                if (errData.error) errorMsg = errData.error;
             } catch(e) { /* ignore parse error */ }
             
             throw new Error(errorMsg);
           }
        } catch (e) {
           console.error("Backend save error:", e);
           if (!silent) {
               showToast((e as Error).message, 'error');
               // If it was a lock error, give user a chance to read it, then maybe they choose Save As manually.
               // We don't force Save As immediately to avoid jarring UX if it's a temporary lock.
           }
        }
        return;
    }

    if (!silent) await performSaveAs();
  }, [editor, fileSource, originalPath, generateDocContent, updateEditorImages]); 

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); handleSaveFile(); } };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSaveFile]);

  // --- Auto Save Logic ---
  const latestStateRef = useRef({ isDirty, fileSource, handleSaveFile });
  useEffect(() => {
    latestStateRef.current = { isDirty, fileSource, handleSaveFile };
  }, [isDirty, fileSource, handleSaveFile]);

  useEffect(() => {
    const AUTO_SAVE_INTERVAL = 6 * 60 * 1000;
    const interval = setInterval(() => {
       const { isDirty, fileSource, handleSaveFile } = latestStateRef.current;
       if (isDirty && fileSource === 'PATH') {
          handleSaveFile(true);
       }
    }, AUTO_SAVE_INTERVAL);
    return () => clearInterval(interval);
  }, []);

  // --- Open File Logic (Using Native Dialog) ---
  const handleOpenFile = useCallback(async () => {
    if (isDirty && !window.confirm("Discard changes?")) return;
    
    // Explicitly unlock the current file if we are discarding changes and switching
    if (originalPath) {
        unlockFileAPI(originalPath);
    }

    setIsProcessing(true); // START LOADING

    try {
      // 1. Open Dialog
      const res = await fetch('/api/dialog/open');
      if (!res.ok) throw new Error("Failed to open dialog");
      const { path } = await res.json();
      if (!path) {
         setIsProcessing(false);
         return; // User cancelled
      }

      // 2. Load File Data
      const loadRes = await fetch(`/api/open-file?path=${encodeURIComponent(path)}`);
      if (!loadRes.ok) {
        const msg = await loadRes.text();
        throw new Error(msg || "Failed to load file content");
      }
      
      // --- NEW: Handle Binary Response ---
      const blob = await loadRes.blob();
      const headerFileName = loadRes.headers.get('X-File-Name');
      const fileName = headerFileName ? decodeURIComponent(headerFileName) : path.split(/[/\\]/).pop() || 'file';
      
      const file = new File([blob], fileName, { type: blob.type });

      if (editor) {
          const { bodyHTML, styles, name } = await processLoadedFile(file, (c, t) => setProgress({ current: c, total: t }));
          const htmlWithBlobs = await convertHtmlBase64ToBlobUrls(bodyHTML);

          setProgress(null); 
          setCustomStyles(styles); 
          editor.commands.setContent(htmlWithBlobs, { emitUpdate: false }); 

          const isSafeHtml = /\.(html|htm)$/i.test(fileName);
          
          if (!isSafeHtml) {
             const nameWithoutExt = name.replace(/\.[^/.]+$/, "");
             setFileName(`${nameWithoutExt}.html`);
             setFileSource('IMPORTED');
             setOriginalPath(null);
             setIsDirty(true);
          } else {
             setFileName(name);
             setFileSource('PATH');
             
             // Use X-File-Path if provided, else use path from dialog
             const headerPath = loadRes.headers.get('X-File-Path');
             const finalPath = headerPath ? decodeURIComponent(headerPath) : path;
             setOriginalPath(finalPath);
             
             setIsDirty(false); // Clean state after opening
          }
      }

    } catch (e) {
      console.error("Open File failed", e);
      // IMPROVED: Alert the specific error message
      showToast(`Error: ${(e as Error).message}`, 'error');
    } finally {
      setIsProcessing(false); // STOP LOADING
    }
  }, [isDirty, editor, registerFile, originalPath]);

  const getScopedStyles = () => activeStyles ? activeStyles.replace(/(^|[\s,}])body(?=[\s,{])/ig, '$1.ProseMirror') : '';

  return (
    <div className={`flex flex-col h-screen w-screen font-sans transition-colors duration-300 ${isDarkMode ? 'bg-[#202020] text-slate-100' : 'bg-white text-slate-900'}`}>
      {activeStyles && <style dangerouslySetInnerHTML={{ __html: getScopedStyles() }} />}
      
      {/* Hidden Inputs (only for image insert now, file open uses native dialog) */}
      <input
        type="file"
        accept="image/*"
        ref={imageInputRef}
        onChange={onImageFileChange}
        className="hidden"
      />
      
      <Toolbar 
        editor={editor} 
        isOpen={isToolbarOpen} 
        onToggle={() => setIsToolbarOpen(!isToolbarOpen)} 
        onNew={handleNewFile}
        onOpen={handleOpenFile} 
        onSave={() => handleSaveFile(false)} 
        onSaveAs={performSaveAs} 
        onExport={handleExport} 
        onPasteMarkdown={handlePasteMarkdown} 
        onPasteWeb={handlePasteFromWeb} 
        onInsertImage={handleInsertImage}
        onAiImport={handleAiImportStart}
        onAddComment={handleAddComment} 
        isHighlighterMode={isHighlighterMode} 
        toggleHighlighterMode={() => setIsHighlighterMode(!isHighlighterMode)} 
        highlighterColor={highlighterColor} 
        setHighlighterColor={setHighlighterColor} 
        isDarkMode={isDarkMode} 
        toggleDarkMode={() => setIsDarkMode(!isDarkMode)}
      />
      <EditorComponent editor={editor} isDarkMode={isDarkMode} onAddComment={handleAddComment} />
      
      <Toast message={toast.message} type={toast.type} isVisible={toast.isVisible} onClose={closeToast} />
      
      <AIModal 
        isOpen={isAiModalOpen} 
        onClose={() => setIsAiModalOpen(false)} 
        onImport={handleAiImportExecute}
        settings={aiSettings}
        setSettings={setAiSettings}
        isDarkMode={isDarkMode}
      />

      {/* Generic Loading Spinner (Processing / Opening) */}
      {isProcessing && (
        <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm">
           <div className={`p-6 rounded-2xl shadow-2xl flex flex-col items-center ${isDarkMode ? 'bg-slate-800' : 'bg-white'}`}>
             <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
             <p className="mt-4 font-medium">Processing...</p>
           </div>
        </div>
      )}

      {/* Progress Bar (PDF/DOCX Conversion) */}
      {progress && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className={`p-6 rounded-xl shadow-2xl w-96 flex flex-col items-center ${isDarkMode ? 'bg-slate-800 text-white' : 'bg-white text-slate-900'}`}>
            <div className="w-12 h-12 rounded-full border-4 border-t-blue-500 border-blue-200 animate-spin mb-4"></div>
            <h3 className="text-lg font-bold">{progress.message || "Converting..."}</h3>
            <div className={`w-full h-2 rounded-full overflow-hidden mt-4 ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200'}`}>
              <div className="bg-blue-600 h-full rounded-full transition-all duration-300" style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}></div>
            </div>
            <p className="mt-2 text-xs opacity-70">
              {progress.current} / {progress.total}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}