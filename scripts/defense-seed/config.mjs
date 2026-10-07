export const WINDOW = Object.freeze({ start: "2026-09-03", end: "2026-10-02", defense: "2026-10-03" });
export const SEED_KEY = "seed:defense-2026-10";
export const MARK = "[seed:defense-2026-10]";
export const VIP = "VIP Guest Transport";
export const GUEST = "Guest Transport";

// All identities, document numbers, and plates in this file are fictional.
export const DRIVER_SPECS = [
  ["D01", "Mateo", "Reyes", "2028-08-31", 8, "V01"],
  ["D02", "Andres", "Santos", "2028-12-15", 10, "V02"],
  ["D03", "Paolo", "Dela Cruz", "2028-07-20", 11, "V03"],
  ["D04", "Nico", "Bautista", "2027-11-19", 6, "V04"],
  ["D05", "Rafael", "Mendoza", "2026-09-19", 7, "V05"],
  ["D06", "Gabriel", "Navarro", "2026-10-24", 5, "V06"],
  ["D07", "Luis", "Villanueva", "2028-09-14", 9, "V07"],
  ["D08", "Carlos", "Garcia", "2028-10-30", 7, "V08"],
  ["D09", "Joaquin", "Ramos", "2027-07-17", 12, "V09"],
  ["D10", "Emilio", "Torres", "2028-06-06", 8, null],
];

// Manufacturer seating is total occupants; the stored seats here are passenger
// seats with the driver excluded. Mazda's PH CX-8 6-seater has five passenger
// seats; Toyota's PH Innova 8-seater has seven passenger seats.
export const VEHICLE_SPECS = [
  ["V01", VIP, "Toyota", "Camry", "2.5 V HEV CVT", 2025, "Pearl White", 4, "DMM-4201", "Gasoline", 50, 12.8],
  ["V02", VIP, "Toyota", "Camry", "2.5 V HEV CVT", 2024, "Graphite", 4, "DMM-4202", "Gasoline", 50, 12.4],
  ["V03", GUEST, "Toyota", "Corolla Altis", "Sedan", 2025, "Silver", 4, "DMM-4203", "Gasoline", 50, 15.1],
  ["V04", GUEST, "Mazda", "CX-8 AWD Exclusive 6-Seater", "SUV", 2024, "Deep Blue", 5, "DMM-4204", "Gasoline", 72, 9.8],
  ["V05", GUEST, "Mazda", "CX-8 AWD Exclusive 6-Seater", "SUV", 2023, "Grey", 5, "DMM-4205", "Gasoline", 72, 9.5],
  ["V06", GUEST, "Toyota", "Zenix", "MPV", 2025, "Silver", 6, "DMM-4206", "Gasoline", 52, 13.1],
  ["V07", VIP, "Toyota", "Alphard", "Luxury MPV", 2025, "Black", 6, "DMM-4207", "Gasoline", 60, 10.8],
  ["V08", GUEST, "Toyota", "Innova", "MPV", 2024, "White", 7, "DMM-4208", "Diesel", 55, 12.0],
  ["V09", GUEST, "Toyota", "Innova", "MPV", 2025, "Silver", 7, "DMM-4211", "Diesel", 55, 12.2],
  ["V10", VIP, "Toyota", "Innova", "Executive MPV", 2024, "Black", 7, "DMM-4210", "Diesel", 55, 11.8],
];

export const LOCATION_SPECS = [
  ["HOTEL", "CoCo Star Hotel", 14.5159034, 120.9953405],
  ["T1", "NAIA Terminal 1 - Arrivals", 14.50719, 121.00468],
  ["T2", "NAIA Terminal 2 - Arrivals", 14.51058, 121.01222],
  ["T3", "NAIA Terminal 3 - Arrivals (Bay 9)", 14.52048, 121.01445],
  ["BGC", "Bonifacio High Street, Taguig", 14.5520, 121.0488],
  ["MAKATI", "Ayala Triangle Gardens, Makati", 14.5563, 121.0264],
  ["MOA", "SM Mall of Asia, Pasay", 14.5352, 120.9822],
  ["INTRA", "Fort Santiago, Intramuros", 14.5941, 120.9706],
  ["QC", "Quezon Memorial Circle, Quezon City", 14.6505, 121.0494],
];

