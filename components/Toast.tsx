import React, { useEffect } from 'react';
import { Check, AlertCircle } from 'lucide-react';

export type ToastType = 'success' | 'error';

interface ToastProps {
  message: string;
  type?: ToastType;
  isVisible: boolean;
  onClose: () => void;
}

export const Toast: React.FC<ToastProps> = ({ message, type = 'success', isVisible, onClose }) => {
  useEffect(() => {
    if (isVisible) {
      // Errors stay a bit longer (4s) than success messages (2s)
      const duration = type === 'error' ? 4000 : 2000;
      const timer = setTimeout(onClose, duration);
      return () => clearTimeout(timer);
    }
  }, [isVisible, onClose, type]);

  if (!isVisible) return null;

  const isError = type === 'error';

  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[150] animate-in fade-in slide-in-from-bottom-4 duration-300 pointer-events-none">
      <div className={`
        backdrop-blur-md text-white px-4 py-2 rounded-full shadow-2xl flex items-center gap-2 text-sm font-medium border
        ${isError 
          ? 'bg-red-600/95 border-red-500 shadow-red-900/20' 
          : 'bg-slate-800/90 border-slate-700 shadow-slate-900/20'
        }
      `}>
        <div className={`rounded-full p-0.5 ${isError ? 'bg-red-500' : 'bg-green-500'}`}>
            {isError ? <AlertCircle size={12} className="text-white" strokeWidth={3} /> : <Check size={12} className="text-white" strokeWidth={3} />}
        </div>
        {message}
      </div>
    </div>
  );
};