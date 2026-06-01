import { Check } from 'lucide-react';
import { PASSWORD_REQUIREMENTS } from '../lib/passwordValidation';

interface PasswordRequirementsListProps {
  password: string;
  className?: string;
}

export function PasswordRequirementsList({ password, className }: PasswordRequirementsListProps) {
  return (
    <div className={className ?? 'bg-[#fde8d8] rounded-2xl p-5 border border-[#e0d5c7]'}>
      <h3 className="font-serif text-base text-[#9e2a2b] mb-3">Password Requirements</h3>
      <div className="space-y-2">
        {PASSWORD_REQUIREMENTS.map((requirement) => {
          const met = requirement.test(password);
          return (
            <div key={requirement.text} className="flex items-center gap-2">
              <div
                className={`w-4 h-4 rounded-full flex items-center justify-center ${
                  met ? 'bg-green-500' : 'bg-gray-300'
                }`}
              >
                {met && <Check className="w-2.5 h-2.5 text-white" />}
              </div>
              <span className={`text-xs ${met ? 'text-green-700' : 'text-[#8b7355]'}`}>
                {requirement.text}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
