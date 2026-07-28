-- ============================================
-- SEED DATA FOR FLEETOPS
-- Run this in Supabase SQL Editor AFTER migrations 001-005
-- ============================================

-- ============================================
-- ROLES
-- ============================================
INSERT INTO roles (role_name, description) VALUES
('system_admin', 'Full system access and configuration'),
('fleet_manager', 'Manage fleet, vehicles, and drivers'),
('dispatcher', 'Create and manage dispatches'),
('driver', 'Mobile app access for trip execution'),
('reception_staff', 'Create reservations for guests'),
('restaurant_staff', 'Request logistics and supplies'),
('management', 'View reports and analytics'),
('concierge', 'Arrange guest transportation and tours');

-- ============================================
-- BRANCHES
-- ============================================
INSERT INTO branches (branch_name, branch_code, address, city, province, phone, email, status) VALUES
('Main Office', 'MNO', '123 Rizal St', 'Makati City', 'Metro Manila', '+63 2 8123 4567', 'main@fleetops.com', 'Active'),
('BGC Branch', 'BGC', '456 Bonifacio Global City', 'Taguig', 'Metro Manila', '+63 2 8987 6543', 'bgc@fleetops.com', 'Active'),
('Airport Hub', 'APT', 'NAIA Terminal 3', 'Pasay City', 'Metro Manila', '+63 2 8555 1234', 'airport@fleetops.com', 'Active');

-- ============================================
-- VEHICLE CATEGORIES
-- ============================================
INSERT INTO vehiclecategories (category_name, description, base_rate, per_km_rate, per_hour_rate, seating_capacity, status) VALUES
('Sedan', 'Standard 4-door sedan for business transport', 1500.00, 15.00, 200.00, 4, 'Active'),
('SUV', 'Sports utility vehicle for group transport', 2500.00, 20.00, 350.00, 7, 'Active'),
('Van', 'Passenger van for hotel shuttle services', 3000.00, 25.00, 400.00, 12, 'Active'),
('Luxury Sedan', 'Premium sedan for VIP guests', 4000.00, 30.00, 500.00, 4, 'Active'),
('Mini Bus', 'Mini bus for group tours and transfers', 5000.00, 35.00, 700.00, 20, 'Active');

-- ============================================
-- VEHICLES
-- ============================================
INSERT INTO vehicles (plate_number, vehicle_name, model, manufacturer, year, color, fuel_type, seating_capacity, mileage, fuel_level, vehicle_status, category_id, branch_id, next_service_date, last_service_date, insurance_expiry, registration_expiry) VALUES
('ABC-1234', 'Toyota Camry 2023', 'Camry 2.5V', 'Toyota', 2023, 'White', 'Gasoline', 4, 15230, 75, 'Available', 1, 1, '2026-09-15', '2026-03-15', '2027-01-15', '2027-02-10'),
('XYZ-5678', 'Honda CR-V 2024', 'CR-V 1.6V', 'Honda', 2024, 'Black', 'Diesel', 7, 8940, 60, 'Available', 2, 1, '2026-10-01', '2026-04-01', '2027-03-01', '2027-04-05'),
('DEF-9012', 'Toyota Hiace 2023', 'Hiace Super Grandia', 'Toyota', 2023, 'Silver', 'Diesel', 12, 28450, 45, 'In Use', 3, 2, '2026-08-20', '2026-02-20', '2027-06-15', '2027-05-20'),
('GHI-3456', 'Mercedes-Benz E-Class 2024', 'E 250 Exclusive', 'Mercedes-Benz', 2024, 'Navy', 'Gasoline', 4, 5230, 85, 'Available', 4, 1, '2026-11-01', '2026-05-01', '2027-07-01', '2027-08-10'),
('JKL-7890', 'Nissan Urvan 2022', 'Urvan NV350', 'Nissan', 2022, 'White', 'Diesel', 12, 45120, 30, 'Under Maintenance', 3, 3, '2026-07-28', '2026-01-15', '2027-02-28', '2027-03-15'),
('MNO-2345', 'Toyota Fortuner 2024', 'Fortuner 2.8 LTD', 'Toyota', 2024, 'Gray', 'Diesel', 7, 6780, 70, 'Available', 2, 3, '2026-12-01', '2026-06-01', '2027-08-15', '2027-09-20'),
('PQR-6789', 'Hyundai Staria 2024', 'Staria 2.2D', 'Hyundai', 2024, 'White', 'Diesel', 12, 3200, 90, 'In Use', 3, 2, '2027-01-15', '2026-07-15', '2027-09-01', '2027-10-05'),
('STU-0123', 'BMW 5 Series 2023', '520d M Sport', 'BMW', 2023, 'Blue', 'Diesel', 4, 18900, 55, 'Available', 4, 1, '2026-09-30', '2026-03-30', '2027-04-15', '2027-05-25'),
('VWX-4567', 'Toyota Coaster 2023', 'Coaster 24-Seater', 'Toyota', 2023, 'White', 'Diesel', 20, 22100, 65, 'Reserved', 5, 3, '2026-08-10', '2026-02-10', '2027-05-01', '2027-06-10'),
('YZA-8901', 'Mitsubishi Xpander 2024', 'Xpander Cross', 'Mitsubishi', 2024, 'Orange', 'Gasoline', 7, 4100, 80, 'Available', 2, 2, '2027-02-01', '2026-08-01', '2027-10-15', '2027-11-20');

