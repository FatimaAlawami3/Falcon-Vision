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

// Supervisor ID: exactly 5 digits (matches the linked employee ID).
const ID_PATTERN = /^\d{5}$/;
// Saudi mobile format: 05 followed by 8 digits (10 digits total).
const PHONE_PATTERN = /^05\d{8}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Letters (any language) and spaces only.
const NAME_PATTERN = /^[\p{L} ]+$/u;
const MIN_PASSWORD_LENGTH = 8;

type SupervisorFormErrors = Partial<Record<keyof SupervisorFormState, string>>;

const VALIDATED_FIELDS = ['employee_id', 'full_name', 'email', 'job_title', 'phone', 'password'] as const;

// Validate a single field. `treatEmptyAsError` reports "required" on submit but
// stays quiet while typing; `passwordRequired` is false when editing (the
// password field is an optional reset there).
function validateField(
  field: keyof SupervisorFormState,
  rawValue: string,
  treatEmptyAsError: boolean,
  passwordRequired: boolean,
): string | undefined {
  const value = rawValue.trim();

  switch (field) {
    case 'employee_id':
      if (!value) return treatEmptyAsError ? 'Supervisor ID is required.' : undefined;
      return ID_PATTERN.test(value) ? undefined : 'Supervisor ID must be exactly 5 digits.';
    case 'full_name':
      if (!value) return treatEmptyAsError ? 'Full name is required.' : undefined;
      return NAME_PATTERN.test(value) ? undefined : 'Full name can only contain letters and spaces.';
    case 'email':
      if (!value) return treatEmptyAsError ? 'Email address is required.' : undefined;
      return EMAIL_PATTERN.test(value) ? undefined : 'Enter a valid email (e.g. name@example.com).';
    case 'job_title':
      if (!value) return treatEmptyAsError ? 'Job title is required.' : undefined;
      return undefined;
    case 'phone':
      if (!value) return treatEmptyAsError ? 'Phone number is required.' : undefined;
      return PHONE_PATTERN.test(value)
        ? undefined
        : 'Phone must start with 05 and be 10 digits (e.g. 0512345678).';
    case 'password':
      if (!value) return treatEmptyAsError && passwordRequired ? 'A temporary password is required.' : undefined;
      return value.length >= MIN_PASSWORD_LENGTH
        ? undefined
        : `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    default:
      return undefined;
  }
}

// Live (per-keystroke) error: format is checked immediately, but a blank field
// is not flagged as "required" until the user tries to save.
function liveError(field: keyof SupervisorFormState, value: string): string | undefined {
  return validateField(field, value, false, false);
}

function validateSupervisorForm(form: SupervisorFormState, passwordRequired: boolean): SupervisorFormErrors {
  const errors: SupervisorFormErrors = {};
  for (const field of VALIDATED_FIELDS) {
    const error = validateField(field, form[field], true, passwordRequired);
    if (error) {
      errors[field] = error;
    }
  }
  return errors;
}

// Shared input styling; switches to a red border when the field has an error.
function inputClass(hasError: boolean, base: 'cream' | 'white' = 'cream'): string {
  const bg = base === 'white' ? 'bg-white' : 'bg-[#f9f6f0]';
  return `w-full px-4 py-3 rounded-xl ${bg} border focus:outline-none focus:ring-2 ${
    hasError ? 'border-red-500 focus:ring-red-500' : 'border-[#d4cbb7] focus:ring-[#d87545]'
  }`;
}

function FieldError({ message }: { message?: string }) {
  if (!message) {
    return null;
  }
  return <p className="mt-1 text-sm text-red-600">{message}</p>;
}

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
  const [newErrors, setNewErrors] = useState<SupervisorFormErrors>({});
  const [editErrors, setEditErrors] = useState<SupervisorFormErrors>({});
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
    setNewErrors({});
    setIsAdding(false);
  };

  const handleEdit = (supervisor: UserResponse) => {
    setEditingId(supervisor.id);
    setEditErrors({});
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

    const errors = validateSupervisorForm(newSupervisor, true);
    setNewErrors(errors);
    if (Object.keys(errors).length > 0) {
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

    const errors = validateSupervisorForm(editSupervisor, false);
    setEditErrors(errors);
    if (Object.keys(errors).length > 0) {
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
      setEditErrors({});
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
                  <div>
                    <input
                      type="text"
                      placeholder="ID"
                      value={newSupervisor.employee_id}
                      onChange={(e) => {
                        const value = e.target.value;
                        setNewSupervisor((current) => ({ ...current, employee_id: value }));
                        setNewErrors((current) => ({ ...current, employee_id: liveError('employee_id', value) }));
                      }}
                      className={inputClass(Boolean(newErrors.employee_id))}
                    />
                    <FieldError message={newErrors.employee_id} />
                  </div>
                  <div>
                    <input
                      type="text"
                      placeholder="Full name"
                      value={newSupervisor.full_name}
                      onChange={(e) => {
                        const value = e.target.value;
                        setNewSupervisor((current) => ({ ...current, full_name: value }));
                        setNewErrors((current) => ({ ...current, full_name: liveError('full_name', value) }));
                      }}
                      className={inputClass(Boolean(newErrors.full_name))}
                    />
                    <FieldError message={newErrors.full_name} />
                  </div>
                  <div>
                    <input
                      type="email"
                      placeholder="Email address"
                      value={newSupervisor.email}
                      onChange={(e) => {
                        const value = e.target.value;
                        setNewSupervisor((current) => ({ ...current, email: value }));
                        setNewErrors((current) => ({ ...current, email: liveError('email', value) }));
                      }}
                      className={inputClass(Boolean(newErrors.email))}
                    />
                    <FieldError message={newErrors.email} />
                  </div>
                  <div>
                    <input
                      type="text"
                      placeholder="Job title"
                      value={newSupervisor.job_title}
                      onChange={(e) => {
                        const value = e.target.value;
                        setNewSupervisor((current) => ({ ...current, job_title: value }));
                        setNewErrors((current) => ({ ...current, job_title: liveError('job_title', value) }));
                      }}
                      className={inputClass(Boolean(newErrors.job_title))}
                    />
                    <FieldError message={newErrors.job_title} />
                  </div>
                  <div>
                    <input
                      type="text"
                      placeholder="Phone number (e.g. 0512345678)"
                      value={newSupervisor.phone}
                      onChange={(e) => {
                        const value = e.target.value;
                        setNewSupervisor((current) => ({ ...current, phone: value }));
                        setNewErrors((current) => ({ ...current, phone: liveError('phone', value) }));
                      }}
                      className={inputClass(Boolean(newErrors.phone))}
                    />
                    <FieldError message={newErrors.phone} />
                  </div>
                  <div>
                    <input
                      type="password"
                      placeholder="Temporary password"
                      value={newSupervisor.password}
                      onChange={(e) => {
                        const value = e.target.value;
                        setNewSupervisor((current) => ({ ...current, password: value }));
                        setNewErrors((current) => ({ ...current, password: liveError('password', value) }));
                      }}
                      className={inputClass(Boolean(newErrors.password))}
                    />
                    <FieldError message={newErrors.password} />
                  </div>
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
                                <div>
                                  <input
                                    type="text"
                                    value={editSupervisor.employee_id}
                                    onChange={(e) => {
                                      const value = e.target.value;
                                      setEditSupervisor((current) => ({ ...current, employee_id: value }));
                                      setEditErrors((current) => ({ ...current, employee_id: liveError('employee_id', value) }));
                                    }}
                                    placeholder="ID"
                                    className={inputClass(Boolean(editErrors.employee_id), 'white')}
                                  />
                                  <FieldError message={editErrors.employee_id} />
                                </div>
                                <div>
                                  <input
                                    type="text"
                                    value={editSupervisor.full_name}
                                    onChange={(e) => {
                                      const value = e.target.value;
                                      setEditSupervisor((current) => ({ ...current, full_name: value }));
                                      setEditErrors((current) => ({ ...current, full_name: liveError('full_name', value) }));
                                    }}
                                    className={inputClass(Boolean(editErrors.full_name), 'white')}
                                  />
                                  <FieldError message={editErrors.full_name} />
                                </div>
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
                              <div>
                                <input
                                  type="email"
                                  value={editSupervisor.email}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    setEditSupervisor((current) => ({ ...current, email: value }));
                                    setEditErrors((current) => ({ ...current, email: liveError('email', value) }));
                                  }}
                                  className={inputClass(Boolean(editErrors.email), 'white')}
                                />
                                <FieldError message={editErrors.email} />
                              </div>
                            ) : (
                              supervisor.email
                            )}
                          </td>
                          <td className="py-4 text-[#8b4a32]">
                            {isEditing ? (
                              <div className="space-y-2">
                                <div>
                                  <input
                                    type="text"
                                    value={editSupervisor.job_title}
                                    onChange={(e) => {
                                      const value = e.target.value;
                                      setEditSupervisor((current) => ({ ...current, job_title: value }));
                                      setEditErrors((current) => ({ ...current, job_title: liveError('job_title', value) }));
                                    }}
                                    placeholder="Job title"
                                    className={inputClass(Boolean(editErrors.job_title), 'white')}
                                  />
                                  <FieldError message={editErrors.job_title} />
                                </div>
                                <div>
                                  <input
                                    type="text"
                                    value={editSupervisor.phone}
                                    onChange={(e) => {
                                      const value = e.target.value;
                                      setEditSupervisor((current) => ({ ...current, phone: value }));
                                      setEditErrors((current) => ({ ...current, phone: liveError('phone', value) }));
                                    }}
                                    placeholder="Phone"
                                    className={inputClass(Boolean(editErrors.phone), 'white')}
                                  />
                                  <FieldError message={editErrors.phone} />
                                </div>
                                <div>
                                  <input
                                    type="password"
                                    value={editSupervisor.password}
                                    onChange={(e) => {
                                      const value = e.target.value;
                                      setEditSupervisor((current) => ({ ...current, password: value }));
                                      setEditErrors((current) => ({ ...current, password: liveError('password', value) }));
                                    }}
                                    placeholder="Reset password (optional)"
                                    className={inputClass(Boolean(editErrors.password), 'white')}
                                  />
                                  <FieldError message={editErrors.password} />
                                </div>
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
                                    setEditErrors({});
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