export const ROUTE_MEASURES = [
  ["T1", 7.4, 28], ["T2", 8.7, 34], ["T3", 12.2, 42],
  ["BGC", 16.8, 50], ["MAKATI", 12.4, 42], ["MOA", 5.9, 25],
  ["INTRA", 14.5, 48], ["QC", 24.8, 72],
];

// [day, driver, vehicle, origin, destination, passengers, local start hour].
// 21 September and 9 October 1–2 runs. A driver never has concurrent rows.
export const COMPLETED_SPECS = [
  ["2026-09-03", "D01", "V01", "HOTEL", "T3", 2, 9],
  ["2026-09-04", "D02", "V02", "T1", "HOTEL", 2, 14],
  ["2026-09-05", "D03", "V03", "HOTEL", "MOA", 3, 9],
  ["2026-09-07", "D04", "V04", "HOTEL", "BGC", 4, 9],
  ["2026-09-08", "D05", "V05", "HOTEL", "MAKATI", 4, 10],
  ["2026-09-09", "D06", "V06", "HOTEL", "INTRA", 5, 9],
  ["2026-09-10", "D07", "V07", "T3", "HOTEL", 4, 15],
  ["2026-09-11", "D08", "V08", "HOTEL", "QC", 6, 9],
  ["2026-09-12", "D09", "V09", "HOTEL", "MOA", 6, 10],
  ["2026-09-14", "D01", "V01", "T3", "HOTEL", 2, 8],
  ["2026-09-15", "D02", "V02", "HOTEL", "MAKATI", 2, 11],
  ["2026-09-16", "D03", "V03", "HOTEL", "T1", 3, 9],
  ["2026-09-17", "D04", "V04", "MOA", "HOTEL", 4, 15],
  ["2026-09-18", "D05", "V05", "HOTEL", "T2", 4, 9],
  ["2026-09-19", "D10", "V04", "HOTEL", "BGC", 4, 10],
  ["2026-09-21", "D06", "V06", "BGC", "HOTEL", 5, 9],
  ["2026-09-22", "D07", "V07", "HOTEL", "T3", 4, 10],
  ["2026-09-23", "D01", "V01", "HOTEL", "MOA", 2, 10],
  ["2026-09-17", "D08", "V08", "QC", "HOTEL", 6, 10],
  ["2026-09-24", "D09", "V09", "HOTEL", "INTRA", 6, 10],
  ["2026-09-26", "D03", "V03", "MOA", "HOTEL", 3, 9],
  ["2026-10-01", "D01", "V01", "HOTEL", "T1", 2, 8],
  ["2026-10-01", "D02", "V02", "HOTEL", "BGC", 3, 9],
  ["2026-10-01", "D03", "V03", "HOTEL", "MAKATI", 2, 10],
  ["2026-10-01", "D04", "V04", "HOTEL", "MOA", 4, 11],
  ["2026-10-01", "D06", "V06", "HOTEL", "QC", 5, 15],
  ["2026-10-02", "D01", "V01", "T1", "HOTEL", 2, 8],
  ["2026-10-02", "D02", "V02", "HOTEL", "T3", 3, 9],
  ["2026-10-02", "D03", "V03", "HOTEL", "INTRA", 2, 10],
  ["2026-10-02", "D01", "V01", "HOTEL", "MOA", 2, 15],
];

export const FUTURE_SPECS = [
  ["2026-10-03", "D01", "V01", "HOTEL", "T3", 2, 8],
  ["2026-10-03", "D01", "V01", "T3", "HOTEL", 2, 15],
  ["2026-10-05", "D01", "V01", "HOTEL", "BGC", 3, 8.5],
  ["2026-10-05", "D01", "V01", "BGC", "HOTEL", 2, 15.5],
  ["2026-10-06", "D01", "V01", "HOTEL", "MAKATI", 2, 10],
  ["2026-10-03", "D02", "V02", "HOTEL", "T1", 2, 11],
  ["2026-10-03", "D04", "V04", "HOTEL", "MOA", 4, 10],
];