-- ============================================
-- EMPLOYEES (auth.users must be created separately via register page)
-- ============================================
INSERT INTO employees (first_name, last_name, position, email, phone, status, branch_id, role_id) VALUES
('Admin', 'User', 'System Administrator', 'admin@fleetops.com', '+63 917 111 1111', 'Active', 1, 1),
('Juan', 'Dela Cruz', 'Fleet Manager', 'juan.delacruz@fleetops.com', '+63 917 222 2222', 'Active', 1, 2),
('Maria', 'Santos', 'Senior Dispatcher', 'maria.santos@fleetops.com', '+63 917 333 3333', 'Active', 2, 3),
('Pedro', 'Gonzales', 'Dispatcher', 'pedro.gonzales@fleetops.com', '+63 917 444 4444', 'Active', 3, 3),
('John', 'Doe', 'Driver', 'john.doe@fleetops.com', '+63 917 555 5555', 'Active', 1, 4),
('Jane', 'Smith', 'Driver', 'jane.smith@fleetops.com', '+63 917 666 6666', 'Active', 2, 4),
('Bob', 'Johnson', 'Driver', 'bob.johnson@fleetops.com', '+63 917 777 7777', 'Active', 3, 4),
('Sarah', 'Williams', 'Driver', 'sarah.williams@fleetops.com', '+63 917 888 8888', 'Active', 1, 4),
('Mike', 'Brown', 'Driver', 'mike.brown@fleetops.com', '+63 917 999 9999', 'Active', 2, 4),
('Anna', 'Davis', 'Front Desk Reception', 'anna.davis@fleetops.com', '+63 918 000 0000', 'Active', 1, 5),
('Carlos', 'Lopez', 'Restaurant Supervisor', 'carlos.lopez@fleetops.com', '+63 918 111 1111', 'Active', 2, 6);

-- ============================================
-- DRIVERS (with performance data stored directly)
-- ============================================
INSERT INTO drivers (employee_id, driver_status, license_number, license_class, license_type, license_expiry, years_of_experience) VALUES
(5, 'Available', 'D12-34-567890', 'Professional 1', 'Commercial', '2027-05-15', 8),
(6, 'On Trip', 'D98-76-543210', 'Professional 1', 'Commercial', '2027-08-20', 5),
(7, 'Available', 'D55-44-332211', 'Professional 2', 'Commercial', '2027-03-10', 10),
(8, 'On Trip', 'D77-88-990011', 'Professional 1', 'Commercial', '2027-11-25', 6),
(9, 'Off Duty', 'D22-11-334455', 'Professional 2', 'Commercial', '2027-07-30', 12);

-- ============================================
-- ROUTES
-- ============================================
INSERT INTO routes (route_name, origin, destination, estimated_distance, estimated_duration, status) VALUES
('Makati-BGC Shuttle', 'Makati City', 'BGC Taguig', 12.5, 30, 'Active'),
('Airport Transfer', 'NAIA Terminal 3', 'Makati City', 8.2, 25, 'Active'),
('Hotel Guest Run', 'Grand Hyatt Manila', 'BGC Area Hotels', 15.0, 45, 'Active'),
('BGC-Makati Loop', 'BGC Taguig', 'Makati City', 10.8, 28, 'Active'),
('City Tour', 'Intramuros Manila', 'Various Tourist Spots', 35.0, 180, 'Active'),
('Bulk Supply Run', 'Main Warehouse', 'Various Restaurants', 28.5, 90, 'Active'),
('Airport Pickup', 'NAIA Terminal 1', 'Hotel Partner Zone', 20.0, 50, 'Active');

