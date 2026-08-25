"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Tooltip } from "@/components/ui/tooltip";
import { getVehicleCategories, createCategory, updateCategory, deleteCategory } from "@/services/vehicle.service";
import { Plus, Pencil, Archive, Layers, Loader2 } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { useRequireRole } from "@/lib/auth/role-guard";
import { useFormValidation } from "@/lib/validation/useFormValidation";

const categorySchema = {
  category_name: { required: true, maxLength: 100, label: "Category name" },
  description: { maxLength: 500, label: "Description" },
  seating_capacity: { type: "seating", label: "Default seating capacity" },
};

export default function CategoriesPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager"]);
  const queryClient = useQueryClient();
  const [editingCategory, setEditingCategory] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formData, setFormData] = useState({ category_name: "", description: "", seating_capacity: "" });
  const [formError, setFormError] = useState(null);
  const { validate, fieldError, registerField, resetValidation } = useFormValidation(categorySchema);

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ["vehicle-categories"],
    queryFn: () => getVehicleCategories(),
  });

  const createMutation = useMutation({
    mutationFn: createCategory,
    onSuccess: () => {
      toast.success("Category created successfully");
      queryClient.invalidateQueries({ queryKey: ["vehicle-categories"] });
      closeDialog();
    },
    onError: (err) => setFormError(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => updateCategory(id, data),
    onSuccess: () => {
      toast.success("Category updated successfully");
      queryClient.invalidateQueries({ queryKey: ["vehicle-categories"] });
      closeDialog();
    },
    onError: (err) => setFormError(err.message),
  });

  const archiveMutation = useMutation({
    mutationFn: (id) => deleteCategory(id),
    onSuccess: () => {
      toast.success("Category archived successfully");
      queryClient.invalidateQueries({ queryKey: ["vehicle-categories"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const [archivingCategory, setArchivingCategory] = useState(null);

  function openNewDialog() {
    setEditingCategory(null);
    setFormData({ category_name: "", description: "", seating_capacity: "" });
    setFormError(null);
    resetValidation();
    setDialogOpen(true);
  }

  function openEditDialog(cat) {
    setEditingCategory(cat);
    setFormData({
      category_name: cat.category_name || "",
      description: cat.description || "",
      seating_capacity: cat.seating_capacity ?? "",
    });
    setFormError(null);
    resetValidation();
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

    const isValid = validate(formData, {
      onSuccess: () => {
        const payload = {
          category_name: formData.category_name.trim(),
          description: formData.description.trim() || null,
          seating_capacity: formData.seating_capacity ? Number(formData.seating_capacity) : null,
        };
        if (editingCategory) {
          updateMutation.mutate({ id: editingCategory.category_id, data: payload });
        } else {
          createMutation.mutate(payload);
        }
      },
    });
    if (!isValid) return;
  }

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Hotel Vehicle Categories</h1>
          <p className="text-foreground-secondary mt-1">Manage operational categories for guest shuttle, VIP transport, and hotel logistics</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); setDialogOpen(open); }}>
          <DialogTrigger asChild>
            <Button className="h-10" onClick={openNewDialog}>
              <Plus className="w-4 h-4 mr-2" />
              Add Category
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg w-[95vw] md:w-[480px] p-0 overflow-hidden rounded-3xl bg-surface border border-border/80 shadow-2xl">
            <div className="px-6 py-4 border-b border-border/70 bg-surface/80 backdrop-blur-md flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20 shadow-2xs">
                  <Layers className="h-5 w-5" />
                </div>
                <div>
                  <DialogTitle className="text-base font-bold text-foreground">
                    {editingCategory ? "Edit Hotel Category" : "Add Hotel Category"}
                  </DialogTitle>
                  <p className="text-xs text-foreground-muted mt-0.5">
                    Operational category classification for guest shuttle and VIP fleet.
                  </p>
                </div>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="rounded-2xl bg-muted/40 p-1.5 border border-border/80 shadow-2xs">
                <div className="rounded-xl bg-surface p-4 border border-border/50 space-y-3.5">
                  <div className="space-y-1.5">
                    <Label htmlFor="category_name" className="text-xs font-semibold text-foreground">
                      Category Name <span className="text-danger">*</span>
                    </Label>
                    <Input
                      id="category_name"
                      value={formData.category_name}
                      onChange={(e) => setFormData({ ...formData, category_name: e.target.value })}
                      ref={registerField("category_name")}
                      invalid={fieldError("category_name").invalid}
                      placeholder="e.g. VIP Guest Transport, Guest Shuttle"
                      className="text-sm font-semibold h-10"
                      autoFocus
                    />
                    {fieldError("category_name").error && <p className="text-xs text-danger">{fieldError("category_name").error}</p>}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="description" className="text-xs font-semibold text-foreground">
                      Description <span className="text-foreground-muted font-normal text-[11px]">(Optional)</span>
                    </Label>
                    <Input
                      id="description"
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      ref={registerField("description")}
                      invalid={fieldError("description").invalid}
                      placeholder="e.g. Executive airport pickups for VIP guests"
                      className="text-xs h-9"
                    />
                    {fieldError("description").error && <p className="text-xs text-danger">{fieldError("description").error}</p>}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="seating_capacity" className="text-xs font-semibold text-foreground">
                      Default Passenger Capacity
                    </Label>
                    <div className="relative">
                      <Input
                        id="seating_capacity"
                        type="number"
                        min="1"
                        value={formData.seating_capacity}
                        onChange={(e) => setFormData({ ...formData, seating_capacity: e.target.value })}
                        ref={registerField("seating_capacity")}
                        invalid={fieldError("seating_capacity").invalid}
                        placeholder="e.g. 7"
                        className="text-sm font-data font-semibold pr-14 h-10"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-foreground-muted pointer-events-none">
                        seats
                      </span>
                    </div>
                    {fieldError("seating_capacity").error && <p className="text-xs text-danger">{fieldError("seating_capacity").error}</p>}
                  </div>
                </div>
              </div>

              {formError && <p className="text-xs font-semibold text-danger">{formError}</p>}

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <Button type="button" variant="outline" onClick={closeDialog} className="text-xs h-9 px-4">
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting} className="text-xs h-9 px-5 font-bold shadow-xs">
                  {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
                  {editingCategory ? "Update Category" : "Create Category"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {categories.map((cat) => (
          <Card key={cat.category_id} className="border-0 shadow-sm hover:shadow-md transition-shadow">
            <CardContent className="p-5 flex flex-col justify-between h-full">
              <div className="space-y-2">
                <div className="flex items-start justify-between">
                  <h3 className="font-semibold text-foreground text-base">{cat.category_name}</h3>
                  <Badge variant={cat.status === "Active" ? "success" : "secondary"} className="text-[10px]">
                    {cat.status || "Active"}
                  </Badge>
                </div>
                {cat.description && (
                  <p className="text-xs text-foreground-secondary leading-relaxed">{cat.description}</p>
                )}
                {cat.seating_capacity && (
                  <div className="pt-2">
                    <span className="text-xs text-foreground-muted">Default Capacity: </span>
                    <span className="text-xs font-semibold text-foreground">{cat.seating_capacity} seats</span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-1 mt-4 pt-3 border-t border-border justify-end">
                <Tooltip content="Edit Category">
                  <Button variant="ghost" size="icon" className="w-8 h-8" onClick={() => openEditDialog(cat)}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                </Tooltip>
                <Tooltip content="Archive Category">
                  <Button variant="ghost" size="icon" className="w-8 h-8 text-warning hover:text-warning hover:bg-warning/10" onClick={() => setArchivingCategory(cat)}>
                    <Archive className="w-3.5 h-3.5" />
                  </Button>
                </Tooltip>
              </div>
            </CardContent>
          </Card>
        ))}

        {!isLoading && categories.length === 0 && (
          <Card className="border-0 shadow-sm col-span-full">
            <CardContent className="py-12 text-center text-foreground-muted">
              <p className="text-lg font-medium">No hotel categories yet</p>
              <p className="text-sm mt-1">Add your first vehicle category to get started</p>
            </CardContent>
          </Card>
        )}
      </div>

      <ConfirmDialog
        open={!!archivingCategory}
        onOpenChange={(open) => { if (!open) setArchivingCategory(null); }}
        title={`Archive "${archivingCategory?.category_name || ""}"?`}
        message="This category will be archived and hidden from active vehicle selection lists."
        confirmLabel="Archive Category"
        variant="archive"
        onConfirm={() => { if (archivingCategory) archiveMutation.mutate(archivingCategory.category_id); }}
      />
    </div>
  );
}
