import { AlertTriangle } from 'lucide-react';

interface WarningConfirmModalProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  message: string;
}

export function WarningConfirmModal({ isOpen, onConfirm, onCancel, title, message }: WarningConfirmModalProps) {
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[#f5f3ed] rounded-3xl shadow-xl p-8 max-w-md w-full mx-4">
        <div className="flex flex-col items-center text-center">
          <div className="w-16 h-16 bg-[#ff8c42]/20 rounded-full flex items-center justify-center mb-4">
            <AlertTriangle className="w-8 h-8 text-[#ff8c42]" />
          </div>
          <h2 className="font-serif text-2xl text-[#4a3c2a] mb-3">{title}</h2>
          <p className="text-[#6b5d4f] mb-6">{message}</p>
          <div className="flex gap-4">
            <button
              onClick={onCancel}
              className="bg-[#8b7355] text-white px-8 py-2.5 rounded-full shadow-md hover:bg-[#6b5d4f] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              className="bg-[#ff8c42] text-white px-8 py-2.5 rounded-full shadow-md hover:bg-[#ff7a2e] transition-colors"
            >
              Ok
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
