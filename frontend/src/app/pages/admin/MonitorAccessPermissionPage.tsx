import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LogOut, ArrowLeft, Edit2, Trash2, Plus, Check, X } from 'lucide-react';
import { Navigation } from '../../components/Navigation';
import { Footer } from '../../components/Footer';
import { WarningModal } from '../../components/WarningModal';
import { ConfirmationModal } from '../../components/ConfirmationModal';

export function MonitorAccessPermissionPage() {
  const navigate = useNavigate();
  const [permissions, setPermissions] = useState([
    { id: 1, name: 'Sarah Johnson', email: 'sarah.j@factory.com', date: '2026-01-05', time: '09:30 AM', status: 'Active' },
    { id: 2, name: 'Mike Chen', email: 'mike.c@factory.com', date: '2026-01-04', time: '02:15 PM', status: 'Active' },
    { id: 3, name: 'Emma Davis', email: 'emma.d@factory.com', date: '2026-01-03', time: '11:20 AM', status: 'Inactive' }
  ]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ name: '', email: '', status: 'Active' });
  const [isAdding, setIsAdding] = useState(false);
  const [newPermission, setNewPermission] = useState({ name: '', email: '', status: 'Active' });
  const [modalState, setModalState] = useState({ isOpen: false, title: '', message: '' });
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; permissionId: number | null; name: string }>({ 
    isOpen: false, 
    permissionId: null, 
    name: '' 
  });
  
  const handleEdit = (permission: any) => {
    setEditingId(permission.id);
    setEditForm({ name: permission.name, email: permission.email, status: permission.status });
  };
  
  const handleSaveEdit = (id: number) => {
    if (!editForm.name || !editForm.email) {
      setModalState({
        isOpen: true,
        title: 'Missing Information',
        message: 'Please fill in both name and email fields.'
      });
      return;
    }
    
    setPermissions(permissions.map(p => 
      p.id === id ? { 
        ...p, 
        name: editForm.name, 
        email: editForm.email, 
        status: editForm.status,
        date: new Date().toISOString().split('T')[0],
        time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
      } : p
    ));
    setEditingId(null);
    setModalState({
      isOpen: true,
      title: 'Success',
      message: 'Permission updated successfully!'
    });
  };
  
  const handleCancelEdit = () => {
    setEditingId(null);
    setEditForm({ name: '', email: '', status: 'Active' });
  };
  
  const handleDelete = (id: number) => {
    setPermissions(permissions.filter(p => p.id !== id));
    setDeleteConfirm({ isOpen: false, permissionId: null, name: '' });
    setModalState({
      isOpen: true,
      title: 'Success',
      message: 'Permission deleted successfully!'
    });
  };
  
  const handleDeleteClick = (permission: any) => {
    setDeleteConfirm({
      isOpen: true,
      permissionId: permission.id,
      name: permission.name
    });
  };
  
  const handleCancelDelete = () => {
    setDeleteConfirm({ isOpen: false, permissionId: null, name: '' });
  };
  
  const confirmDelete = () => {
    if (deleteConfirm.permissionId) {
      handleDelete(deleteConfirm.permissionId);
    }
  };
  
  const handleAddNew = () => {
    if (!newPermission.name || !newPermission.email) {
      setModalState({
        isOpen: true,
        title: 'Missing Information',
        message: 'Please fill in both name and email fields.'
      });
      return;
    }
    
    const permission = {
      id: Math.max(...permissions.map(p => p.id), 0) + 1,
      name: newPermission.name,
      email: newPermission.email,
      date: new Date().toISOString().split('T')[0],
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      status: newPermission.status
    };
    
    setPermissions([permission, ...permissions]);
    setNewPermission({ name: '', email: '', status: 'Active' });
    setIsAdding(false);
    setModalState({
      isOpen: true,
      title: 'Success',
      message: 'New permission added successfully!'
    });
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
          
          <h1 className="font-serif text-4xl text-[#4a3c2a] mb-8">Admin – Monitor Access Permission</h1>
          
          <div className="max-w-4xl">
            <h2 className="font-serif text-3xl text-[#9e2a2b] mb-8">Permission history</h2>
            
            {/* Permission History Table */}
            <div className="bg-[#f3d9c5] rounded-2xl p-6 mb-12">
              <table className="w-full">
                <thead>
                  <tr className="border-b-2 border-[#d87545]">
                    <th className="text-left py-3 text-[#9e2a2b] font-normal">Name</th>
                    <th className="text-left py-3 text-[#9e2a2b] font-normal">Email</th>
                    <th className="text-left py-3 text-[#9e2a2b] font-normal">last log date & time</th>
                    <th className="text-left py-3 text-[#9e2a2b] font-normal">Status</th>
                    <th className="text-left py-3 text-[#9e2a2b] font-normal">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {permissions.map((permission, index) => (
                    <tr key={index} className="border-b border-[#e0c9b3]">
                      <td className="py-4 text-[#8b4a32]">
                        {editingId === permission.id ? (
                          <input
                            type="text"
                            value={editForm.name}
                            onChange={(e) => setEditForm({...editForm, name: e.target.value})}
                            className="w-full px-4 py-3 rounded-xl bg-[#d4bfa7] border-none focus:outline-none focus:ring-2 focus:ring-[#d87545]"
                          />
                        ) : (
                          permission.name
                        )}
                      </td>
                      <td className="py-4 text-[#8b4a32]">
                        {editingId === permission.id ? (
                          <input
                            type="email"
                            value={editForm.email}
                            onChange={(e) => setEditForm({...editForm, email: e.target.value})}
                            className="w-full px-4 py-3 rounded-xl bg-[#d4bfa7] border-none focus:outline-none focus:ring-2 focus:ring-[#d87545]"
                          />
                        ) : (
                          permission.email
                        )}
                      </td>
                      <td className="py-4 text-[#8b4a32]">
                        {permission.date}<br/>{permission.time}
                      </td>
                      <td className="py-4 text-[#8b4a32]">
                        {editingId === permission.id ? (
                          <select
                            value={editForm.status}
                            onChange={(e) => setEditForm({...editForm, status: e.target.value})}
                            className="w-full px-4 py-3 rounded-xl bg-[#d4bfa7] border-none focus:outline-none focus:ring-2 focus:ring-[#d87545]"
                          >
                            <option value="Active">Active</option>
                            <option value="Inactive">Inactive</option>
                          </select>
                        ) : (
                          permission.status
                        )}
                      </td>
                      <td className="py-4 text-[#8b4a32]">
                        {editingId === permission.id ? (
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleSaveEdit(permission.id)}
                              className="px-4 py-2 bg-[#d87545] text-white rounded-full shadow-md hover:bg-[#c42c1f] transition-colors"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button
                              onClick={handleCancelEdit}
                              className="px-4 py-2 bg-[#d87545] text-white rounded-full shadow-md hover:bg-[#c42c1f] transition-colors"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleEdit(permission)}
                              className="px-4 py-2 bg-[#d87545] text-white rounded-full shadow-md hover:bg-[#c42c1f] transition-colors"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteClick(permission)}
                              className="px-4 py-2 bg-[#d87545] text-white rounded-full shadow-md hover:bg-[#c42c1f] transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            {/* Add New Permission Button and Form */}
            {!isAdding ? (
              <div className="flex justify-start">
                <button
                  onClick={() => setIsAdding(true)}
                  className="px-8 py-3 bg-[#d87545] text-white rounded-full shadow-md hover:bg-[#c42c1f] transition-colors flex items-center gap-2"
                >
                  <Plus className="w-5 h-5" />
                  Add New Permission
                </button>
              </div>
            ) : (
              <div className="space-y-6 bg-[#f3d9c5] rounded-2xl p-6">
                <h3 className="font-serif text-2xl text-[#9e2a2b] mb-4">Add New Permission</h3>
                <div>
                  <label className="block text-[#9e2a2b] mb-2 italic">Employee Name</label>
                  <input
                    type="text"
                    value={newPermission.name}
                    onChange={(e) => setNewPermission({...newPermission, name: e.target.value})}
                    className="w-full px-4 py-3 rounded-xl bg-[#d4bfa7] border-none focus:outline-none focus:ring-2 focus:ring-[#d87545]"
                  />
                </div>
                
                <div>
                  <label className="block text-[#9e2a2b] mb-2 italic">Employee Email</label>
                  <input
                    type="email"
                    value={newPermission.email}
                    onChange={(e) => setNewPermission({...newPermission, email: e.target.value})}
                    className="w-full px-4 py-3 rounded-xl bg-[#d4bfa7] border-none focus:outline-none focus:ring-2 focus:ring-[#d87545]"
                  />
                </div>
                
                <div>
                  <label className="block text-[#9e2a2b] mb-2 italic">Status</label>
                  <select
                    value={newPermission.status}
                    onChange={(e) => setNewPermission({...newPermission, status: e.target.value})}
                    className="w-full px-4 py-3 rounded-xl bg-[#d4bfa7] border-none focus:outline-none focus:ring-2 focus:ring-[#d87545]"
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>
                
                <div className="flex gap-4 pt-4">
                  <button
                    onClick={handleAddNew}
                    className="px-8 py-3 bg-[#d87545] text-white rounded-full shadow-md hover:bg-[#c42c1f] transition-colors flex items-center gap-2"
                  >
                    <Check className="w-5 h-5" />
                    Save Permission
                  </button>
                  <button
                    onClick={() => {
                      setIsAdding(false);
                      setNewPermission({ name: '', email: '', status: 'Active' });
                    }}
                    className="px-8 py-3 bg-[#8b7355] text-white rounded-full shadow-md hover:bg-[#6b5d4f] transition-colors flex items-center gap-2"
                  >
                    <X className="w-5 h-5" />
                    Cancel
                  </button>
                </div>
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
      
      <ConfirmationModal
        isOpen={deleteConfirm.isOpen}
        onCancel={handleCancelDelete}
        onConfirm={confirmDelete}
        title="Confirm Delete"
        message={`Are you sure you want to delete the permission for ${deleteConfirm.name}?`}
      />
      
      <Footer />
    </div>
  );
}