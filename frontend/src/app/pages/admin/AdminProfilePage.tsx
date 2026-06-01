import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Navigation } from '../../components/Navigation';
import { Footer } from '../../components/Footer';
import { PasswordInput } from '../../components/PasswordInput';
import { PasswordRequirementsList } from '../../components/PasswordRequirementsList';
import { WarningModal } from '../../components/WarningModal';
import { formatRoleLabel, getAccessToken, getAuthUser, saveAuthSession } from '../../lib/auth';
import { updateMyProfile } from '../../lib/api';
import { getPasswordError } from '../../lib/passwordValidation';

// Saudi mobile format: 05 followed by 8 digits (10 digits total).
const PHONE_PATTERN = /^05\d{8}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Letters (any language) and spaces only.
const NAME_PATTERN = /^[\p{L} ]+$/u;

type ProfileField = 'fullName' | 'email' | 'phone' | 'jobTitle' | 'password';
type ProfileErrors = Partial<Record<ProfileField, string>>;

// `treatEmptyAsError` reports "required" on save but stays quiet while typing.
// Password is optional everywhere (blank keeps the current password).
function validateProfileField(field: ProfileField, rawValue: string, treatEmptyAsError: boolean): string | undefined {
  const value = rawValue.trim();
  switch (field) {
    case 'fullName':
      if (!value) return treatEmptyAsError ? 'Full name is required.' : undefined;
      return NAME_PATTERN.test(value) ? undefined : 'Full name can only contain letters and spaces.';
    case 'email':
      if (!value) return treatEmptyAsError ? 'Email address is required.' : undefined;
      return EMAIL_PATTERN.test(value) ? undefined : 'Enter a valid email (e.g. name@example.com).';
    case 'phone':
      if (!value) return treatEmptyAsError ? 'Phone number is required.' : undefined;
      return PHONE_PATTERN.test(value)
        ? undefined
        : 'Phone must start with 05 and be 10 digits (e.g. 0512345678).';
    case 'jobTitle':
      if (!value) return treatEmptyAsError ? 'Job title is required.' : undefined;
      return undefined;
    case 'password':
      if (!value) return undefined;
      return getPasswordError(value);
    default:
      return undefined;
  }
}

function liveError(field: ProfileField, value: string): string | undefined {
  return validateProfileField(field, value, false);
}

function inputClass(hasError: boolean): string {
  return `w-full px-4 py-3 rounded-xl border ${
    hasError ? 'border-red-500 focus:ring-red-500/40' : 'border-[#d4cbb7] focus:ring-[#ff8c42]/40'
  } bg-[#f9f6ef] text-[#6b5d4f] focus:outline-none focus:ring-2`;
}

function FieldError({ message }: { message?: string }) {
  if (!message) {
    return null;
  }
  return <p className="mt-1 text-sm text-red-600">{message}</p>;
}

