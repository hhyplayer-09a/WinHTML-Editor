import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { EditorContent, Editor } from '@tiptap/react';
import { MessageSquarePlus } from 'lucide-react';

interface EditorComponentProps {
  editor: Editor | null;
  isDarkMode: boolean;
  onAddComment: () => void;
}

export const EditorComponent: React.FC<EditorComponentProps> = ({ editor, isDarkMode, onAddComment }) => {
  const [btnCoords, setBtnCoords] = useState<{top: number, left: number} | null>(null);
  const [zoomScale, setZoomScale] = useState(1);
  const btnRef = useRef<HTMLButtonElement>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);

  // Stepless Zoom Logic (Ctrl + Wheel)
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        
        // Determine zoom direction
        // Normalize deltaY (different browsers have different values)
        const delta = -Math.sign(e.deltaY) * 0.1;
        
        setZoomScale(prevScale => {
          const newScale = prevScale + delta;
          // Clamp zoom between 0.5 (50%) and 3.0 (300%)
          return Math.min(Math.max(0.5, newScale), 3.0);
        });
      }
    };

    const container = editorContainerRef.current;
    if (container) {
      container.addEventListener('wheel', handleWheel, { passive: false });
    }

    return () => {
      if (container) {
        container.removeEventListener('wheel', handleWheel);
      }
    };
  }, []);

  // Selection Logic for Button Positioning
  useEffect(() => {
    if (!editor) return;

    const handleSelection = () => {
      const { empty } = editor.state.selection;
      if (empty) {
        setBtnCoords(null);
        return;
      }
      
      const domSel = window.getSelection();
      if (!domSel || domSel.rangeCount === 0) return;
      const rect = domSel.getRangeAt(0).getBoundingClientRect();
      
      // Don't show if selection is collapsed (double check)
      if (rect.width === 0) {
        setBtnCoords(null);
        return;
      }

      setBtnCoords({
        top: rect.top - 40 + window.scrollY, // Position slightly above the selection
        left: rect.right + 10 + window.scrollX, // Position to the right
      });
    };

    // Listen to Tiptap updates
    editor.on('selectionUpdate', handleSelection);
    return () => { editor.off('selectionUpdate', handleSelection); };
  }, [editor]);

  // Mouse Distance Logic for Opacity
  useEffect(() => {
    if (!btnCoords) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!btnRef.current) return;
      
      const rect = btnRef.current.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      
      const dist = Math.hypot(e.clientX - cx, e.clientY - cy);
      
      // Proximity Logic:
      // < 50px: Full Opacity
      // 50px - 150px: Fade Out
      // > 150px: Hidden
      
      let opacity = 0;
      if (dist < 50) {
        opacity = 1;
      } else if (dist < 150) {
        opacity = 1 - (dist - 50) / 100;
      }
      
      // Update opacity directly on DOM for performance
      btnRef.current.style.opacity = String(opacity);
      // Optional: Set pointerEvents to none if invisible to avoid accidental clicks
      btnRef.current.style.pointerEvents = opacity <= 0.05 ? 'none' : 'auto';
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [btnCoords]);

  if (!editor) return null;

  return (
    <div 
      className={`flex-1 overflow-hidden relative flex justify-center transition-colors duration-300 ${isDarkMode ? 'bg-[#202020]' : 'bg-[#f3f3f3]'}`}
      ref={editorContainerRef}
    >
      
      {/* Floating Button via Portal */}
      {btnCoords && createPortal(
        <button 
          ref={btnRef}
          style={{ 
            position: 'absolute', // Absolute relative to document body (portal)
            top: btnCoords.top, 
            left: btnCoords.left, 
            zIndex: 9999,
            transition: 'opacity 0.1s ease-out',
            opacity: 1 // Start visible, mousemove will adjust
          }}
          className="bg-blue-600 text-white p-1.5 rounded-full shadow-lg hover:bg-blue-700 focus:outline-none flex items-center justify-center transform hover:scale-110 transition-transform"
          onClick={(e) => {
             e.preventDefault();
             e.stopPropagation(); // Prevent losing selection
             onAddComment();
          }}
          title="Add Comment"
          onMouseDown={(e) => e.preventDefault()} // Prevent focus loss on click
        >
          <MessageSquarePlus size={16} />
        </button>,
        document.body
      )}

      <div className="h-full w-full overflow-y-auto custom-scrollbar p-2">
        {/* Editor Container with Zoom Transform */}
        <div 
          className={`
            min-h-full shadow-sm border p-[20px] mb-8 transition-colors duration-300 cursor-text
            ${isDarkMode 
              ? 'bg-[#2e2e2e] border-slate-700 text-[#e0e0e0]' 
              : 'bg-white border-slate-200 text-slate-900'
            }
          `} 
          style={{
            transform: `scale(${zoomScale})`,
            transformOrigin: 'top center',
            // Increase width inverse to scale to keep content centered and prevent wrapping changes
            // e.g. at 2x zoom, div needs to be 50% width to look like it's just magnified
            width: `${100 / zoomScale}%`,
            marginLeft: 'auto',
            marginRight: 'auto'
          }}
          onClick={() => editor.chain().focus().run()}
        >
          <div className="w-full h-full">
             <EditorContent editor={editor} />
          </div>
        </div>
      </div>
    </div>
  );
};