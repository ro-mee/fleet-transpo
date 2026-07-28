"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Tooltip } from "@/components/ui/tooltip";
import { getVehicleCategories, createCategory, updateCategory, deleteCategory } from "@/services/vehicle.service";
import { Plus, Pencil, Archive } from "lucide-react";

export default function CategoriesPage() {
  const queryClient = useQueryClient();
  const [editingCategory, setEditingCategory] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formData, setFormData] = useState({ category_name: "", description: "", seating_capacity: "", base_rate: "", per_km_rate: "", per_hour_rate: "" });
  const [formError, setFormError] = useState(null);

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ["vehicle-categories"],
    queryFn: () => getVehicleCategories(),
  });

  const createMutation = useMutation({
    mutationFn: createCategory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vehicle-categories"] });
      closeDialog();
    },
    onError: (err) => setFormError(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => updateCategory(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vehicle-categories"] });
      closeDialog();
    },
    onError: (err) => setFormError(err.message),
  });

  const archiveMutation = useMutation({
    mutationFn: (id) => deleteCategory(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["vehicle-categories"] }),
  });

  const [archivingCategory, setArchivingCategory] = useState(null);

  function openNewDialog() {
    setEditingCategory(null);
    setFormData({ category_name: "", description: "", seating_capacity: "", base_rate: "", per_km_rate: "", per_hour_rate: "" });
    setFormError(null);
    setDialogOpen(true);
  }

  function openEditDialog(cat) {
    setEditingCategory(cat);
    setFormData({
      category_name: cat.category_name || "",
      description: cat.description || "",
      seating_capacity: cat.seating_capacity ?? "",
      base_rate: cat.base_rate ?? "",
      per_km_rate: cat.per_km_rate ?? "",
      per_hour_rate: cat.per_hour_rate ?? "",
    });
    setFormError(null);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingCategory(null);
    setFormError(null);
  }

  function handleSubmit(e) {
    e.preventDefault();
    setFormError(null);
    if (!formData.category_name.trim()) {
      setFormError("Category name is required");
      return;
    }
    const payload = {
      category_name: formData.category_name.trim(),
      description: formData.description.trim() || null,
      seating_capacity: formData.seating_capacity ? Number(formData.seating_capacity) : null,
      base_rate: formData.base_rate ? Number(formData.base_rate) : null,
      per_km_rate: formData.per_km_rate ? Number(formData.per_km_rate) : null,
      per_hour_rate: formData.per_hour_rate ? Number(formData.per_hour_rate) : null,
    };
    if (editingCategory) {
      updateMutation.mutate({ id: editingCategory.category_id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  function handleDelete(cat) {
    setArchivingCategory(cat);
  }

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Vehicle Categories</h1>
          <p className="text-foreground-secondary mt-1">Manage vehicle categories and rates</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); setDialogOpen(open); }}>
          <DialogTrigger asChild>
            <Button className="h-10" onClick={openNewDialog}>
              <Plus className="w-4 h-4 mr-2" />
              Add Category
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingCategory ? "Edit Category" : "Add Category"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="category_name">Category Name *</Label>
                <Input id="category_name" value={formData.category_name} onChange={(e) => setFormData({ ...formData, category_name: e.target.value })} placeholder="e.g. Sedan, SUV, Van" required />
              </div>
              <div>
                <Label htmlFor="description">Description</Label>
                <Input id="description" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="Brief description" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="seating_capacity">Seating Capacity</Label>
                  <Input id="seating_capacity" type="number" min="1" value={formData.seating_capacity} onChange={(e) => setFormData({ ...formData, seating_capacity: e.target.value })} placeholder="e.g. 4" />
                </div>
                <div>
                  <Label htmlFor="base_rate">Base Rate (₱)</Label>
                  <Input id="base_rate" type="number" min="0" step="0.01" value={formData.base_rate} onChange={(e) => setFormData({ ...formData, base_rate: e.target.value })} placeholder="0.00" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="per_km_rate">Per KM Rate (₱)</Label>
                  <Input id="per_km_rate" type="number" min="0" step="0.01" value={formData.per_km_rate} onChange={(e) => setFormData({ ...formData, per_km_rate: e.target.value })} placeholder="0.00" />
                </div>
                <div>
                  <Label htmlFor="per_hour_rate">Per Hour Rate (₱)</Label>
                  <Input id="per_hour_rate" type="number" min="0" step="0.01" value={formData.per_hour_rate} onChange={(e) => setFormData({ ...formData, per_hour_rate: e.target.value })} placeholder="0.00" />
                </div>
              </div>
              {formError && <p className="text-sm text-destructive">{formError}</p>}
              <div className="flex items-center justify-end gap-3 pt-2">
                <Button type="button" variant="outline" onClick={closeDialog}>Cancel</Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Saving..." : editingCategory ? "Update Category" : "Create Category"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {categories.map((cat) => (
          <Card key={cat.category_id}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-foreground">{cat.category_name}</h3>
                  {cat.description && (
                    <p className="text-xs text-foreground-muted mt-0.5">{cat.description}</p>
                  )}
                </div>
                <Badge variant={cat.status === "Active" ? "success" : "secondary"} className="text-[10px]">
                  {cat.status}
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {cat.seating_capacity && (
                  <div>
                    <p className="text-foreground-muted text-xs">Capacity</p>
                    <p className="font-medium text-foreground">{cat.seating_capacity} seats</p>
                  </div>
                )}
                {cat.base_rate && (
                  <div>
                    <p className="text-foreground-muted text-xs">Base Rate</p>
                    <p className="font-medium text-foreground">₱{cat.base_rate}</p>
                  </div>
                )}
                {cat.per_km_rate && (
                  <div>
                    <p className="text-foreground-muted text-xs">Per KM</p>
                    <p className="font-medium text-foreground">₱{cat.per_km_rate}</p>
                  </div>
                )}
                {cat.per_hour_rate && (
                  <div>
                    <p className="text-foreground-muted text-xs">Per Hour</p>
                    <p className="font-medium text-foreground">₱{cat.per_hour_rate}</p>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 mt-4 pt-3 border-t border-border">
                <Tooltip content="Edit">
                  <Button variant="ghost" size="icon" className="w-8 h-8" onClick={() => openEditDialog(cat)}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                </Tooltip>
                <Tooltip content="Archive">
                  <Button variant="ghost" size="icon" className="w-8 h-8 text-danger" onClick={() => handleDelete(cat)}>
                    <Archive className="w-4 h-4" />
                  </Button>
                </Tooltip>
              </div>
            </CardContent>
          </Card>
        ))}
        {!isLoading && categories.length === 0 && (
          <Card className="border-0 shadow-sm col-span-full">
            <CardContent className="py-12 text-center text-foreground-muted">
              <p className="text-lg font-medium">No categories yet</p>
              <p className="text-sm mt-1">Add your first vehicle category to get started</p>
            </CardContent>
          </Card>
        )}
      </div>

      <ConfirmDialog
        open={!!archivingCategory}
        onOpenChange={(open) => { if (!open) setArchivingCategory(null); }}
        title={`Archive "${archivingCategory?.category_name || ""}"?`}
        message="This category will be deactivated and hidden from active lists."
        confirmLabel="Archive"
        variant="archive"
        onConfirm={() => { if (archivingCategory) archiveMutation.mutate(archivingCategory.category_id); }}
      />
    </div>
  );
}
