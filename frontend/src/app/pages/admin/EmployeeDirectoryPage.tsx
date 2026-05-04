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

    if (!newEmployee.employee_number.trim() || !newEmployee.full_name.trim()) {
      setModalState({
        isOpen: true,
        title: 'Missing Information',
        message: 'ID and full name are required.',
      });
      return;
    }

    setIsSaving(true);
    try {
      const createdEmployee = await createEmployee(toEmployeePayload(newEmployee), token);
      setEmployees((currentEmployees) => [createdEmployee, ...currentEmployees]);
      setNewEmployee(emptyEmployeeForm);
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

    if (!editEmployee.employee_number.trim() || !editEmployee.full_name.trim()) {
      setModalState({
        isOpen: true,
        title: 'Missing Information',
        message: 'ID and full name are required.',
      });
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
                <input
                  type="text"
                  placeholder="ID"
                  value={newEmployee.employee_number}
                  onChange={(e) => setNewEmployee((current) => ({ ...current, employee_number: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl bg-[#f9f6f0] border border-[#d4cbb7] focus:outline-none focus:ring-2 focus:ring-[#d87545]"
                />
                <input
                  type="text"
                  placeholder="Full name"
                  value={newEmployee.full_name}
                  onChange={(e) => setNewEmployee((current) => ({ ...current, full_name: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl bg-[#f9f6f0] border border-[#d4cbb7] focus:outline-none focus:ring-2 focus:ring-[#d87545]"
                />
                <input
                  type="text"
                  placeholder="Department"
                  value={newEmployee.department}
                  onChange={(e) => setNewEmployee((current) => ({ ...current, department: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl bg-[#f9f6f0] border border-[#d4cbb7] focus:outline-none focus:ring-2 focus:ring-[#d87545]"
                />
                <input
                  type="text"
                  placeholder="Job title"
                  value={newEmployee.job_title}
                  onChange={(e) => setNewEmployee((current) => ({ ...current, job_title: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl bg-[#f9f6f0] border border-[#d4cbb7] focus:outline-none focus:ring-2 focus:ring-[#d87545]"
                />
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
                <input
                  type="text"
                  placeholder="Phone number"
                  value={newEmployee.phone}
                  onChange={(e) => setNewEmployee((current) => ({ ...current, phone: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl bg-[#f9f6f0] border border-[#d4cbb7] focus:outline-none focus:ring-2 focus:ring-[#d87545]"
                />
                <input
                  type="email"
                  placeholder="Email address"
                  value={newEmployee.email}
                  onChange={(e) => setNewEmployee((current) => ({ ...current, email: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl bg-[#f9f6f0] border border-[#d4cbb7] focus:outline-none focus:ring-2 focus:ring-[#d87545]"
                />
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
                              <input
                                type="text"
                                value={editEmployee.employee_number}
                                onChange={(e) => setEditEmployee((current) => ({ ...current, employee_number: e.target.value }))}
                                placeholder="ID"
                                className="w-full px-4 py-3 rounded-xl bg-[#f9f6f0] border border-[#d4cbb7] focus:outline-none focus:ring-2 focus:ring-[#d87545]"
                              />
                              <input
                                type="text"
                                value={editEmployee.full_name}
                                onChange={(e) => setEditEmployee((current) => ({ ...current, full_name: e.target.value }))}
                                placeholder="Full name"
                                className="w-full px-4 py-3 rounded-xl bg-[#f9f6f0] border border-[#d4cbb7] focus:outline-none focus:ring-2 focus:ring-[#d87545]"
                              />
                              <input
                                type="email"
                                value={editEmployee.email}
                                onChange={(e) => setEditEmployee((current) => ({ ...current, email: e.target.value }))}
                                placeholder="Email"
                                className="w-full px-4 py-3 rounded-xl bg-[#f9f6f0] border border-[#d4cbb7] focus:outline-none focus:ring-2 focus:ring-[#d87545]"
                              />
                              <input
                                type="text"
                                value={editEmployee.phone}
                                onChange={(e) => setEditEmployee((current) => ({ ...current, phone: e.target.value }))}
                                placeholder="Phone"
                                className="w-full px-4 py-3 rounded-xl bg-[#f9f6f0] border border-[#d4cbb7] focus:outline-none focus:ring-2 focus:ring-[#d87545]"
                              />
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
                              <input
                                type="text"
                                value={editEmployee.department}
                                onChange={(e) => setEditEmployee((current) => ({ ...current, department: e.target.value }))}
                                placeholder="Department"
                                className="w-full px-4 py-3 rounded-xl bg-[#f9f6f0] border border-[#d4cbb7] focus:outline-none focus:ring-2 focus:ring-[#d87545]"
                              />
                              <input
                                type="text"
                                value={editEmployee.job_title}
                                onChange={(e) => setEditEmployee((current) => ({ ...current, job_title: e.target.value }))}
                                placeholder="Job title"
                                className="w-full px-4 py-3 rounded-xl bg-[#f9f6f0] border border-[#d4cbb7] focus:outline-none focus:ring-2 focus:ring-[#d87545]"
                              />
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