export function AdminProfilePage() {
  const currentUser = getAuthUser();
  const [fullName, setFullName] = useState(currentUser?.full_name ?? '');
  const [email, setEmail] = useState(currentUser?.email ?? '');
  const [phone, setPhone] = useState(currentUser?.phone ?? '');
  const [jobTitle, setJobTitle] = useState(currentUser?.job_title ?? '');
  const [password, setPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<ProfileErrors>({});
  const [modalState, setModalState] = useState({ isOpen: false, title: '', message: '' });

  const handleSave = async () => {
    const token = getAccessToken();

    if (!token || !currentUser) {
      setModalState({
        isOpen: true,
        title: 'Session Expired',
        message: 'Please log in again before updating your profile.',
      });
      return;
    }

    const nextErrors: ProfileErrors = {};
    const fields: Array<[ProfileField, string]> = [
      ['fullName', fullName],
      ['email', email],
      ['phone', phone],
      ['jobTitle', jobTitle],
      ['password', password],
    ];
    for (const [field, value] of fields) {
      const error = validateProfileField(field, value, true);
      if (error) {
        nextErrors[field] = error;
      }
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setIsSaving(true);
    try {
      const updatedUser = await updateMyProfile(
        {
          full_name: fullName.trim(),
          email: email.trim(),
          phone: phone.trim() || undefined,
          job_title: jobTitle.trim() || undefined,
          ...(password.trim() ? { password: password.trim() } : {}),
        },
        token,
      );

      saveAuthSession(token, updatedUser);
      setPassword('');
      setErrors({});
      setModalState({
        isOpen: true,
        title: 'Profile Updated',
        message: 'Your profile was saved successfully.',
      });
    } catch (error) {
      setModalState({
        isOpen: true,
        title: 'Unable to Update Profile',
        message: error instanceof Error ? error.message : 'Something went wrong while saving your profile.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#f5f3ed]">
      <Navigation isAdmin={true} />

      <div className="flex-1 py-12 px-6">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center gap-4 mb-8">
            <Link
              to="/admin/settings"
              className="flex items-center gap-2 text-[#ff8c42] hover:text-[#ff7a2e] transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
              Back
            </Link>
          </div>

          <h1 className="font-serif text-4xl text-[#4a3c2a] mb-8">Admin - Profile</h1>

          <div className="bg-white rounded-3xl shadow-xl p-8 border border-[#d4cbb7]">
            <div className="space-y-6">
              <div>
                <label className="block text-[#6b5d4f] mb-2">Full Name</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => {
                    const value = e.target.value;
                    setFullName(value);
                    setErrors((current) => ({ ...current, fullName: liveError('fullName', value) }));
                  }}
                  className={inputClass(Boolean(errors.fullName))}
                />
                <FieldError message={errors.fullName} />
              </div>

              <div>
                <label className="block text-[#6b5d4f] mb-2">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => {
                    const value = e.target.value;
                    setEmail(value);
                    setErrors((current) => ({ ...current, email: liveError('email', value) }));
                  }}
                  className={inputClass(Boolean(errors.email))}
                />
                <FieldError message={errors.email} />
              </div>

              <div>
                <label className="block text-[#6b5d4f] mb-2">Phone</label>
                <input
                  type="text"
                  placeholder="0512345678"
                  value={phone}
                  onChange={(e) => {
                    const value = e.target.value;
                    setPhone(value);
                    setErrors((current) => ({ ...current, phone: liveError('phone', value) }));
                  }}
                  className={inputClass(Boolean(errors.phone))}
                />
                <FieldError message={errors.phone} />
              </div>

              <div>
                <label className="block text-[#6b5d4f] mb-2">Job Title</label>
                <input
                  type="text"
                  value={jobTitle}
                  onChange={(e) => {
                    const value = e.target.value;
                    setJobTitle(value);
                    setErrors((current) => ({ ...current, jobTitle: liveError('jobTitle', value) }));
                  }}
                  className={inputClass(Boolean(errors.jobTitle))}
                />
                <FieldError message={errors.jobTitle} />
              </div>

              <div>
                <label className="block text-[#6b5d4f] mb-2">Role</label>
                <input
                  type="text"
                  value={currentUser ? formatRoleLabel(currentUser.role) : ''}
                  className="w-full px-4 py-3 rounded-xl border border-[#d4cbb7] bg-[#f9f6ef] text-[#6b5d4f] focus:outline-none"
                  readOnly
                />
              </div>

              <div>
                <label className="block text-[#6b5d4f] mb-2">Status</label>
                <input
                  type="text"
                  value={currentUser?.status ?? ''}
                  className="w-full px-4 py-3 rounded-xl border border-[#d4cbb7] bg-[#f9f6ef] text-[#6b5d4f] focus:outline-none"
                  readOnly
                />
              </div>

              <div>
                <label className="block text-[#6b5d4f] mb-2">New Password</label>
                <PasswordInput
                  value={password}
                  onChange={(e) => {
                    const value = e.target.value;
                    setPassword(value);
                    setErrors((current) => ({ ...current, password: liveError('password', value) }));
                  }}
                  placeholder="Leave blank to keep current password"
                  className={inputClass(Boolean(errors.password))}
                />
                <FieldError message={errors.password} />
                <PasswordRequirementsList
                  password={password}
                  className="mt-3 rounded-2xl border border-[#d4cbb7] bg-[#f9f6ef] p-4"
                />
              </div>

              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={isSaving}
                className="w-full bg-[#ff8c42] text-white py-3 rounded-full shadow-md hover:bg-[#ff7a2e] transition-colors disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isSaving ? 'Saving...' : 'Save Profile'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <WarningModal
        isOpen={modalState.isOpen}
        onClose={() => setModalState((current) => ({ ...current, isOpen: false }))}
        title={modalState.title}
        message={modalState.message}
      />

      <Footer />
    </div>
  );
}
