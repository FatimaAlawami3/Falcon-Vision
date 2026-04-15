import { Navigation } from '../../components/Navigation';
import { Footer } from '../../components/Footer';
import { formatRoleLabel, getAuthUser } from '../../lib/auth';

export function SupervisorProfilePage() {
  const currentUser = getAuthUser();

  return (
    <div className="min-h-screen flex flex-col bg-[#f5f3ed]">
      <Navigation isAdmin={false} />
      
      <div className="flex-1 py-12 px-6">
        <div className="max-w-2xl mx-auto">
          <h1 className="font-serif text-4xl text-[#4a3c2a] mb-8">Supervisor – Profile</h1>
          
          <div className="bg-white rounded-3xl shadow-xl p-8 border border-[#d4cbb7]">
            <h2 className="font-serif text-2xl text-[#4a3c2a] mb-6">Profile</h2>
            <div className="mb-6 rounded-2xl border border-[#e8dcc7] bg-[#fdf6ef] px-4 py-3 text-sm text-[#6b5d4f]">
              This page now reads from the authenticated backend session. Profile editing stays disabled until the backend update endpoint exists.
            </div>
            <div className="space-y-6">
              <div>
                <label className="block text-[#6b5d4f] mb-2">Full Name</label>
                <input
                  type="text"
                  value={currentUser?.full_name ?? ''}
                  className="w-full px-4 py-3 rounded-xl border border-[#d4cbb7] bg-[#f9f6ef] text-[#6b5d4f] focus:outline-none"
                  readOnly
                />
              </div>

              <div>
                <label className="block text-[#6b5d4f] mb-2">Email</label>
                <input
                  type="email"
                  value={currentUser?.email ?? ''}
                  className="w-full px-4 py-3 rounded-xl border border-[#d4cbb7] bg-[#f9f6ef] text-[#6b5d4f] focus:outline-none"
                  readOnly
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

              <button
                type="button"
                disabled
                className="w-full cursor-not-allowed bg-[#d4cbb7] text-white py-3 rounded-full shadow-md"
              >
                Profile Editing Not Available Yet
              </button>
            </div>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
}
