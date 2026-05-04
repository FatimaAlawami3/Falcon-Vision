import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Upload, ArrowLeft, Plus } from 'lucide-react';
import { Navigation } from '../../components/Navigation';
import { Footer } from '../../components/Footer';
import { WarningModal } from '../../components/WarningModal';
import { getAccessToken } from '../../lib/auth';
import {
  createEmployee,
  listEmployees,
  uploadEmployeeFaces,
  type EmployeeFaceUploadResponse,
  type EmployeeListResponse,
} from '../../lib/api';

type QuickEmployeeFormState = {
  employee_number: string;
  full_name: string;
  department: string;
  job_title: string;
};

const emptyQuickEmployeeForm: QuickEmployeeFormState = {
  employee_number: '',
  full_name: '',
  department: '',
  job_title: '',
};

export function UploadEmployeeFacesPage() {
  const [employeeId, setEmployeeId] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [lastResult, setLastResult] = useState<EmployeeFaceUploadResponse | null>(null);
  const [employees, setEmployees] = useState<EmployeeListResponse['items']>([]);
  const [isLoadingEmployees, setIsLoadingEmployees] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showQuickAddEmployee, setShowQuickAddEmployee] = useState(false);
  const [quickEmployeeForm, setQuickEmployeeForm] = useState<QuickEmployeeFormState>(emptyQuickEmployeeForm);
  const [isCreatingEmployee, setIsCreatingEmployee] = useState(false);
  const [modalState, setModalState] = useState({ isOpen: false, title: '', message: '' });

  const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'application/zip', 'application/x-zip-compressed'];

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles) {
      return;
    }

    const normalizedFiles = Array.from(selectedFiles);
    const allValid = normalizedFiles.every((file) => {
      if (file.type) {
        return validTypes.includes(file.type);
      }

      return /\.(jpg|jpeg|png|zip)$/i.test(file.name);
    });

    if (!allValid) {
      setModalState({
        isOpen: true,
        title: 'Warning!',
        message: 'Unsupported file type! Please use .jpg, .jpeg, .png, or .zip files.',
      });
      return;
    }

    setFiles(normalizedFiles);
    setLastResult(null);
  };

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      setIsLoadingEmployees(false);
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
          message: error instanceof Error ? error.message : 'Could not load employees for face upload.',
        });
      })
      .finally(() => {
        setIsLoadingEmployees(false);
      });
  }, []);

  const handleCreateEmployee = async () => {
    const token = getAccessToken();

    if (!token) {
      setModalState({
        isOpen: true,
        title: 'Session Expired',
        message: 'Please log in again before creating an employee.',
      });
      return;
    }

    if (!quickEmployeeForm.employee_number.trim() || !quickEmployeeForm.full_name.trim()) {
      setModalState({
        isOpen: true,
        title: 'Missing Employee Information',
        message: 'ID and full name are required before you can upload face images.',
      });
      return;
    }

    setIsCreatingEmployee(true);
    try {
      const payload = {
        employee_number: quickEmployeeForm.employee_number.trim(),
        full_name: quickEmployeeForm.full_name.trim(),
        department: quickEmployeeForm.department.trim() || undefined,
        job_title: quickEmployeeForm.job_title.trim() || undefined,
      };

      const createdEmployee = await createEmployee(payload, token);
      setEmployees((currentEmployees) => [createdEmployee, ...currentEmployees]);
      setEmployeeId(createdEmployee.id);
      setShowQuickAddEmployee(false);
      setQuickEmployeeForm(emptyQuickEmployeeForm);
      setModalState({
        isOpen: true,
        title: 'Employee Created',
        message: 'The employee profile was created successfully. You can now upload face images for them.',
      });
    } catch (error) {
      setModalState({
        isOpen: true,
        title: 'Unable to Create Employee',
        message: error instanceof Error ? error.message : 'Something went wrong while creating the employee.',
      });
    } finally {
      setIsCreatingEmployee(false);
    }
  };

  const handleSave = async () => {
    const token = getAccessToken();

    if (!token) {
      setModalState({
        isOpen: true,
        title: 'Session Expired',
        message: 'Please log in again before uploading employee faces.',
      });
      return;
    }

    if (!employeeId.trim()) {
      setModalState({
        isOpen: true,
        title: 'Select an Employee',
        message: 'Create or choose an employee before uploading face images.',
      });
      return;
    }

    if (files.length === 0) {
      setModalState({
        isOpen: true,
        title: 'No Files Selected',
        message: 'Please select files to upload.',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await uploadEmployeeFaces(employeeId.trim(), files, token);
      setLastResult(result);
      setModalState({
        isOpen: true,
        title: result.failed_count > 0 ? 'Upload Completed with Notes' : 'Success',
        message:
          result.failed_count > 0
            ? `${result.uploaded_count} file(s) uploaded. ${result.failed_count} file(s) could not be processed.`
            : `${result.uploaded_count} file(s) uploaded successfully.`,
      });

      if (result.uploaded_count > 0) {
        setFiles([]);
      }
    } catch (error) {
      setModalState({
        isOpen: true,
        title: 'Upload Failed',
        message: error instanceof Error ? error.message : 'Something went wrong while uploading employee faces.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#f5f3ed]">
      <Navigation isAdmin={true} />

      <div className="flex-1 py-12 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-4 mb-8">
            <Link
              to="/admin/settings"
              className="flex items-center gap-2 text-[#ff8c42] hover:text-[#ff7a2e] transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
              Back
            </Link>
          </div>

          <h1 className="font-serif text-4xl text-[#4a3c2a] mb-3">Admin - Upload Employee Faces</h1>
          <p className="text-[#6b5d4f] mb-8 max-w-3xl">
            This page connects employee profiles to face-recognition images. If the employee does not exist yet,
            create their profile first, then select them and upload their face images.
          </p>

          <div className="bg-white rounded-3xl shadow-xl p-8 border border-[#d4cbb7]">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
              <div>
                <h2 className="font-serif text-2xl text-[#4a3c2a]">Face enrollment</h2>
                <p className="text-sm text-[#6b5d4f] mt-1">
                  Step 1: create or choose the employee by ID. Step 2: attach their images.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link
                  to="/admin/employees"
                  className="px-5 py-2.5 rounded-full border border-[#d4cbb7] text-[#d87545] hover:bg-[#f9f6f0] transition-colors"
                >
                  Manage Employees
                </Link>
                <button
                  type="button"
                  onClick={() => setShowQuickAddEmployee((current) => !current)}
                  className="px-5 py-2.5 rounded-full bg-[#ff8c42] text-white hover:bg-[#ff7a2e] transition-colors flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  {showQuickAddEmployee ? 'Hide Quick Add' : 'Add Employee'}
                </button>
              </div>
            </div>

            {(showQuickAddEmployee || (!isLoadingEmployees && employees.length === 0)) && (
              <div className="mb-8 rounded-2xl border border-[#d4cbb7] bg-[#f9f6f0] p-6">
                <h3 className="font-serif text-xl text-[#4a3c2a] mb-4">Create employee profile first</h3>
                <div className="grid md:grid-cols-2 gap-4">
                  <input
                    type="text"
                    placeholder="ID"
                    value={quickEmployeeForm.employee_number}
                    onChange={(e) => setQuickEmployeeForm((current) => ({ ...current, employee_number: e.target.value }))}
                    className="w-full rounded-2xl border border-[#d4cbb7] px-5 py-3 text-[#4a3c2a] focus:outline-none focus:ring-2 focus:ring-[#ff8c42]/40"
                  />
                  <input
                    type="text"
                    placeholder="Full name"
                    value={quickEmployeeForm.full_name}
                    onChange={(e) => setQuickEmployeeForm((current) => ({ ...current, full_name: e.target.value }))}
                    className="w-full rounded-2xl border border-[#d4cbb7] px-5 py-3 text-[#4a3c2a] focus:outline-none focus:ring-2 focus:ring-[#ff8c42]/40"
                  />
                  <input
                    type="text"
                    placeholder="Department"
                    value={quickEmployeeForm.department}
                    onChange={(e) => setQuickEmployeeForm((current) => ({ ...current, department: e.target.value }))}
                    className="w-full rounded-2xl border border-[#d4cbb7] px-5 py-3 text-[#4a3c2a] focus:outline-none focus:ring-2 focus:ring-[#ff8c42]/40"
                  />
                  <input
                    type="text"
                    placeholder="Job title"
                    value={quickEmployeeForm.job_title}
                    onChange={(e) => setQuickEmployeeForm((current) => ({ ...current, job_title: e.target.value }))}
                    className="w-full rounded-2xl border border-[#d4cbb7] px-5 py-3 text-[#4a3c2a] focus:outline-none focus:ring-2 focus:ring-[#ff8c42]/40"
                  />
                </div>
                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => void handleCreateEmployee()}
                    disabled={isCreatingEmployee}
                    className="bg-[#ff8c42] text-white px-6 py-3 rounded-full shadow-md hover:bg-[#ff7a2e] transition-colors disabled:opacity-70"
                  >
                    {isCreatingEmployee ? 'Creating Employee...' : 'Save Employee'}
                  </button>
                  {showQuickAddEmployee && employees.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowQuickAddEmployee(false);
                        setQuickEmployeeForm(emptyQuickEmployeeForm);
                      }}
                      className="bg-[#8b7355] text-white px-6 py-3 rounded-full shadow-md hover:bg-[#6b5d4f] transition-colors"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="mb-6">
              <label htmlFor="employee-id" className="block text-[#4a3c2a] font-medium mb-2">
                Employee ID
              </label>
              <select
                id="employee-id"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                className="w-full rounded-2xl border border-[#d4cbb7] px-5 py-3 text-[#4a3c2a] focus:outline-none focus:ring-2 focus:ring-[#ff8c42]/40"
                disabled={isLoadingEmployees || employees.length === 0}
              >
                <option value="">
                  {isLoadingEmployees
                    ? 'Loading employees...'
                    : employees.length > 0
                      ? 'Select an employee ID'
                      : 'No employees found - create one above'}
                </option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.employee_number} - {employee.full_name}
                  </option>
                ))}
              </select>
              <p className="text-sm text-[#6b5d4f] mt-2">
                Face images are attached to employee profiles. Supervisors appear here too once their linked employee
                profile exists.
              </p>
            </div>

            <div className="border-2 border-dashed border-[#d4cbb7] rounded-2xl p-12 text-center hover:border-[#ff8c42] transition-colors mb-6">
              <Upload className="w-16 h-16 text-[#ff8c42] mx-auto mb-4" />
              <h3 className="font-serif text-xl text-[#4a3c2a] mb-2">Drag & Drop Images Here</h3>
              <p className="text-[#6b5d4f] mb-4">Supported formats: .jpg, .jpeg, .png, .zip</p>
              <label className="inline-block">
                <input
                  type="file"
                  multiple
                  accept=".jpg,.jpeg,.png,.zip"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <span className="bg-[#ff8c42] text-white px-6 py-3 rounded-full shadow-md hover:bg-[#ff7a2e] transition-colors cursor-pointer inline-block">
                  Select Files
                </span>
              </label>
              {files.length > 0 && (
                <div className="mt-4">
                  <p className="text-[#4a3c2a] font-medium">{files.length} file(s) selected</p>
                  <div className="mt-3 space-y-1 text-sm text-[#6b5d4f]">
                    {files.slice(0, 5).map((file) => (
                      <p key={`${file.name}-${file.size}`}>{file.name}</p>
                    ))}
                    {files.length > 5 && <p>And {files.length - 5} more file(s)...</p>}
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={handleSave}
              disabled={isSubmitting}
              className="w-full bg-[#ff8c42] text-white py-3 rounded-full shadow-md hover:bg-[#ff7a2e] transition-colors disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSubmitting ? 'Uploading...' : 'Save'}
            </button>

            {lastResult && (
              <div className="mt-6 rounded-2xl border border-[#d4cbb7] bg-[#f9f6f0] p-5">
                <h2 className="font-serif text-2xl text-[#4a3c2a] mb-3">Last Upload Summary</h2>
                <div className="grid sm:grid-cols-2 gap-4 text-sm">
                  <div className="rounded-2xl bg-white p-4 border border-[#e5dcc9]">
                    <p className="text-[#6b5d4f]">Uploaded</p>
                    <p className="text-2xl font-semibold text-[#1f7a4d]">{lastResult.uploaded_count}</p>
                  </div>
                  <div className="rounded-2xl bg-white p-4 border border-[#e5dcc9]">
                    <p className="text-[#6b5d4f]">Failed</p>
                    <p className="text-2xl font-semibold text-[#b14a2c]">{lastResult.failed_count}</p>
                  </div>
                </div>

                {lastResult.failures.length > 0 && (
                  <div className="mt-4">
                    <h3 className="text-[#4a3c2a] font-medium mb-2">Files that need attention</h3>
                    <div className="space-y-2 text-sm">
                      {lastResult.failures.map((failure) => (
                        <div
                          key={`${failure.filename}-${failure.detail}`}
                          className="rounded-xl bg-white border border-[#e5dcc9] p-3"
                        >
                          <p className="font-medium text-[#4a3c2a]">{failure.filename}</p>
                          <p className="text-[#6b5d4f]">{failure.detail}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <WarningModal
        isOpen={modalState.isOpen}
        onClose={() => setModalState({ ...modalState, isOpen: false })}
        title={modalState.title}
        message={modalState.message}
      />

      <Footer />
    </div>
  );
}
