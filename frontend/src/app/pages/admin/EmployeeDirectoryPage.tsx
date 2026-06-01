import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, Edit2, Plus, Trash2, Upload, X } from 'lucide-react';
import { Navigation } from '../../components/Navigation';
import { Footer } from '../../components/Footer';
import { WarningModal } from '../../components/WarningModal';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { getAccessToken } from '../../lib/auth';
import {
  createEmployee,
  deleteEmployee,
  listEmployees,
  updateEmployee,
  type EmployeeCreateRequest,
  type EmployeeResponse,
} from '../../lib/api';

type EmployeeFormState = {
  employee_number: string;
  full_name: string;
  department: string;
  job_title: string;
  employment_type: string;
  status: string;
  phone: string;
  email: string;
};

const emptyEmployeeForm: EmployeeFormState = {
  employee_number: '',
  full_name: '',
  department: '',
  job_title: '',
  employment_type: 'employee',
  status: 'active',
  phone: '',
  email: '',
};

// Employee ID: exactly 5 digits.
const ID_PATTERN = /^\d{5}$/;
// Saudi mobile format: 05 followed by 8 digits (10 digits total).
const PHONE_PATTERN = /^05\d{8}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Letters (any language) and spaces only.
const NAME_PATTERN = /^[\p{L} ]+$/u;

type EmployeeFormErrors = Partial<Record<keyof EmployeeFormState, string>>;

const VALIDATED_FIELDS = ['employee_number', 'full_name', 'department', 'job_title', 'phone', 'email'] as const;

// Validate a single field. `treatEmptyAsError` controls whether a blank value
// reports "required" (on submit) or is left without an error (while typing).
function validateField(
  field: keyof EmployeeFormState,
  rawValue: string,
  treatEmptyAsError: boolean,
): string | undefined {
  const value = rawValue.trim();

  switch (field) {
    case 'employee_number':
      if (!value) return treatEmptyAsError ? 'Employee ID is required.' : undefined;
      return ID_PATTERN.test(value) ? undefined : 'Employee ID must be exactly 5 digits.';
    case 'full_name':
      if (!value) return treatEmptyAsError ? 'Full name is required.' : undefined;
      return NAME_PATTERN.test(value) ? undefined : 'Full name can only contain letters and spaces.';
    case 'department':
      if (!value) return treatEmptyAsError ? 'Department is required.' : undefined;
      return undefined;
    case 'job_title':
      if (!value) return treatEmptyAsError ? 'Job title is required.' : undefined;
      return undefined;
    case 'phone':
      if (!value) return treatEmptyAsError ? 'Phone number is required.' : undefined;
      return PHONE_PATTERN.test(value)
        ? undefined
        : 'Phone must start with 05 and be 10 digits (e.g. 0512345678).';
    case 'email':
      if (!value) return treatEmptyAsError ? 'Email address is required.' : undefined;
      return EMAIL_PATTERN.test(value) ? undefined : 'Enter a valid email (e.g. name@example.com).';
    default:
      return undefined;
  }
}

// Live (per-keystroke) error: format is checked immediately, but a blank field
// is not flagged as "required" until the user tries to save.
function liveError(field: keyof EmployeeFormState, value: string): string | undefined {
  return validateField(field, value, false);
}

function validateEmployeeForm(form: EmployeeFormState): EmployeeFormErrors {
  const errors: EmployeeFormErrors = {};
  for (const field of VALIDATED_FIELDS) {
    const error = validateField(field, form[field], true);
    if (error) {
      errors[field] = error;
    }
  }
  return errors;
}

// Shared input styling; switches to a red border when the field has an error.
function inputClass(hasError: boolean): string {
  return `w-full px-4 py-3 rounded-xl bg-[#f9f6f0] border focus:outline-none focus:ring-2 ${
    hasError
      ? 'border-red-500 focus:ring-red-500'
      : 'border-[#d4cbb7] focus:ring-[#d87545]'
  }`;
}

function FieldError({ message }: { message?: string }) {
  if (!message) {
    return null;
  }
  return <p className="mt-1 text-sm text-red-600">{message}</p>;
}

function toEmployeePayload(form: EmployeeFormState): EmployeeCreateRequest {
  return {
    employee_number: form.employee_number.trim(),
    full_name: form.full_name.trim(),
    department: form.department.trim() || undefined,
    job_title: form.job_title.trim() || undefined,
    employment_type: form.employment_type,
    status: form.status,
    phone: form.phone.trim() || undefined,
    email: form.email.trim() || undefined,
  };
}

