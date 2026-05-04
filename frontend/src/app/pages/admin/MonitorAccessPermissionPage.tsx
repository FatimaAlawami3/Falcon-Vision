import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, Edit2, Plus, Trash2, X } from 'lucide-react';
import { Navigation } from '../../components/Navigation';
import { Footer } from '../../components/Footer';
import { WarningModal } from '../../components/WarningModal';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { getAccessToken } from '../../lib/auth';
import {
  createUser,
  deleteUser,
  listUsers,
  updateUser,
  updateUserStatus,
  type CreateUserRequest,
  type UserResponse,
} from '../../lib/api';

type SupervisorFormState = {
  employee_id: string;
  full_name: string;
  email: string;
  job_title: string;
  phone: string;
  password: string;
  status: string;
};

const emptySupervisorForm: SupervisorFormState = {
  employee_id: '',
  full_name: '',
  email: '',
  job_title: '',
  phone: '',
  password: '',
  status: 'active',
};

function formatLastLogin(lastLoginAt?: string | null) {
  if (!lastLoginAt) {
    return 'Never signed in';
  }

  const date = new Date(lastLoginAt);
  return `${date.toLocaleDateString('en-CA')} ${date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

export function MonitorAccessPermissionPage() {
  const [users, setUsers] = useState<UserResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [newSupervisor, setNewSupervisor] = useState<SupervisorFormState>(emptySupervisorForm);
  const [editSupervisor, setEditSupervisor] = useState<SupervisorFormState>(emptySupervisorForm);
  const [modalState, setModalState] = useState({ isOpen: false, title: '', message: '' });
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; supervisorId: string | null; name: string }>({
    isOpen: false,
    supervisorId: null,
    name: '',
  });

  const supervisors = useMemo(
    () => users.filter((user) => user.role === 'supervisor'),
    [users],
  );

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      setIsLoading(false);
      return;
    }

    listUsers(token)
      .then((response) => {
        setUsers(response.items);
      })
      .catch((error) => {
        setModalState({
          isOpen: true,
          title: 'Unable to Load Supervisors',
          message: error instanceof Error ? error.message : 'Could not load supervisor access records.',
        });
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  const resetAddForm = () => {
    setNewSupervisor(emptySupervisorForm);
    setIsAdding(false);
  };

  const handleEdit = (supervisor: UserResponse) => {
    setEditingId(supervisor.id);
    setEditSupervisor({
      employee_id: supervisor.employee_id ?? '',
      full_name: supervisor.full_name,
      email: supervisor.email,
      job_title: supervisor.job_title ?? '',
      phone: supervisor.phone ?? '',
      password: '',
      status: supervisor.status,
    });
  };

  const handleSaveNew = async () => {
    const token = getAccessToken();
    if (!token) {
      return;
    }

    if (
      !newSupervisor.employee_id.trim()
      || !newSupervisor.full_name.trim()
      || !newSupervisor.email.trim()
      || !newSupervisor.password.trim()
    ) {
      setModalState({
        isOpen: true,
        title: 'Missing Information',
        message: 'Supervisor ID, name, email, and a temporary password are required.',
      });
      return;
    }

    setIsSaving(true);
    try {
      const createdSupervisor = await createUser(
        {
          employee_id: newSupervisor.employee_id.trim(),
          full_name: newSupervisor.full_name.trim(),
          email: newSupervisor.email.trim(),
          password: newSupervisor.password,
          role: 'supervisor',
          phone: newSupervisor.phone.trim() || undefined,
          job_title: newSupervisor.job_title.trim() || undefined,
        },
        token,
      );

      const finalSupervisor =
        newSupervisor.status !== 'active'
          ? await updateUserStatus(createdSupervisor.id, newSupervisor.status, token)
          : createdSupervisor;

      setUsers((currentUsers) => [finalSupervisor, ...currentUsers]);
      resetAddForm();
      setModalState({
        isOpen: true,
        title: 'Supervisor Added',
        message: 'The supervisor account was created successfully and added to the employee list.',
      });
    } catch (error) {
      setModalState({
        isOpen: true,
        title: 'Unable to Create Supervisor',
        message: error instanceof Error ? error.message : 'Something went wrong while creating the supervisor.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveEdit = async (supervisor: UserResponse) => {
    const token = getAccessToken();
    if (!token) {
      return;
    }

    if (!editSupervisor.employee_id.trim() || !editSupervisor.full_name.trim() || !editSupervisor.email.trim()) {
      setModalState({
        isOpen: true,
        title: 'Missing Information',
        message: 'Supervisor ID, name, and email are required.',
      });
      return;
    }

    setIsSaving(true);
    try {
      const updatedSupervisor = await updateUser(
        supervisor.id,
        {
          employee_id: editSupervisor.employee_id.trim(),
          full_name: editSupervisor.full_name.trim(),
          email: editSupervisor.email.trim(),
          job_title: editSupervisor.job_title.trim() || undefined,
          phone: editSupervisor.phone.trim() || undefined,
          ...(editSupervisor.password.trim() ? { password: editSupervisor.password } : {}),
        },
        token,
      );

      const finalSupervisor =
        editSupervisor.status !== updatedSupervisor.status
          ? await updateUserStatus(supervisor.id, editSupervisor.status, token)
          : updatedSupervisor;

      setUsers((currentUsers) =>
        currentUsers.map((user) => (user.id === supervisor.id ? finalSupervisor : user)),
      );
      setEditingId(null);
      setEditSupervisor(emptySupervisorForm);
      setModalState({
        isOpen: true,
        title: 'Supervisor Updated',
        message: 'The supervisor account was updated successfully.',
      });
    } catch (error) {
      setModalState({
        isOpen: true,
        title: 'Unable to Update Supervisor',
        message: error instanceof Error ? error.message : 'Something went wrong while saving supervisor changes.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    const token = getAccessToken();
    if (!token || !deleteConfirm.supervisorId) {
      return;
    }

    setIsSaving(true);
    try {
      await deleteUser(deleteConfirm.supervisorId, token);
      setUsers((currentUsers) => currentUsers.filter((user) => user.id !== deleteConfirm.supervisorId));
      setDeleteConfirm({ isOpen: false, supervisorId: null, name: '' });
      setModalState({
        isOpen: true,
        title: 'Supervisor Removed',
        message: 'The supervisor account was deleted successfully.',
      });
    } catch (error) {
      setModalState({
        isOpen: true,
        title: 'Unable to Delete Supervisor',
        message: error instanceof Error ? error.message : 'Something went wrong while deleting the supervisor.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#f5f3ed]">
      <Navigation isAdmin={true} />

      <div className="flex-1 py-12 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-4 mb-8">
            <Link
              to="/admin/settings"
              className="flex items-center gap-2 text-[#ff8c42] hover:text-[#ff7a2e] transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
              Back
            </Link>
          </div>

          <h1 className="font-serif text-4xl text-[#4a3c2a] mb-3">Admin - Supervisor Access</h1>
          <p className="text-[#6b5d4f] mb-8 max-w-3xl">
            Supervisors do not sign up publicly. The admin creates their accounts here, controls whether they can
            access monitoring, and can update or remove them later. Each supervisor is also linked to an employee
            profile using the same ID.
          </p>

          <div className="bg-[#f3d9c5] rounded-2xl p-6 mb-10">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="font-serif text-3xl text-[#9e2a2b]">Supervisor access history</h2>
                <p className="text-[#8b4a32] text-sm mt-2">
                  Last sign-in updates automatically when a supervisor logs in.
                </p>
              </div>
              {!isAdding && (
                <button
                  onClick={() => setIsAdding(true)}
                  className="px-6 py-3 bg-[#d87545] text-white rounded-full shadow-md hover:bg-[#c42c1f] transition-colors flex items-center gap-2"
                >
                  <Plus className="w-5 h-5" />
                  Add Supervisor
                </button>
              )}
            </div>

            {isAdding && (
              <div className="bg-white rounded-2xl p-5 mb-6 border border-[#e7cdb8]">
                <h3 className="font-serif text-2xl text-[#4a3c2a] mb-4">Create supervisor account</h3>
                <div className="grid md:grid-cols-2 gap-4">
                  <input
                    type="text"
                    placeholder="ID"
                    value={newSupervisor.employee_id}
                    onChange={(e) => setNewSupervisor((current) => ({ ...current, employee_id: e.target.value }))}
                    className="w-full px-4 py-3 rounded-xl bg-[#f9f6f0] border border-[#d4cbb7] focus:outline-none focus:ring-2 focus:ring-[#d87545]"
                  />
                  <input
                    type="text"
                    placeholder="Full name"
                    value={newSupervisor.full_name}
                    onChange={(e) => setNewSupervisor((current) => ({ ...current, full_name: e.target.value }))}
                    className="w-full px-4 py-3 rounded-xl bg-[#f9f6f0] border border-[#d4cbb7] focus:outline-none focus:ring-2 focus:ring-[#d87545]"
                  />
                  <input
                    type="email"
                    placeholder="Email address"
                    value={newSupervisor.email}
                    onChange={(e) => setNewSupervisor((current) => ({ ...current, email: e.target.value }))}
                    className="w-full px-4 py-3 rounded-xl bg-[#f9f6f0] border border-[#d4cbb7] focus:outline-none focus:ring-2 focus:ring-[#d87545]"
                  />
                  <input
                    type="text"
                    placeholder="Job title"
                    value={newSupervisor.job_title}
                    onChange={(e) => setNewSupervisor((current) => ({ ...current, job_title: e.target.value }))}
                    className="w-full px-4 py-3 rounded-xl bg-[#f9f6f0] border border-[#d4cbb7] focus:outline-none focus:ring-2 focus:ring-[#d87545]"
                  />
                  <input
                    type="text"
                    placeholder="Phone number"
                    value={newSupervisor.phone}
                    onChange={(e) => setNewSupervisor((current) => ({ ...current, phone: e.target.value }))}
                    className="w-full px-4 py-3 rounded-xl bg-[#f9f6f0] border border-[#d4cbb7] focus:outline-none focus:ring-2 focus:ring-[#d87545]"
                  />
                  <input
                    type="password"
                    placeholder="Temporary password"
                    value={newSupervisor.password}
                    onChange={(e) => setNewSupervisor((current) => ({ ...current, password: e.target.value }))}
                    className="w-full px-4 py-3 rounded-xl bg-[#f9f6f0] border border-[#d4cbb7] focus:outline-none focus:ring-2 focus:ring-[#d87545]"
                  />
                  <select
                    value={newSupervisor.status}
                    onChange={(e) => setNewSupervisor((current) => ({ ...current, status: e.target.value }))}
                    className="w-full px-4 py-3 rounded-xl bg-[#f9f6f0] border border-[#d4cbb7] focus:outline-none focus:ring-2 focus:ring-[#d87545]"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>

                <div className="flex gap-4 pt-5">
                  <button
                    onClick={handleSaveNew}
                    disabled={isSaving}
                    className="px-8 py-3 bg-[#d87545] text-white rounded-full shadow-md hover:bg-[#c42c1f] transition-colors disabled:opacity-70"
                  >
                    {isSaving ? 'Saving...' : 'Save Supervisor'}
                  </button>
                  <button
                    onClick={resetAddForm}
                    className="px-8 py-3 bg-[#8b7355] text-white rounded-full shadow-md hover:bg-[#6b5d4f] transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b-2 border-[#d87545]">
                    <th className="text-left py-3 text-[#9e2a2b] font-normal">Supervisor</th>
                    <th className="text-left py-3 text-[#9e2a2b] font-normal">Email</th>
                    <th className="text-left py-3 text-[#9e2a2b] font-normal">Job title</th>
                    <th className="text-left py-3 text-[#9e2a2b] font-normal">Last login</th>
                    <th className="text-left py-3 text-[#9e2a2b] font-normal">Status</th>
                    <th className="text-left py-3 text-[#9e2a2b] font-normal">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {!isLoading && supervisors.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-[#8b4a32]">
                        No supervisors have been added yet.
                      </td>
                    </tr>
                  ) : (
                    supervisors.map((supervisor) => {
                      const isEditing = editingId === supervisor.id;
                      return (
                        <tr key={supervisor.id} className="border-b border-[#e0c9b3]">
                          <td className="py-4 text-[#8b4a32]">
                            {isEditing ? (
                              <div className="space-y-2">
                                <input
                                  type="text"
                                  value={editSupervisor.employee_id}
                                  onChange={(e) => setEditSupervisor((current) => ({ ...current, employee_id: e.target.value }))}
                                  placeholder="ID"
                                  className="w-full px-4 py-3 rounded-xl bg-white border border-[#d4cbb7] focus:outline-none focus:ring-2 focus:ring-[#d87545]"
                                />
                                <input
                                  type="text"
                                  value={editSupervisor.full_name}
                                  onChange={(e) => setEditSupervisor((current) => ({ ...current, full_name: e.target.value }))}
                                  className="w-full px-4 py-3 rounded-xl bg-white border border-[#d4cbb7] focus:outline-none focus:ring-2 focus:ring-[#d87545]"
                                />
                              </div>
                            ) : (
                              <div>
                                <p>{supervisor.full_name}</p>
                                <p className="text-xs text-[#6b5d4f] mt-1">ID: {supervisor.employee_id ?? 'Not linked yet'}</p>
                              </div>
                            )}
                          </td>
                          <td className="py-4 text-[#8b4a32]">
                            {isEditing ? (
                              <input
                                type="email"
                                value={editSupervisor.email}
                                onChange={(e) => setEditSupervisor((current) => ({ ...current, email: e.target.value }))}
                                className="w-full px-4 py-3 rounded-xl bg-white border border-[#d4cbb7] focus:outline-none focus:ring-2 focus:ring-[#d87545]"
                              />
                            ) : (
                              supervisor.email
                            )}
                          </td>
                          <td className="py-4 text-[#8b4a32]">
                            {isEditing ? (
                              <div className="space-y-2">
                                <input
                                  type="text"
                                  value={editSupervisor.job_title}
                                  onChange={(e) => setEditSupervisor((current) => ({ ...current, job_title: e.target.value }))}
                                  placeholder="Job title"
                                  className="w-full px-4 py-3 rounded-xl bg-white border border-[#d4cbb7] focus:outline-none focus:ring-2 focus:ring-[#d87545]"
                                />
                                <input
                                  type="text"
                                  value={editSupervisor.phone}
                                  onChange={(e) => setEditSupervisor((current) => ({ ...current, phone: e.target.value }))}
                                  placeholder="Phone"
                                  className="w-full px-4 py-3 rounded-xl bg-white border border-[#d4cbb7] focus:outline-none focus:ring-2 focus:ring-[#d87545]"
                                />
                                <input
                                  type="password"
                                  value={editSupervisor.password}
                                  onChange={(e) => setEditSupervisor((current) => ({ ...current, password: e.target.value }))}
                                  placeholder="Reset password (optional)"
                                  className="w-full px-4 py-3 rounded-xl bg-white border border-[#d4cbb7] focus:outline-none focus:ring-2 focus:ring-[#d87545]"
                                />
                              </div>
                            ) : (
                              <div>
                                <p>{supervisor.job_title || '-'}</p>
                                <p className="text-xs text-[#6b5d4f] mt-1">{supervisor.phone || 'No phone saved'}</p>
                              </div>
                            )}
                          </td>
                          <td className="py-4 text-[#8b4a32]">{formatLastLogin(supervisor.last_login_at)}</td>
                          <td className="py-4 text-[#8b4a32]">
                            {isEditing ? (
                              <select
                                value={editSupervisor.status}
                                onChange={(e) => setEditSupervisor((current) => ({ ...current, status: e.target.value }))}
                                className="w-full px-4 py-3 rounded-xl bg-white border border-[#d4cbb7] focus:outline-none focus:ring-2 focus:ring-[#d87545]"
                              >
                                <option value="active">Active</option>
                                <option value="inactive">Inactive</option>
                                <option value="suspended">Suspended</option>
                              </select>
                            ) : (
                              <span className={`px-3 py-1 rounded-full text-sm ${
                                supervisor.status === 'active'
                                  ? 'bg-green-100 text-green-700'
                                  : supervisor.status === 'inactive'
                                    ? 'bg-yellow-100 text-yellow-700'
                                    : 'bg-red-100 text-red-700'
                              }`}>
                                {supervisor.status}
                              </span>
                            )}
                          </td>
                          <td className="py-4 text-[#8b4a32]">
                            {isEditing ? (
                              <div className="flex gap-2">
                                <button
                                  onClick={() => void handleSaveEdit(supervisor)}
                                  disabled={isSaving}
                                  className="px-4 py-2 bg-[#d87545] text-white rounded-full shadow-md hover:bg-[#c42c1f] transition-colors disabled:opacity-70"
                                >
                                  <Check className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => {
                                    setEditingId(null);
                                    setEditSupervisor(emptySupervisorForm);
                                  }}
                                  className="px-4 py-2 bg-[#8b7355] text-white rounded-full shadow-md hover:bg-[#6b5d4f] transition-colors"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            ) : (
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleEdit(supervisor)}
                                  className="px-4 py-2 bg-[#d87545] text-white rounded-full shadow-md hover:bg-[#c42c1f] transition-colors"
                                >
                                  <Edit2 className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() =>
                                    setDeleteConfirm({
                                      isOpen: true,
                                      supervisorId: supervisor.id,
                                      name: supervisor.full_name,
                                    })
                                  }
                                  className="px-4 py-2 bg-[#d87545] text-white rounded-full shadow-md hover:bg-[#c42c1f] transition-colors"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
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

      <ConfirmationModal
        isOpen={deleteConfirm.isOpen}
        onCancel={() => setDeleteConfirm({ isOpen: false, supervisorId: null, name: '' })}
        onConfirm={() => void handleDelete()}
        title="Delete supervisor?"
        message={`Are you sure you want to delete ${deleteConfirm.name}'s supervisor account?`}
      />

      <Footer />
    </div>
  );
}
