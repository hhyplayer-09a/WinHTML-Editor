

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { 
  Bold, 
  Italic, 
  Underline, 
  ListOrdered, 
  Undo, 
  Redo, 
  Highlighter, 
  ChevronDown, 
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Pilcrow,
  Save,
  SaveAll,
  FolderOpen,
  FilePlus,
  Moon,
  Sun,
  MessageSquarePlus,
  MessageSquareOff, // Added
  Sigma,
  ClipboardCopy,
  Download,
  FileText,
  File,
  FileCode,
  Baseline,
  X,
  Check,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Table as TableIcon,
  Monitor,
  Smartphone,
  BoxSelect,
  Globe,
  Image as ImageIcon,
  Sparkles,
  Trash2,
  Eraser, // Added
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Merge,
  Split
} from 'lucide-react';
import { ToolbarProps, FONT_SIZES, FALLBACK_FONTS, HIGHLIGHT_COLORS, TEXT_COLORS, TEXTBOX_THEMES } from '../types';

const ToolbarButton: React.FC<{
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  title?: string;
  className?: string;
  isDarkMode: boolean;
}> = ({ onClick, isActive, disabled, children, title, className = '', isDarkMode }) => (
  <button
    onMouseDown={(e) => e.preventDefault()}
    onClick={onClick}
    disabled={disabled}
    title={title}
    className={`
      p-1.5 rounded-md flex items-center justify-center transition-all duration-200
      ${isActive 
        ? (isDarkMode ? 'bg-blue-900/50 text-blue-300 shadow-sm' : 'bg-blue-100 text-blue-700 shadow-sm')
        : (isDarkMode ? 'hover:bg-slate-700 text-slate-300 hover:text-white' : 'hover:bg-slate-100 text-slate-700 hover:text-slate-900')
      }
      ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
      ${className}
    `}
  >
    {children}
  </button>
);

const Divider = ({ isDarkMode }: { isDarkMode: boolean }) => (
  <div className={`w-px h-5 mx-1 self-center shrink-0 ${isDarkMode ? 'bg-slate-600' : 'bg-slate-300'}`} />
);