-- ============================================
-- RESERVATIONS
-- ============================================
INSERT INTO vehiclereservations (guest_name, guest_phone, passenger_count, pickup_location, dropoff_location, reservation_date, pickup_time, purpose, status, branch_id, created_by, notes) VALUES
('Carlos Mendez', '+63 919 123 4567', 3, 'Grand Hyatt Manila', 'NAIA Terminal 1', '2026-07-28', '09:00:00', 'Airport Transfer', 'Approved', 1, 2, 'VIP guest — please ensure sedan is clean and air-conditioned'),
('Emily Chen', '+63 919 234 5678', 5, 'Shangri-La BGC', 'Tagaytay Ridge', '2026-07-28', '14:00:00', 'City Tour', 'Approved', 2, 3, 'Round trip — return by 7PM'),
('Restaurant Supply', '+63 919 345 6789', 2, 'Main Warehouse', 'BGC Branch Restaurant', '2026-07-29', '06:00:00', 'Bulk Supply Delivery', 'Pending', 2, 11, 'Weekly supply delivery — 5 boxes estimated'),
('Ana Reyes', '+63 919 456 7890', 1, 'Makati Office', 'NAIA Terminal 3', '2026-07-29', '11:30:00', 'Airport Transfer', 'Approved', 1, 10, 'Business class guest'),
('Hotel Group Booking', '+63 919 567 8901', 15, 'Grand Hyatt Manila', 'Tagaytay Highlands', '2026-07-30', '08:00:00', 'Group Tour', 'Pending', 1, 10, 'Corporate event — 15 pax, all-day event'),
('David Park', '+63 919 678 9012', 2, 'BGC Office', 'Port Area Manila', '2026-07-28', '16:00:00', 'Business Meeting', 'Pending', 2, 3, 'Meeting with shipping partners');

-- ============================================
-- DISPATCH SCHEDULES
-- ============================================
INSERT INTO dispatchschedules (reservation_id, vehicle_id, driver_id, route_id, dispatch_number, scheduled_departure, scheduled_arrival, status, notes) VALUES
(1, 1, 1, 2, 'DSP-20260728-0001', '2026-07-28 09:00:00+08', '2026-07-28 09:25:00+08', 'Dispatched', 'Sedan for airport drop-off'),
(2, 2, 2, 5, 'DSP-20260728-0002', '2026-07-28 14:00:00+08', '2026-07-28 19:00:00+08', 'Dispatched', 'SUV for Tagaytay tour');

-- ============================================
-- TRIPS
-- ============================================
INSERT INTO trips (vehicle_id, driver_id, dispatch_id, route_id, trip_status, start_time, start_odometer, notes) VALUES
(1, 1, 1, 2, 'En Route', '2026-07-28 09:00:00+08', 15230, 'En route to NAIA Terminal 1'),
(2, 2, 2, 5, 'Trip Started', '2026-07-28 14:00:00+08', 8940, 'Proceeding to Tagaytay');

-- ============================================
-- TRIP COST (merged into trips table after normalization)
-- ============================================
UPDATE trips SET fuel_cost = 450.00, toll_fees = 35.00, parking_fees = 0, driver_cost = 300.00, total_cost = 785.00, cost_per_km = 15.70 WHERE trip_id = 1;
UPDATE trips SET fuel_cost = 1200.00, toll_fees = 250.00, parking_fees = 100.00, driver_cost = 800.00, total_cost = 2350.00, cost_per_km = 18.80 WHERE trip_id = 2;

-- ============================================
-- FUEL RECORDS
-- ============================================
INSERT INTO fuelrecords (vehicle_id, driver_id, station_name, liters, amount, price_per_liter, odometer, fuel_type, fuel_date) VALUES
(1, 1, 'Petron Makati', 45.5, 2621.50, 57.62, 15230, 'Gasoline', '2026-07-25'),
(2, 2, 'Shell McKinley', 52.0, 3016.00, 58.00, 8940, 'Diesel', '2026-07-24'),
(3, 3, 'Caltex BGC', 60.0, 3480.00, 58.00, 28450, 'Diesel', '2026-07-22');

