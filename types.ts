

import { Editor } from '@tiptap/react';

export interface EditorProps {
  editor: Editor | null;
  isDarkMode: boolean;
  onAddComment: () => void;
}

export type ExportType = 'pdf' | 'docx' | 'png' | 'png-desktop' | 'png-mobile' | 'md';
export type FileSource = 'NEW' | 'PATH' | 'IMPORTED';

export type AiProvider = 'zhipu' | 'openai' | 'ollama' | 'lmstudio' | 'custom';

export interface AiSettings {
  provider: AiProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface ToolbarProps extends EditorProps {
  isOpen: boolean;
  onToggle: () => void;
  onNew: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onOpen: () => void;
  onExport: (type: ExportType) => void;
  onPasteMarkdown: () => void;
  onPasteWeb: () => void; 
  onInsertImage: () => void; 
  onAiImport: () => void; // Added
  isHighlighterMode: boolean;
  toggleHighlighterMode: () => void;
  highlighterColor: string;
  setHighlighterColor: (color: string) => void;
  toggleDarkMode: () => void;
}

export interface FileMenuProps extends EditorProps {
  onLoad: (content: string) => void;
  fileName: string;
  setFileName: (name: string) => void;
}

export type HighlightColor = 'yellow' | 'green' | 'cyan' | 'pink' | null;

export const FONT_SIZES = [
  { label: '12px', value: '12px' },
  { label: '14px', value: '14px' },
  { label: '16px', value: '16px' },
  { label: '18px', value: '18px' },
  { label: '24px', value: '24px' },
  { label: '30px', value: '30px' },
  { label: '36px', value: '36px' },
];

export const FALLBACK_FONTS = [
  "Microsoft YaHei UI",
  "Microsoft YaHei",
  "SimSun",
  "SimHei",
  "KaiTi",
  "Arial",
  "Segoe UI",
  "Times New Roman",
  "Tahoma",
  "Verdana",
  "Georgia",
  "Courier New",
  "JetBrains Mono",
  "Consolas"
];

export const HIGHLIGHT_COLORS: Record<string, string> = {
  yellow: '#fff59d',
  green: '#a5d6a7',
  cyan: '#80deea',
  pink: '#f48fb1',
};

export const TEXT_COLORS: Record<string, string> = {
  black: '#000000',
  red: '#e53935',
  blue: '#1e88e5',
  green: '#43a047',
  orange: '#fb8c00',
  purple: '#8e24aa',
  gray: '#757575',
};

export interface TextBoxTheme {
  name: string;
  bg: string;
  border: string;
  label: string;
}

export const TEXTBOX_THEMES: TextBoxTheme[] = [
  { name: 'default', bg: '#f9fafb', border: '#d1d5db', label: 'Default (Gray)' },
  { name: 'info', bg: '#eff6ff', border: '#3b82f6', label: 'Info (Blue)' },
  { name: 'success', bg: '#f0fdf4', border: '#22c55e', label: 'Success (Green)' },
  { name: 'warning', bg: '#fefce8', border: '#eab308', label: 'Warning (Yellow)' },
  { name: 'error', bg: '#fef2f2', border: '#ef4444', label: 'Error (Red)' },
];

// Darker, more saturated versions for better visibility on dark backgrounds
export const DARK_MODE_HIGHLIGHT_COLORS: Record<string, string> = {
  yellow: '#fbc02d', // Darker yellow
  green: '#388e3c',  // Darker green
  cyan: '#0097a7',   // Darker cyan
  pink: '#c2185b',   // Darker pink
};