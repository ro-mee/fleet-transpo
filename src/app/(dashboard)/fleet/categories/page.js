"use client";

import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getVehicleCategories } from "@/services/vehicle.service";
import { Plus, Pencil, Trash2 } from "lucide-react";

export default function CategoriesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ["vehicle-categories"],
    queryFn: () => getVehicleCategories(),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Vehicle Categories</h1>
          <p className="text-foreground-secondary mt-1">Manage vehicle categories and rates</p>
        </div>
        <Button className="h-10">
          <Plus className="w-4 h-4 mr-2" />
          Add Category
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {categories.map((cat) => (
          <Card key={cat.category_id} className="border-0 shadow-sm card-hover">
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
                <Button variant="ghost" size="icon" className="w-8 h-8">
                  <Pencil className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" className="w-8 h-8 text-danger">
                  <Trash2 className="w-4 h-4" />
                </Button>
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
    </div>
  );
}