-- ============================================
-- AI INSIGHTS
-- ============================================
INSERT INTO ai_insights (insight_type, title, description, impact, category, confidence_score, status) VALUES
('utilization', 'Fleet utilization can improve', '3 vehicles underutilized this week. Consider reassigning routes to optimize fleet usage.', 'high', 'Fleet Optimization', 0.85, 'Active'),
('maintenance', 'Maintenance peak predicted', '4 vehicles due for service next week. Schedule now to avoid downtime.', 'medium', 'Maintenance', 0.78, 'Active'),
('fuel', 'Fuel efficiency declining', 'Vehicle ABC-1234 shows 18% drop in fuel efficiency. Inspection recommended.', 'high', 'Fuel Management', 0.82, 'Active'),
('driver', 'Driver availability alert', 'Peak demand expected Friday 5-8 PM. Consider scheduling additional drivers.', 'medium', 'Driver Management', 0.71, 'Active'),
('cost', 'Fuel cost trending up', 'Average fuel cost increased 5.2% this month compared to last. Review station partnerships.', 'medium', 'Cost Optimization', 0.75, 'Active');

-- ============================================
-- NOTIFICATIONS
-- ============================================
INSERT INTO notifications (employee_id, title, message, type, channel, reference_type, reference_id, is_read, sent_at) VALUES
(1, 'Reservation Approved', 'Reservation for Carlos Mendez has been approved.', 'Reservation', 'in_app', 'reservation', 1, false, NOW() - INTERVAL '30 minutes'),
(1, 'Trip Started', 'Trip #2 to Tagaytay has started — Vehicle XYZ-5678', 'Trip', 'in_app', 'trip', 2, false, NOW() - INTERVAL '15 minutes'),
(3, 'New Reservation Created', 'New reservation by Reception Staff — pending approval', 'Reservation', 'in_app', 'reservation', 6, true, NOW() - INTERVAL '1 hour'),
(1, 'Maintenance Due', 'Vehicle JKL-7890 (Nissan Urvan) due for service by July 28', 'Maintenance', 'in_app', 'vehicle', 5, false, NOW() - INTERVAL '2 hours'),
(1, 'Fuel Efficiency Alert', 'Vehicle ABC-1234 fuel efficiency dropped 18% — inspection recommended', 'Alert', 'in_app', 'vehicle', 1, false, NOW() - INTERVAL '3 hours');

-- ============================================
-- SERVICE TYPES (Run after migration 004)
-- ============================================
INSERT INTO service_types (service_name, description, requires_vehicle, requires_driver, default_category_id, icon, color, sort_order) VALUES
('Airport Transfer', 'Point-to-point transport between hotel/restaurant and airport', TRUE, TRUE, 1, 'plane', 'blue', 1),
('City Tour', 'Sightseeing and guided tours for hotel guests', TRUE, TRUE, 2, 'map', 'green', 2),
('Hotel Shuttle', 'Fixed-route recurring shuttle service (mall, airport, etc.)', TRUE, TRUE, 3, 'bus', 'purple', 3),
('Point-to-Point', 'One-way or round-trip guest transport between locations', TRUE, TRUE, 1, 'map-pin', 'indigo', 4),
('Food Delivery', 'Restaurant food/beverage delivery to customer location', TRUE, TRUE, 3, 'utensils', 'orange', 5),
('Staff Transport', 'Employee shuttle or staff movement between branches', TRUE, TRUE, 3, 'users', 'teal', 6),
('Supply Run', 'Procurement, warehouse pickup, and supply delivery', TRUE, TRUE, 3, 'package', 'slate', 7),
('Event Transport', 'Transport for hotel/restaurant events and functions', TRUE, TRUE, 5, 'calendar', 'rose', 8),
('Valet Service', 'Guest vehicle parking and retrieval', TRUE, FALSE, 1, 'car', 'amber', 9);

-- ============================================
-- BOOKING CHANNELS (Run after migration 004)
-- ============================================
INSERT INTO booking_channels (channel_name, source_system, description) VALUES
('Front Desk', 'PMS', 'Reservation created by hotel front desk staff at check-in or guest request'),
('Concierge', 'PMS', 'Transport arranged by hotel concierge for guest services'),
('Restaurant POS', 'POS', 'Delivery or transport requested through restaurant point-of-sale'),
('Online Booking', 'Web', 'Guest self-booked through hotel website or online portal'),
('Phone', 'PMS', 'Reservation taken over the phone by hotel staff'),
('Walk-in', 'PMS', 'Immediate transport requested by guest in person');