// Helper to strip quotes from font names for display
const normalizeFontName = (font: string | null | undefined) => {
  if (!font) return 'Font';
  return font.replace(/['"]/g, '');
};

export const Toolbar: React.FC<ToolbarProps> = ({ 
  editor, 
  isOpen, 
  onToggle, 
  onNew,
  onSave,
  onSaveAs,
  onOpen,
  onExport,
  onPasteMarkdown,
  onPasteWeb,
  onInsertImage,
  onAiImport,
  onAddComment,
  isHighlighterMode,
  toggleHighlighterMode,
  highlighterColor,
  setHighlighterColor,
  isDarkMode,
  toggleDarkMode,
}) => {
  // Global Dropdown State
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });
  const [currentFontColor, setCurrentFontColor] = useState<string>('#000000');
  const [systemFonts, setSystemFonts] = useState<string[]>(FALLBACK_FONTS);

  // Refs for positioning
  const formatBtnRef = useRef<HTMLButtonElement>(null);
  const sizeBtnRef = useRef<HTMLButtonElement>(null);
  const fontBtnRef = useRef<HTMLButtonElement>(null);
  const colorBtnRef = useRef<HTMLDivElement>(null);
  const fontColorBtnRef = useRef<HTMLDivElement>(null);
  const exportBtnRef = useRef<HTMLDivElement>(null);
  const alignBtnRef = useRef<HTMLDivElement>(null);
  const boxBtnRef = useRef<HTMLDivElement>(null);
  const tableBtnRef = useRef<HTMLDivElement>(null);

  // --- Font Detection Logic ---
  useEffect(() => {
    const detectFonts = async () => {
      // Check for Local Font Access API
      if ('queryLocalFonts' in window) {
        try {
          // Note: This requires a permission prompt in the browser
          const fonts = await (window as any).queryLocalFonts();
          // Extract unique families and sort
          const families: string[] = Array.from(new Set(fonts.map((f: any) => f.family))) as string[];
          // Filter out very obscure or long system font names if needed
          const sortedFamilies = families.sort((a, b) => a.localeCompare(b));
          
          // Merge with our fallback but prioritize our fallbacks (like YaHei) at the top
          const merged = Array.from(new Set([...FALLBACK_FONTS, ...sortedFamilies]));
          setSystemFonts(merged);
        } catch (e) {
          console.warn("WinHTML: Local font access denied or failed. Using fallback list.", e);
        }
      }
    };
    detectFonts();
  }, []);

  if (!editor) return null;

  // --- Current Attributes ---
  const currentFontFamily = editor.getAttributes('textStyle').fontFamily;
  const currentFontSize = editor.getAttributes('textStyle').fontSize;

  // --- UI Stability Improvements ---
  useEffect(() => {
    const isEventInsideDropdown = (target: EventTarget | null) => {
       return target instanceof Element && !!target.closest('[data-toolbar-dropdown="true"]');
    };

    const handleScroll = (e: Event) => {
      if (isEventInsideDropdown(e.target)) return;
      if (activeDropdown) setActiveDropdown(null);
    };

    const handleResize = () => {
       if (activeDropdown) setActiveDropdown(null);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && activeDropdown) setActiveDropdown(null);
    };

    window.addEventListener('scroll', handleScroll, { capture: true });
    window.addEventListener('resize', handleResize);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('scroll', handleScroll, { capture: true });
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeDropdown]);

  const toggleDropdown = (name: string, ref: React.RefObject<HTMLElement>) => {
    if (activeDropdown === name) {
      setActiveDropdown(null);
    } else {
      if (ref.current) {
        const rect = ref.current.getBoundingClientRect();
        setDropdownPos({ top: rect.bottom + 4, left: rect.left });
      }
      setActiveDropdown(name);
    }
  };

  const closeDropdown = () => setActiveDropdown(null);

  const toggleHighlight = (colorCode: string | null) => {
    if (colorCode) {
      (editor.chain().focus() as any).toggleHighlight({ color: colorCode }).run();
      setHighlighterColor(colorCode);
    } else {
      (editor.chain().focus() as any).unsetHighlight().run();
    }
    closeDropdown();
  };

  const setFontColor = (color: string | null) => {
    if (color) {
      (editor.chain().focus() as any).setColor(color).run();
      setCurrentFontColor(color);
    } else {
      (editor.chain().focus() as any).unsetColor().run();
      setCurrentFontColor('#000000');
    }
    closeDropdown();
  };

  const setFontSize = (size: string) => {
    editor.chain().focus().setMark('textStyle', { fontSize: size }).run();
    closeDropdown();
  };

  const setFontFamily = (font: string) => {
    (editor.chain().focus() as any).setFontFamily(font).run();
    closeDropdown();
  };

  const setParagraphFormat = (level: 0 | 1 | 2 | 3 | 4 | 5 | 6) => {
    if (level === 0) {
      (editor.chain().focus() as any).setParagraph().run();
    } else {
      (editor.chain().focus() as any).toggleHeading({ level: level as any }).run();
    }
    closeDropdown();
  };

  const setTextAlign = (align: 'left' | 'center' | 'right' | 'justify') => {
    (editor.chain().focus() as any).setTextAlign(align).run();
    closeDropdown();
  };

  // --- Table Operations ---
  const insertTable = () => {
    const rows = window.prompt('Enter number of rows:', '3');
    const cols = window.prompt('Enter number of columns:', '3');
    
    if (rows && cols) {
       const r = parseInt(rows);
       const c = parseInt(cols);
       if (!isNaN(r) && !isNaN(c) && r > 0 && c > 0) {
         (editor.chain().focus() as any)
           .insertContent('<p></p>')
           .insertTable({ rows: r, cols: c, withHeaderRow: true })
           .command(({ tr, state, dispatch }: any) => {
              if (dispatch) {
                const { $head } = state.selection;
                for (let d = $head.depth; d > 0; d--) {
                  if ($head.node(d).type.name === 'table') {
                    const pos = $head.after(d);
                    tr.insert(pos, state.schema.nodes.paragraph.create());
                    return true;
                  }
                }
              }
              return false;
           })
           .run();
       }
    }
    closeDropdown();
  };

  const addColumnBefore = () => { (editor.chain().focus() as any).addColumnBefore().run(); closeDropdown(); };
  const addColumnAfter = () => { (editor.chain().focus() as any).addColumnAfter().run(); closeDropdown(); };
  const deleteColumn = () => { (editor.chain().focus() as any).deleteColumn().run(); closeDropdown(); };
  const addRowBefore = () => { (editor.chain().focus() as any).addRowBefore().run(); closeDropdown(); };
  const addRowAfter = () => { (editor.chain().focus() as any).addRowAfter().run(); closeDropdown(); };
  const deleteRow = () => { (editor.chain().focus() as any).deleteRow().run(); closeDropdown(); };
  const deleteTable = () => { (editor.chain().focus() as any).deleteTable().run(); closeDropdown(); };
  const mergeCells = () => { (editor.chain().focus() as any).mergeCells().run(); closeDropdown(); };
  const splitCell = () => { (editor.chain().focus() as any).splitCell().run(); closeDropdown(); };
  
  const insertTextBox = (bg: string, border: string) => {
    editor.chain().focus()
      .command(({ tr, state, dispatch }) => {
        if (dispatch) {
          const { $from } = state.selection;
          const pos = $from.before($from.depth);
          tr.insert(pos, state.schema.nodes.paragraph.create());
          return true;
        }
        return false;
      })
      .wrapIn('textBox', { backgroundColor: bg, borderColor: border })
      .command(({ tr, state, dispatch }) => {
        if (dispatch) {
          const { $head } = state.selection;
          for (let d = $head.depth; d > 0; d--) {
            if ($head.node(d).type.name === 'textBox') {
              const pos = $head.after(d);
              tr.insert(pos, state.schema.nodes.paragraph.create());
              return true;
            }
          }
        }
        return false;
      })
      .run();
    closeDropdown();
  };

  // --- Deletion Handlers ---
  const removeComment = () => {
    (editor.chain().focus() as any).unsetMark('comment').run();
  };

  const removeTextBox = () => {
      // Lift removes the wrapper, keeping content
      (editor.chain().focus() as any).lift('textBox').run();
      closeDropdown();
  };

  const deleteTextBox = () => {
      // Deletes the node entirely
      (editor.chain().focus() as any).deleteNode('textBox').run();
      closeDropdown();
  };

  const addMath = () => {
    const previousLatex = editor.isActive('math') ? editor.getAttributes('math').latex : '';
    const latex = window.prompt('Enter LaTeX formula (e.g., E = mc^2 or \\mathrm{H_2O}):', previousLatex);
    if (latex === null) return;
    if (latex === '') return;
    editor.chain().focus().insertContent({ type: 'math', attrs: { latex } }).run();
  };

  // Simplified labels: H1, H2, P
  const getCurrentFormatLabel = () => {
    if (editor.isActive('heading', { level: 1 })) return 'H1';
    if (editor.isActive('heading', { level: 2 })) return 'H2';
    if (editor.isActive('heading', { level: 3 })) return 'H3';
    if (editor.isActive('heading', { level: 4 })) return 'H4';
    if (editor.isActive('heading', { level: 5 })) return 'H5';
    if (editor.isActive('heading', { level: 6 })) return 'H6';
    return 'P';
  };

  const dropdownBg = isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200';
  const dropdownHover = isDarkMode ? 'hover:bg-slate-700 text-slate-200' : 'hover:bg-slate-50 text-slate-900';

  return (
    <div 
      className={`flex flex-col w-full border-b shadow-sm z-10 transition-colors duration-300 ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).tagName !== 'INPUT' && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
           e.preventDefault();
        }
      }}
    >
      <div 
        className={`h-2 w-full flex justify-center items-center cursor-pointer group transition-colors ${isDarkMode ? 'hover:bg-slate-700' : 'hover:bg-slate-50'}`}
        onClick={onToggle}
        onMouseDown={(e) => e.preventDefault()}
        title={isOpen ? "Collapse Toolbar" : "Expand Toolbar"}
      >
        <div className={`w-12 h-1 rounded-full transition-colors ${isDarkMode ? 'bg-slate-600 group-hover:bg-slate-500' : 'bg-slate-300 group-hover:bg-slate-400'}`} />
      </div>

      {isOpen && (
        <div className="flex items-center px-2 py-1.5 gap-0.5 overflow-x-auto custom-scrollbar animate-in slide-in-from-top-2 duration-200">
          
          {/* Group 1: File Operations */}
          <div className="flex gap-0.5">
            <ToolbarButton onClick={onNew} title="New HTML File" isDarkMode={isDarkMode}>
              <FilePlus size={18} />
            </ToolbarButton>
            <ToolbarButton onClick={onOpen} title="Open HTML File" isDarkMode={isDarkMode}>
              <FolderOpen size={18} />
            </ToolbarButton>
            <ToolbarButton onClick={onSave} title="Save HTML File" isDarkMode={isDarkMode}>
              <Save size={18} />
            </ToolbarButton>
            <ToolbarButton onClick={onSaveAs} title="Save As..." isDarkMode={isDarkMode}>
              <SaveAll size={18} />
            </ToolbarButton>
          </div>

          <Divider isDarkMode={isDarkMode} />
          
          {/* Group 2: Export */}
          <div className="relative">
             <ToolbarButton 
               onClick={() => toggleDropdown('export', exportBtnRef)} 
               title="Export as PDF, DOCX, PNG, MD" 
               isDarkMode={isDarkMode}
             >
               <div ref={exportBtnRef} className="flex items-center gap-1">
                 <Download size={18} />
                 <ChevronDown size={12} className="opacity-70" />
               </div>
             </ToolbarButton>
             
             {activeDropdown === 'export' && createPortal(
              <>
                <div className="fixed inset-0 z-[50]" onClick={closeDropdown} onMouseDown={(e) => e.preventDefault()} />
                <div 
                  data-toolbar-dropdown="true"
                  className={`fixed z-[51] rounded-lg shadow-xl py-1 flex flex-col border ${dropdownBg}`}
                  style={{ top: dropdownPos.top, left: dropdownPos.left, minWidth: '180px' }}
                  onMouseDown={(e) => e.preventDefault()}
                >
                  <button onMouseDown={(e) => e.preventDefault()} className={`flex items-center gap-2 px-3 py-2 text-left text-sm ${dropdownHover}`} onClick={() => { onExport('pdf'); closeDropdown(); }}>
                    <FileText size={16} /> Export as PDF
                  </button>
                  <button onMouseDown={(e) => e.preventDefault()} className={`flex items-center gap-2 px-3 py-2 text-left text-sm ${dropdownHover}`} onClick={() => { onExport('docx'); closeDropdown(); }}>
                    <File size={16} /> Export as DOCX
                  </button>
                  <div className={`my-1 border-t ${isDarkMode ? 'border-slate-700' : 'border-slate-200'}`} />
                  <button onMouseDown={(e) => e.preventDefault()} className={`flex items-center gap-2 px-3 py-2 text-left text-sm ${dropdownHover}`} onClick={() => { onExport('png-desktop'); closeDropdown(); }}>
                    <Monitor size={16} /> PNG (Desktop)
                  </button>
                  <button onMouseDown={(e) => e.preventDefault()} className={`flex items-center gap-2 px-3 py-2 text-left text-sm ${dropdownHover}`} onClick={() => { onExport('png-mobile'); closeDropdown(); }}>
                    <Smartphone size={16} /> PNG (Mobile)
                  </button>
                  <div className={`my-1 border-t ${isDarkMode ? 'border-slate-700' : 'border-slate-200'}`} />
                  <button onMouseDown={(e) => e.preventDefault()} className={`flex items-center gap-2 px-3 py-2 text-left text-sm ${dropdownHover}`} onClick={() => { onExport('md'); closeDropdown(); }}>
                    <FileCode size={16} /> Export as Markdown
                  </button>
                </div>
              </>,
              document.body
            )}
          </div>
          
          <Divider isDarkMode={isDarkMode} />

          {/* Group 3: Import/Clipboard + AI */}
           <div className="flex gap-0.5">
             <ToolbarButton onClick={onInsertImage} title="Insert Image from File" isDarkMode={isDarkMode}>
              <ImageIcon size={18} />
            </ToolbarButton>
             <ToolbarButton onClick={onPasteWeb} title="Paste from Web (Clean)" isDarkMode={isDarkMode}>
              <Globe size={18} />
            </ToolbarButton>
             <ToolbarButton onClick={onPasteMarkdown} title="Paste as Markdown" isDarkMode={isDarkMode}>
              <ClipboardCopy size={18} />
            </ToolbarButton>
             <ToolbarButton 
               onClick={onAiImport} 
               title="Import File via AI (PDF/Image)" 
               isDarkMode={isDarkMode}
               className={isDarkMode ? 'text-purple-300' : 'text-purple-600'}
             >
              <Sparkles size={18} />
            </ToolbarButton>
          </div>

          <Divider isDarkMode={isDarkMode} />

          {/* Group 4: Undo/Redo */}
          <div className="flex gap-0.5">
            <ToolbarButton onClick={() => (editor.chain().focus() as any).undo().run()} disabled={!(editor.can() as any).undo()} title="Undo (Ctrl+Z)" isDarkMode={isDarkMode}><Undo size={18} /></ToolbarButton>
            <ToolbarButton onClick={() => (editor.chain().focus() as any).redo().run()} disabled={!(editor.can() as any).redo()} title="Redo (Ctrl+Y)" isDarkMode={isDarkMode}><Redo size={18} /></ToolbarButton>
          </div>

          <Divider isDarkMode={isDarkMode} />

          {/* Group 5: Formatting (including Align) */}
          <div className="flex gap-0.5">
            <ToolbarButton onClick={() => (editor.chain().focus() as any).toggleBold().run()} isActive={editor.isActive('bold')} title="Bold" isDarkMode={isDarkMode}><Bold size={18} /></ToolbarButton>
            <ToolbarButton onClick={() => (editor.chain().focus() as any).toggleItalic().run()} isActive={editor.isActive('italic')} title="Italic" isDarkMode={isDarkMode}><Italic size={18} /></ToolbarButton>
            <ToolbarButton onClick={() => (editor.chain().focus() as any).toggleUnderline().run()} isActive={editor.isActive('underline')} title="Underline" isDarkMode={isDarkMode}><Underline size={18} /></ToolbarButton>
            
            <div className="relative">
              <ToolbarButton onClick={() => toggleDropdown('fontColor', fontColorBtnRef)} title="Font Color" isDarkMode={isDarkMode}>
                 <div ref={fontColorBtnRef} className="flex flex-col items-center">
                    <Baseline size={18} />
                    <div className="w-full h-0.5 mt-0.5 rounded-full" style={{ backgroundColor: currentFontColor }} />
                 </div>
              </ToolbarButton>
              {activeDropdown === 'fontColor' && createPortal(
                <>
                  <div className="fixed inset-0 z-[50]" onClick={closeDropdown} onMouseDown={(e) => e.preventDefault()} />
                  <div onMouseDown={(e) => e.preventDefault()} data-toolbar-dropdown="true" className={`fixed z-[51] rounded-lg shadow-xl p-2 flex gap-2 border ${dropdownBg}`} style={{ top: dropdownPos.top, left: dropdownPos.left }}>
                    {Object.entries(TEXT_COLORS).map(([name, code]) => (
                      <button onMouseDown={(e) => e.preventDefault()} key={name} onClick={() => setFontColor(code)} className="w-6 h-6 rounded-md border border-slate-300 hover:scale-110 transition-transform" style={{ backgroundColor: code }} title={name} />
                    ))}
                    <button onMouseDown={(e) => e.preventDefault()} onClick={() => setFontColor(null)} className={`w-6 h-6 rounded-md border border-slate-300 flex items-center justify-center text-xs hover:scale-110 transition-transform ${isDarkMode ? 'bg-slate-700 text-white' : 'bg-white text-slate-500'}`} title="Reset Color"><X size={14} /></button>
                  </div>
                </>,
                document.body
              )}
            </div>

            {/* Align Button merged here */}
            <div className="relative">
              <ToolbarButton onClick={() => toggleDropdown('align', alignBtnRef)} title="Text Alignment" isDarkMode={isDarkMode}>
                  <div ref={alignBtnRef} className="flex items-center">
                    {editor.isActive({ textAlign: 'center' }) ? <AlignCenter size={18} /> : 
                    editor.isActive({ textAlign: 'right' }) ? <AlignRight size={18} /> :
                    editor.isActive({ textAlign: 'justify' }) ? <AlignJustify size={18} /> :
                    <AlignLeft size={18} />}
                    <ChevronDown size={12} className="ml-0.5 opacity-50"/>
                  </div>
              </ToolbarButton>
              {activeDropdown === 'align' && createPortal(
                <>
                  <div className="fixed inset-0 z-[50]" onClick={closeDropdown} onMouseDown={(e) => e.preventDefault()} />
                  <div 
                    data-toolbar-dropdown="true"
                    className={`fixed z-[51] rounded-lg shadow-xl p-1 flex gap-1 border ${dropdownBg}`}
                    style={{ top: dropdownPos.top, left: dropdownPos.left }}
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    <ToolbarButton onClick={() => setTextAlign('left')} isActive={editor.isActive({ textAlign: 'left' })} title="Align Left" isDarkMode={isDarkMode}><AlignLeft size={18} /></ToolbarButton>
                    <ToolbarButton onClick={() => setTextAlign('center')} isActive={editor.isActive({ textAlign: 'center' })} title="Align Center" isDarkMode={isDarkMode}><AlignCenter size={18} /></ToolbarButton>
                    <ToolbarButton onClick={() => setTextAlign('right')} isActive={editor.isActive({ textAlign: 'right' })} title="Align Right" isDarkMode={isDarkMode}><AlignRight size={18} /></ToolbarButton>
                    <ToolbarButton onClick={() => setTextAlign('justify')} isActive={editor.isActive({ textAlign: 'justify' })} title="Justify" isDarkMode={isDarkMode}><AlignJustify size={18} /></ToolbarButton>
                  </div>
                </>,
                document.body
              )}
            </div>
          </div>

          <Divider isDarkMode={isDarkMode} />
          
          {/* Group 6: Insert Objects */}
          <div className="flex gap-0.5">
             <ToolbarButton onClick={addMath} isActive={editor.isActive('math')} title="Insert Math" isDarkMode={isDarkMode}><Sigma size={18} /></ToolbarButton>
             
             {/* Comments */}
             <ToolbarButton onClick={onAddComment} isActive={editor.isActive('comment')} title={editor.isActive('comment') ? "Edit Comment" : "Add Comment"} isDarkMode={isDarkMode}><MessageSquarePlus size={18} /></ToolbarButton>
             {editor.isActive('comment') && (
               <ToolbarButton onClick={removeComment} title="Remove Comment" isDarkMode={isDarkMode} className="text-red-500 hover:text-red-600"><MessageSquareOff size={18} /></ToolbarButton>
             )}
             
             {/* Table Dropdown */}
             <div className="relative">
               <ToolbarButton onClick={() => toggleDropdown('table', tableBtnRef)} isActive={editor.isActive('table')} title="Table Operations" isDarkMode={isDarkMode}>
                 <div ref={tableBtnRef} className="flex items-center">
                   <TableIcon size={18} />
                   <ChevronDown size={12} className="ml-0.5 opacity-50"/>
                 </div>
               </ToolbarButton>
               {activeDropdown === 'table' && createPortal(
                 <>
                   <div className="fixed inset-0 z-[50]" onClick={closeDropdown} onMouseDown={(e) => e.preventDefault()} />
                   <div 
                     data-toolbar-dropdown="true"
                     className={`fixed z-[51] rounded-lg shadow-xl py-1 flex flex-col border ${dropdownBg}`}
                     style={{ top: dropdownPos.top, left: dropdownPos.left, minWidth: '180px' }}
                     onMouseDown={(e) => e.preventDefault()}
                   >
                     <button onMouseDown={(e) => e.preventDefault()} className={`flex items-center gap-2 px-3 py-2 text-left text-sm ${dropdownHover}`} onClick={insertTable}>
                       <TableIcon size={16} /> Insert New Table
                     </button>
                     
                     {editor.isActive('table') && (
                       <>
                         <div className={`my-1 border-t ${isDarkMode ? 'border-slate-700' : 'border-slate-200'}`} />
                         
                         <div className="px-3 py-1 text-xs font-bold uppercase opacity-50">Row</div>
                         <button onMouseDown={(e) => e.preventDefault()} className={`flex items-center gap-2 px-3 py-2 text-left text-sm ${dropdownHover}`} onClick={addRowBefore}>
                           <ArrowUp size={16} /> Add Row Before
                         </button>
                         <button onMouseDown={(e) => e.preventDefault()} className={`flex items-center gap-2 px-3 py-2 text-left text-sm ${dropdownHover}`} onClick={addRowAfter}>
                           <ArrowDown size={16} /> Add Row After
                         </button>
                         <button onMouseDown={(e) => e.preventDefault()} className={`flex items-center gap-2 px-3 py-2 text-left text-sm text-red-500 hover:text-red-600 ${isDarkMode ? 'hover:bg-red-900/20' : 'hover:bg-red-50'}`} onClick={deleteRow}>
                           <Trash2 size={16} /> Delete Row
                         </button>

                         <div className="px-3 py-1 text-xs font-bold uppercase opacity-50 mt-1">Column</div>
                         <button onMouseDown={(e) => e.preventDefault()} className={`flex items-center gap-2 px-3 py-2 text-left text-sm ${dropdownHover}`} onClick={addColumnBefore}>
                           <ArrowLeft size={16} /> Add Col Before
                         </button>
                         <button onMouseDown={(e) => e.preventDefault()} className={`flex items-center gap-2 px-3 py-2 text-left text-sm ${dropdownHover}`} onClick={addColumnAfter}>
                           <ArrowRight size={16} /> Add Col After
                         </button>
                         <button onMouseDown={(e) => e.preventDefault()} className={`flex items-center gap-2 px-3 py-2 text-left text-sm text-red-500 hover:text-red-600 ${isDarkMode ? 'hover:bg-red-900/20' : 'hover:bg-red-50'}`} onClick={deleteColumn}>
                           <Trash2 size={16} /> Delete Column
                         </button>

                         <div className={`my-1 border-t ${isDarkMode ? 'border-slate-700' : 'border-slate-200'}`} />
                         
                         <button onMouseDown={(e) => e.preventDefault()} className={`flex items-center gap-2 px-3 py-2 text-left text-sm ${dropdownHover}`} onClick={mergeCells}>
                           <Merge size={16} /> Merge Cells
                         </button>
                         <button onMouseDown={(e) => e.preventDefault()} className={`flex items-center gap-2 px-3 py-2 text-left text-sm ${dropdownHover}`} onClick={splitCell}>
                           <Split size={16} /> Split Cell
                         </button>
                         <button onMouseDown={(e) => e.preventDefault()} className={`flex items-center gap-2 px-3 py-2 text-left text-sm text-red-600 font-medium hover:text-red-700 ${isDarkMode ? 'hover:bg-red-900/20' : 'hover:bg-red-50'}`} onClick={deleteTable}>
                           <Trash2 size={16} /> Delete Table
                         </button>
                       </>
                     )}
                   </div>
                 </>,
                 document.body
               )}
             </div>
             
             <div className="relative">
                <ToolbarButton onClick={() => toggleDropdown('box', boxBtnRef)} isActive={editor.isActive('textBox')} title="Insert Text Box" isDarkMode={isDarkMode}>
                    <div ref={boxBtnRef} className="flex items-center">
                       <BoxSelect size={18} />
                       <ChevronDown size={12} className="ml-0.5 opacity-50"/>
                    </div>
                </ToolbarButton>
                {activeDropdown === 'box' && createPortal(
                  <>
                    <div className="fixed inset-0 z-[50]" onClick={closeDropdown} onMouseDown={(e) => e.preventDefault()} />
                    <div onMouseDown={(e) => e.preventDefault()} data-toolbar-dropdown="true" className={`fixed z-[51] rounded-lg shadow-xl py-1 flex flex-col border ${dropdownBg}`} style={{ top: dropdownPos.top, left: dropdownPos.left, minWidth: '150px' }}>
                       {TEXTBOX_THEMES.map(theme => (
                         <button 
                           key={theme.name}
                           onMouseDown={(e) => e.preventDefault()} 
                           className={`flex items-center gap-2 px-3 py-2 text-left text-sm ${dropdownHover}`} 
                           onClick={() => insertTextBox(theme.bg, theme.border)}
                         >
                           <span className="w-3 h-3 rounded-full border border-gray-300" style={{ backgroundColor: theme.bg, borderColor: theme.border }}></span>
                           {theme.label}
                         </button>
                       ))}

                       {editor.isActive('textBox') && (
                         <>
                           <div className={`my-1 border-t ${isDarkMode ? 'border-slate-700' : 'border-slate-200'}`} />
                           <button onMouseDown={(e) => e.preventDefault()} className={`flex items-center gap-2 px-3 py-2 text-left text-sm ${dropdownHover}`} onClick={removeTextBox}>
                             <Eraser size={16} /> Remove Box (Keep Text)
                           </button>
                           <button onMouseDown={(e) => e.preventDefault()} className={`flex items-center gap-2 px-3 py-2 text-left text-sm text-red-500 hover:text-red-600 ${isDarkMode ? 'hover:bg-red-900/20' : 'hover:bg-red-50'}`} onClick={deleteTextBox}>
                             <Trash2 size={16} /> Delete Text Box
                           </button>
                         </>
                       )}
                    </div>
                  </>,
                  document.body
               )}
             </div>
          </div>

          <Divider isDarkMode={isDarkMode} />

          {/* Group 7: Paragraph Format & Numbered List */}
          <div className="flex gap-0.5">
            <div className="relative">
              <button
                ref={formatBtnRef}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => toggleDropdown('format', formatBtnRef)}
                className={`flex items-center gap-1 px-2 py-1.5 rounded-md text-sm font-medium min-w-[60px] justify-between transition-colors ${isDarkMode ? 'hover:bg-slate-700 text-slate-300' : 'hover:bg-slate-100 text-slate-700'}`}
                title="Paragraph Format"
              >
                <span>{getCurrentFormatLabel()}</span>
                <ChevronDown size={14} />
              </button>
              {activeDropdown === 'format' && createPortal(
                <>
                  <div className="fixed inset-0 z-[50]" onClick={closeDropdown} onMouseDown={(e) => e.preventDefault()} />
                  <div onMouseDown={(e) => e.preventDefault()} data-toolbar-dropdown="true" className={`fixed z-[51] rounded-lg shadow-xl py-1 flex flex-col border ${dropdownBg} max-h-60 overflow-y-auto`} style={{ top: dropdownPos.top, left: dropdownPos.left, minWidth: '160px' }}>
                    <button onMouseDown={(e) => e.preventDefault()} className={`flex items-center gap-2 px-3 py-2 text-left text-sm ${dropdownHover}`} onClick={() => setParagraphFormat(0)}><Pilcrow size={14} /> Paragraph</button>
                    <button onMouseDown={(e) => e.preventDefault()} className={`flex items-center gap-2 px-3 py-2 text-left text-sm font-bold text-2xl ${dropdownHover}`} onClick={() => setParagraphFormat(1)}><Heading1 size={20} /> Heading 1</button>
                    <button onMouseDown={(e) => e.preventDefault()} className={`flex items-center gap-2 px-3 py-2 text-left text-sm font-bold text-xl ${dropdownHover}`} onClick={() => setParagraphFormat(2)}><Heading2 size={18} /> Heading 2</button>
                    <button onMouseDown={(e) => e.preventDefault()} className={`flex items-center gap-2 px-3 py-2 text-left text-sm font-bold text-lg ${dropdownHover}`} onClick={() => setParagraphFormat(3)}><Heading3 size={16} /> Heading 3</button>
                    <button onMouseDown={(e) => e.preventDefault()} className={`flex items-center gap-2 px-3 py-2 text-left text-sm font-bold text-base ${dropdownHover}`} onClick={() => setParagraphFormat(4)}><Heading4 size={14} /> Heading 4</button>
                  </div>
                </>,
                document.body
              )}
            </div>
            
            <ToolbarButton onClick={() => (editor.chain().focus() as any).toggleOrderedList().run()} isActive={editor.isActive('orderedList')} title="Numbered List" isDarkMode={isDarkMode}><ListOrdered size={18} /></ToolbarButton>
          </div>

          <Divider isDarkMode={isDarkMode} />

          {/* Group 8: Font Family & Size */}
          <div className="flex gap-0.5">
            <div className="relative">
              <button
                ref={fontBtnRef}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => toggleDropdown('font', fontBtnRef)}
                className={`flex items-center gap-1 px-2 py-1.5 rounded-md text-sm font-medium transition-colors ${isDarkMode ? 'hover:bg-slate-700 text-slate-300' : 'hover:bg-slate-100 text-slate-700'}`}
                title="Font Family"
              >
                <span className="text-xs font-semibold mr-1">
                  Font
                </span>
                <ChevronDown size={14} />
              </button>
              {activeDropdown === 'font' && createPortal(
                <>
                  <div className="fixed inset-0 z-[50]" onClick={closeDropdown} onMouseDown={(e) => e.preventDefault()} />
                  <div 
                    data-toolbar-dropdown="true" 
                    className={`fixed z-[51] rounded-lg shadow-xl py-1 w-64 max-h-80 overflow-y-auto border ${dropdownBg} custom-scrollbar`} 
                    style={{ top: dropdownPos.top, left: dropdownPos.left }}
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    <div className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200 mb-1">System Fonts</div>
                    {systemFonts.map((font) => {
                      const isSelected = normalizeFontName(currentFontFamily) === normalizeFontName(font);
                      return (
                        <button
                          onMouseDown={(e) => e.preventDefault()}
                          key={font}
                          onClick={() => setFontFamily(font)}
                          className={`w-full text-left px-3 py-2 text-sm flex justify-between items-center ${dropdownHover} ${isSelected ? (isDarkMode ? 'bg-blue-900/30 text-blue-300' : 'bg-blue-50 text-blue-700') : ''}`}
                          style={{ fontFamily: font }}
                        >
                          <span className="truncate">{font}</span>
                          {isSelected && <Check size={14} />}
                        </button>
                      );
                    })}
                    <button
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { (editor.chain().focus() as any).unsetFontFamily().run(); closeDropdown(); }}
                      className={`w-full text-left px-3 py-2 text-sm border-t mt-1 font-bold ${dropdownHover}`}
                    >
                      Default Font
                    </button>
                  </div>
                </>,
                document.body
              )}
            </div>

            <div className="relative">
              <button
                ref={sizeBtnRef}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => toggleDropdown('size', sizeBtnRef)}
                className={`flex items-center gap-1 px-2 py-1.5 rounded-md text-sm font-medium transition-colors ${isDarkMode ? 'hover:bg-slate-700 text-slate-300' : 'hover:bg-slate-100 text-slate-700'}`}
                title="Font Size"
              >
                <span className="text-xs font-bold">{currentFontSize || 'px'}</span>
                <ChevronDown size={14} />
              </button>
              {activeDropdown === 'size' && createPortal(
                <>
                  <div className="fixed inset-0 z-[50]" onClick={closeDropdown} onMouseDown={(e) => e.preventDefault()} />
                  <div onMouseDown={(e) => e.preventDefault()} data-toolbar-dropdown="true" className={`fixed z-[51] rounded-lg shadow-xl py-1 w-24 max-h-60 overflow-y-auto border ${dropdownBg}`} style={{ top: dropdownPos.top, left: dropdownPos.left }}>
                    {FONT_SIZES.map((size) => (
                      <button onMouseDown={(e) => e.preventDefault()} key={size.value} onClick={() => setFontSize(size.value)} className={`w-full text-left px-3 py-1.5 text-sm ${dropdownHover}`}>{size.label}</button>
                    ))}
                  </div>
                </>,
                document.body
              )}
            </div>
          </div>

          <Divider isDarkMode={isDarkMode} />

          {/* Group 9: Highlight & Pen Mode */}
          <div className="flex items-center gap-1">
            <div className="relative">
              <ToolbarButton onClick={() => toggleDropdown('color', colorBtnRef)} title="Highlight Color" isDarkMode={isDarkMode}>
                 <div ref={colorBtnRef} className="flex items-center">
                    <Highlighter size={18} />
                    <div className="w-3 h-3 rounded-full border border-slate-300 ml-1" style={{ backgroundColor: highlighterColor }} />
                    <ChevronDown size={12} className="ml-1 opacity-50"/>
                 </div>
              </ToolbarButton>
              {activeDropdown === 'color' && createPortal(
                <>
                  <div className="fixed inset-0 z-[50]" onClick={closeDropdown} onMouseDown={(e) => e.preventDefault()} />
                  <div onMouseDown={(e) => e.preventDefault()} data-toolbar-dropdown="true" className={`fixed z-[51] rounded-lg shadow-xl p-2 flex gap-2 border ${dropdownBg}`} style={{ top: dropdownPos.top, left: dropdownPos.left }}>
                    {Object.entries(HIGHLIGHT_COLORS).map(([name, code]) => (
                      <button onMouseDown={(e) => e.preventDefault()} key={name} onClick={() => toggleHighlight(code)} className="w-6 h-6 rounded-full border border-slate-300 hover:scale-110 transition-transform" style={{ backgroundColor: code }} title={name} />
                    ))}
                    <button onMouseDown={(e) => e.preventDefault()} onClick={() => toggleHighlight(null)} className="w-6 h-6 rounded-full bg-white border border-slate-300 flex items-center justify-center text-slate-500 text-xs hover:scale-110 transition-transform" title="No Highlight"><X size={14} /></button>
                  </div>
                </>,
                document.body
              )}
            </div>

            <button onMouseDown={(e) => e.preventDefault()} onClick={toggleHighlighterMode} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${isHighlighterMode ? 'bg-blue-600' : (isDarkMode ? 'bg-slate-600' : 'bg-slate-200')}`} title="Auto-Highlight Mode">
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isHighlighterMode ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>

          <Divider isDarkMode={isDarkMode} />

          {/* Group 10: Theme */}
           <div className="flex gap-0.5">
             <ToolbarButton onClick={toggleDarkMode} title={isDarkMode ? "Light Mode" : "Dark Mode"} isDarkMode={isDarkMode}>
              {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
            </ToolbarButton>
          </div>
          
        </div>
      )}
    </div>
  );
}