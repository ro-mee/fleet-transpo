"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { User, Mail, Phone, Building2, Shield, Save } from "lucide-react";

export default function ProfilePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Profile</h1>
        <p className="text-foreground-secondary mt-1">Manage your account profile and personal information</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="border-0 shadow-sm lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Personal Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-foreground-secondary mb-1 block">First Name</label>
                <div className="h-10 px-3 rounded-xl border border-border bg-surface flex items-center text-sm text-foreground-muted">John</div>
              </div>
              <div>
                <label className="text-sm text-foreground-secondary mb-1 block">Last Name</label>
                <div className="h-10 px-3 rounded-xl border border-border bg-surface flex items-center text-sm text-foreground-muted">Doe</div>
              </div>
            </div>
            <div>
              <label className="text-sm text-foreground-secondary mb-1 block">Email</label>
              <div className="h-10 px-3 rounded-xl border border-border bg-surface flex items-center text-sm text-foreground-muted gap-2">
                <Mail className="w-4 h-4 text-foreground-muted" />
                john.doe@fleetops.com
              </div>
            </div>
            <div>
              <label className="text-sm text-foreground-secondary mb-1 block">Phone</label>
              <div className="h-10 px-3 rounded-xl border border-border bg-surface flex items-center text-sm text-foreground-muted gap-2">
                <Phone className="w-4 h-4 text-foreground-muted" />
                +63 912 345 6789
              </div>
            </div>
            <Button className="mt-2">
              <Save className="w-4 h-4 mr-2" />
              Save Changes
            </Button>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Account Info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10"><User className="w-5 h-5 text-primary" /></div>
              <div>
                <p className="text-sm font-medium">Role</p>
                <Badge variant="default" className="mt-0.5">System Admin</Badge>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-success/10"><Building2 className="w-5 h-5 text-success" /></div>
              <div>
                <p className="text-sm font-medium">Branch</p>
                <p className="text-xs text-foreground-muted">Main Office</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-info/10"><Shield className="w-5 h-5 text-info" /></div>
              <div>
                <p className="text-sm font-medium">Two-Factor Auth</p>
                <Badge variant="secondary" className="mt-0.5">Not Enabled</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
