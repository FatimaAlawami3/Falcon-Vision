import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Navigation } from '../../components/Navigation';
import { Footer } from '../../components/Footer';
import { WarningModal } from '../../components/WarningModal';
import { formatRoleLabel, getAccessToken, getAuthUser, saveAuthSession } from '../../lib/auth';
import { updateMyProfile } from '../../lib/api';

export function AdminProfilePage() {
  const currentUser = getAuthUser();
  const [fullName, setFullName] = useState(currentUser?.full_name ?? '');
  const [email, setEmail] = useState(currentUser?.email ?? '');
  const [phone, setPhone] = useState(currentUser?.phone ?? '');
  const [jobTitle, setJobTitle] = useState(currentUser?.job_title ?? '');
  const [password, setPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);
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

    if (!fullName.trim() || !email.trim()) {
      setModalState({
        isOpen: true,
        title: 'Missing Information',
        message: 'Full name and email are required.',
      });
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
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-[#d4cbb7] bg-[#f9f6ef] text-[#6b5d4f] focus:outline-none focus:ring-2 focus:ring-[#ff8c42]/40"
                />
              </div>

              <div>
                <label className="block text-[#6b5d4f] mb-2">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-[#d4cbb7] bg-[#f9f6ef] text-[#6b5d4f] focus:outline-none focus:ring-2 focus:ring-[#ff8c42]/40"
                />
              </div>

              <div>
                <label className="block text-[#6b5d4f] mb-2">Phone</label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-[#d4cbb7] bg-[#f9f6ef] text-[#6b5d4f] focus:outline-none focus:ring-2 focus:ring-[#ff8c42]/40"
                />
              </div>

              <div>
                <label className="block text-[#6b5d4f] mb-2">Job Title</label>
                <input
                  type="text"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-[#d4cbb7] bg-[#f9f6ef] text-[#6b5d4f] focus:outline-none focus:ring-2 focus:ring-[#ff8c42]/40"
                />
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
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Leave blank to keep current password"
                  className="w-full px-4 py-3 rounded-xl border border-[#d4cbb7] bg-[#f9f6ef] text-[#6b5d4f] focus:outline-none focus:ring-2 focus:ring-[#ff8c42]/40"
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
