"use client";

import { use } from "react";
import VehicleFormPage from "../../new/page";

export default function EditVehiclePage({ params }) {
  const resolvedParams = use(params);
  return <VehicleFormPage params={resolvedParams} />;
}