function buildFormFromEmployee(employee: EmployeeResponse): EmployeeFormState {
  return {
    employee_number: employee.employee_number,
    full_name: employee.full_name,
    department: employee.department ?? '',
    job_title: employee.job_title ?? '',
    employment_type: employee.employment_type,
    status: employee.status,
    phone: employee.phone ?? '',
    email: employee.email ?? '',
  };
}

export function EmployeeDirectoryPage() {
  const [employees, setEmployees] = useState<EmployeeResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [newEmployee, setNewEmployee] = useState<EmployeeFormState>(emptyEmployeeForm);
  const [editEmployee, setEditEmployee] = useState<EmployeeFormState>(emptyEmployeeForm);
  const [newErrors, setNewErrors] = useState<EmployeeFormErrors>({});
  const [editErrors, setEditErrors] = useState<EmployeeFormErrors>({});
  const [modalState, setModalState] = useState({ isOpen: false, title: '', message: '' });
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; employeeId: string | null; name: string }>({
    isOpen: false,
    employeeId: null,
    name: '',
  });

  const activeEmployees = useMemo(() => employees, [employees]);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      setIsLoading(false);
      return;
    }

    listEmployees(token)
      .then((response) => {
        setEmployees(response.items);
      })
      .catch((error) => {
        setModalState({
          isOpen: true,
          title: 'Unable to Load Employees',
          message: error instanceof Error ? error.message : 'Could not load employee records.',
        });
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  const handleCreateEmployee = async () => {
    const token = getAccessToken();
    if (!token) {
      return;
    }

    const errors = validateEmployeeForm(newEmployee);
    setNewErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }

    setIsSaving(true);
    try {
      const createdEmployee = await createEmployee(toEmployeePayload(newEmployee), token);
      setEmployees((currentEmployees) => [createdEmployee, ...currentEmployees]);
      setNewEmployee(emptyEmployeeForm);
      setNewErrors({});
      setIsAdding(false);
      setModalState({
        isOpen: true,
        title: 'Employee Added',
        message: 'The employee record was created successfully. You can now upload face images for them.',
      });
    } catch (error) {
      setModalState({
        isOpen: true,
        title: 'Unable to Create Employee',
        message: error instanceof Error ? error.message : 'Something went wrong while creating the employee.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveEdit = async (employee: EmployeeResponse) => {
    const token = getAccessToken();
    if (!token) {
      return;
    }

    const errors = validateEmployeeForm(editEmployee);
    setEditErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }

    setIsSaving(true);
    try {
      const updatedEmployee = await updateEmployee(employee.id, toEmployeePayload(editEmployee), token);
      setEmployees((currentEmployees) =>
        currentEmployees.map((currentEmployee) =>
          currentEmployee.id === employee.id ? updatedEmployee : currentEmployee,
        ),
      );
      setEditingId(null);
      setEditEmployee(emptyEmployeeForm);
      setEditErrors({});
      setModalState({
        isOpen: true,
        title: 'Employee Updated',
        message: 'The employee record was updated successfully.',
      });
    } catch (error) {
      setModalState({
        isOpen: true,
        title: 'Unable to Update Employee',
        message: error instanceof Error ? error.message : 'Something went wrong while saving employee changes.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteEmployee = async () => {
    const token = getAccessToken();
    if (!token || !deleteConfirm.employeeId) {
      return;
    }

    setIsSaving(true);
    try {
      await deleteEmployee(deleteConfirm.employeeId, token);
      setEmployees((currentEmployees) =>
        currentEmployees.filter((employee) => employee.id !== deleteConfirm.employeeId),
      );
      setDeleteConfirm({ isOpen: false, employeeId: null, name: '' });
      setModalState({
        isOpen: true,
        title: 'Employee Deleted',
        message: 'The employee record was removed successfully.',
      });
    } catch (error) {
      setModalState({
        isOpen: true,
        title: 'Unable to Delete Employee',
        message: error instanceof Error ? error.message : 'Something went wrong while deleting the employee.',
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

          <h1 className="font-serif text-4xl text-[#4a3c2a] mb-3">Admin - Employee Directory</h1>
          <p className="text-[#6b5d4f] mb-8 max-w-3xl">
            Add employees here first, including their core profile and job details. After that, go to face upload to
            attach recognition images to the correct employee record. Supervisor accounts are also represented here as
            linked employee profiles.
          </p>

          <div className="flex flex-wrap items-center gap-3 mb-6">
            {!isAdding && (
              <button
                onClick={() => setIsAdding(true)}
                className="px-6 py-3 bg-[#d87545] text-white rounded-full shadow-md hover:bg-[#c42c1f] transition-colors flex items-center gap-2"
              >
                <Plus className="w-5 h-5" />
                Add Employee
              </button>
            )}
            <Link
              to="/admin/upload-faces"
              className="px-6 py-3 bg-white text-[#d87545] rounded-full shadow-md border border-[#d4cbb7] hover:bg-[#f9f6f0] transition-colors flex items-center gap-2"
            >
              <Upload className="w-5 h-5" />
              Upload Employee Faces
            </Link>
          </div>

          {isAdding && (
            <div className="bg-white rounded-3xl shadow-xl p-6 border border-[#d4cbb7] mb-8">
              <h2 className="font-serif text-2xl text-[#4a3c2a] mb-4">Create employee profile</h2>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <input
                    type="text"
                    placeholder="ID"
                    value={newEmployee.employee_number}
                    onChange={(e) => {
                      const value = e.target.value;
                      setNewEmployee((current) => ({ ...current, employee_number: value }));
                      setNewErrors((current) => ({ ...current, employee_number: liveError('employee_number', value) }));
                    }}
                    className={inputClass(Boolean(newErrors.employee_number))}
                  />
                  <FieldError message={newErrors.employee_number} />
                </div>
                <div>
                  <input
                    type="text"
                    placeholder="Full name"
                    value={newEmployee.full_name}
                    onChange={(e) => {
                      const value = e.target.value;
                      setNewEmployee((current) => ({ ...current, full_name: value }));
                      setNewErrors((current) => ({ ...current, full_name: liveError('full_name', value) }));
                    }}
                    className={inputClass(Boolean(newErrors.full_name))}
                  />
                  <FieldError message={newErrors.full_name} />
                </div>
                <div>
                  <input
                    type="text"
                    placeholder="Department"
                    value={newEmployee.department}
                    onChange={(e) => {
                      const value = e.target.value;
                      setNewEmployee((current) => ({ ...current, department: value }));
                      setNewErrors((current) => ({ ...current, department: liveError('department', value) }));
                    }}
                    className={inputClass(Boolean(newErrors.department))}
                  />
                  <FieldError message={newErrors.department} />
                </div>
                <div>
                  <input
                    type="text"
                    placeholder="Job title"
                    value={newEmployee.job_title}
                    onChange={(e) => {
                      const value = e.target.value;
                      setNewEmployee((current) => ({ ...current, job_title: value }));
                      setNewErrors((current) => ({ ...current, job_title: liveError('job_title', value) }));
                    }}
                    className={inputClass(Boolean(newErrors.job_title))}
                  />
                  <FieldError message={newErrors.job_title} />
                </div>
                <select
                  value={newEmployee.employment_type}
                  onChange={(e) => setNewEmployee((current) => ({ ...current, employment_type: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl bg-[#f9f6f0] border border-[#d4cbb7] focus:outline-none focus:ring-2 focus:ring-[#d87545]"
                >
                  <option value="employee">Employee</option>
                  <option value="contractor">Contractor</option>
                  <option value="visitor">Visitor</option>
                </select>
                <select
                  value={newEmployee.status}
                  onChange={(e) => setNewEmployee((current) => ({ ...current, status: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl bg-[#f9f6f0] border border-[#d4cbb7] focus:outline-none focus:ring-2 focus:ring-[#d87545]"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="archived">Archived</option>
                </select>
                <div>
                  <input
                    type="text"
                    placeholder="Phone number (e.g. 0512345678)"
                    value={newEmployee.phone}
                    onChange={(e) => {
                      const value = e.target.value;
                      setNewEmployee((current) => ({ ...current, phone: value }));
                      setNewErrors((current) => ({ ...current, phone: liveError('phone', value) }));
                    }}
                    className={inputClass(Boolean(newErrors.phone))}
                  />
                  <FieldError message={newErrors.phone} />
                </div>
                <div>
                  <input
                    type="email"
                    placeholder="Email address"
                    value={newEmployee.email}
                    onChange={(e) => {
                      const value = e.target.value;
                      setNewEmployee((current) => ({ ...current, email: value }));
                      setNewErrors((current) => ({ ...current, email: liveError('email', value) }));
                    }}
                    className={inputClass(Boolean(newErrors.email))}
                  />
                  <FieldError message={newErrors.email} />
                </div>
                </div>

              <div className="flex gap-4 pt-5">
                <button
                  onClick={() => void handleCreateEmployee()}
                  disabled={isSaving}
                  className="px-8 py-3 bg-[#d87545] text-white rounded-full shadow-md hover:bg-[#c42c1f] transition-colors disabled:opacity-70"
                >
                  {isSaving ? 'Saving...' : 'Save Employee'}
                </button>
                <button
                  onClick={() => {
                    setIsAdding(false);
                    setNewEmployee(emptyEmployeeForm);
                    setNewErrors({});
                  }}
                  className="px-8 py-3 bg-[#8b7355] text-white rounded-full shadow-md hover:bg-[#6b5d4f] transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="bg-white rounded-3xl shadow-xl p-6 border border-[#d4cbb7] overflow-x-auto">
            <table className="w-full">
              <thead className="border-b-2 border-[#d4cbb7]">
                <tr>
                  <th className="text-left py-3 px-4 text-[#6b5d4f]">Employee</th>
                  <th className="text-left py-3 px-4 text-[#6b5d4f]">Department</th>
                  <th className="text-left py-3 px-4 text-[#6b5d4f]">Type</th>
                  <th className="text-left py-3 px-4 text-[#6b5d4f]">Status</th>
                  <th className="text-left py-3 px-4 text-[#6b5d4f]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {!isLoading && activeEmployees.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-[#6b5d4f]">
                      No employees found yet. Add an employee before uploading face images.
                    </td>
                  </tr>
                ) : (
                  activeEmployees.map((employee) => {
                    const isEditing = editingId === employee.id;
                    return (
                      <tr key={employee.id} className="border-b border-[#d4cbb7]/50 align-top">
                        <td className="py-4 px-4 text-[#4a3c2a]">
                          {isEditing ? (
                            <div className="space-y-2">
                              <div>
                                <input
                                  type="text"
                                  value={editEmployee.employee_number}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    setEditEmployee((current) => ({ ...current, employee_number: value }));
                                    setEditErrors((current) => ({ ...current, employee_number: liveError('employee_number', value) }));
                                  }}
                                  placeholder="ID"
                                  className={inputClass(Boolean(editErrors.employee_number))}
                                />
                                <FieldError message={editErrors.employee_number} />
                              </div>
                              <div>
                                <input
                                  type="text"
                                  value={editEmployee.full_name}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    setEditEmployee((current) => ({ ...current, full_name: value }));
                                    setEditErrors((current) => ({ ...current, full_name: liveError('full_name', value) }));
                                  }}
                                  placeholder="Full name"
                                  className={inputClass(Boolean(editErrors.full_name))}
                                />
                                <FieldError message={editErrors.full_name} />
                              </div>
                              <div>
                                <input
                                  type="email"
                                  value={editEmployee.email}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    setEditEmployee((current) => ({ ...current, email: value }));
                                    setEditErrors((current) => ({ ...current, email: liveError('email', value) }));
                                  }}
                                  placeholder="Email"
                                  className={inputClass(Boolean(editErrors.email))}
                                />
                                <FieldError message={editErrors.email} />
                              </div>
                              <div>
                                <input
                                  type="text"
                                  value={editEmployee.phone}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    setEditEmployee((current) => ({ ...current, phone: value }));
                                    setEditErrors((current) => ({ ...current, phone: liveError('phone', value) }));
                                  }}
                                  placeholder="Phone"
                                  className={inputClass(Boolean(editErrors.phone))}
                                />
                                <FieldError message={editErrors.phone} />
                              </div>
                            </div>
                          ) : (
                            <div>
                              <p className="font-medium">{employee.full_name}</p>
                              <p className="text-sm text-[#6b5d4f]">ID: {employee.employee_number}</p>
                              <p className="text-sm text-[#6b5d4f] mt-1">{employee.email ?? 'No email saved'}</p>
                            </div>
                          )}
                        </td>
                        <td className="py-4 px-4 text-[#6b5d4f]">
                          {isEditing ? (
                            <div className="space-y-2">
                              <div>
                                <input
                                  type="text"
                                  value={editEmployee.department}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    setEditEmployee((current) => ({ ...current, department: value }));
                                    setEditErrors((current) => ({ ...current, department: liveError('department', value) }));
                                  }}
                                  placeholder="Department"
                                  className={inputClass(Boolean(editErrors.department))}
                                />
                                <FieldError message={editErrors.department} />
                              </div>
                              <div>
                                <input
                                  type="text"
                                  value={editEmployee.job_title}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    setEditEmployee((current) => ({ ...current, job_title: value }));
                                    setEditErrors((current) => ({ ...current, job_title: liveError('job_title', value) }));
                                  }}
                                  placeholder="Job title"
                                  className={inputClass(Boolean(editErrors.job_title))}
                                />
                                <FieldError message={editErrors.job_title} />
                              </div>
                            </div>
                          ) : (
                            <div>
                              <p>{employee.department ?? '-'}</p>
                              <p className="text-sm mt-1">{employee.job_title ?? 'No job title saved'}</p>
                            </div>
                          )}
                        </td>
                        <td className="py-4 px-4 text-[#6b5d4f]">
                          {isEditing ? (
                            <select
                              value={editEmployee.employment_type}
                              onChange={(e) => setEditEmployee((current) => ({ ...current, employment_type: e.target.value }))}
                              className="w-full px-4 py-3 rounded-xl bg-[#f9f6f0] border border-[#d4cbb7] focus:outline-none focus:ring-2 focus:ring-[#d87545]"
                            >
                              <option value="employee">Employee</option>
                              <option value="contractor">Contractor</option>
                              <option value="visitor">Visitor</option>
                            </select>
                          ) : (
                            employee.employment_type
                          )}
                        </td>
                        <td className="py-4 px-4 text-[#6b5d4f]">
                          {isEditing ? (
                            <select
                              value={editEmployee.status}
                              onChange={(e) => setEditEmployee((current) => ({ ...current, status: e.target.value }))}
                              className="w-full px-4 py-3 rounded-xl bg-[#f9f6f0] border border-[#d4cbb7] focus:outline-none focus:ring-2 focus:ring-[#d87545]"
                            >
                              <option value="active">Active</option>
                              <option value="inactive">Inactive</option>
                              <option value="archived">Archived</option>
                            </select>
                          ) : (
                            <span className={`px-3 py-1 rounded-full text-sm ${
                              employee.status === 'active'
                                ? 'bg-green-100 text-green-700'
                                : employee.status === 'inactive'
                                  ? 'bg-yellow-100 text-yellow-700'
                                  : 'bg-gray-200 text-gray-700'
                            }`}>
                              {employee.status}
                            </span>
                          )}
                        </td>
                        <td className="py-4 px-4">
                          {isEditing ? (
                            <div className="flex gap-2">
                              <button
                                onClick={() => void handleSaveEdit(employee)}
                                disabled={isSaving}
                                className="px-4 py-2 bg-[#d87545] text-white rounded-full shadow-md hover:bg-[#c42c1f] transition-colors disabled:opacity-70"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => {
                                  setEditingId(null);
                                  setEditEmployee(emptyEmployeeForm);
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
                                onClick={() => {
                                  setEditingId(employee.id);
                                  setEditEmployee(buildFormFromEmployee(employee));
                                  setEditErrors({});
                                }}
                                className="px-4 py-2 bg-[#d87545] text-white rounded-full shadow-md hover:bg-[#c42c1f] transition-colors"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() =>
                                  setDeleteConfirm({
                                    isOpen: true,
                                    employeeId: employee.id,
                                    name: employee.full_name,
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

      <WarningModal
        isOpen={modalState.isOpen}
        onClose={() => setModalState((current) => ({ ...current, isOpen: false }))}
        title={modalState.title}
        message={modalState.message}
      />

      <ConfirmationModal
        isOpen={deleteConfirm.isOpen}
        onCancel={() => setDeleteConfirm({ isOpen: false, employeeId: null, name: '' })}
        onConfirm={() => void handleDeleteEmployee()}
        title="Delete employee?"
        message={`Are you sure you want to delete ${deleteConfirm.name}'s employee record?`}
      />

      <Footer />
    </div>
  );
}
