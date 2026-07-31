-- ============================================
-- FLEET TRANSPORTATION MANAGEMENT SYSTEM
-- Database Schema
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- USERS & AUTH EXTENSION
-- ============================================

CREATE TABLE roles (
  role_id SERIAL PRIMARY KEY,
  role_name VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE permissions (
  permission_id SERIAL PRIMARY KEY,
  permission_name VARCHAR(100) UNIQUE NOT NULL,
  resource VARCHAR(100) NOT NULL,
  action VARCHAR(50) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE role_permissions (
  role_permission_id SERIAL PRIMARY KEY,
  role_id INT NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
  permission_id INT NOT NULL REFERENCES permissions(permission_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(role_id, permission_id)
);

-- ============================================
-- EMPLOYEES
-- ============================================

CREATE TABLE employees (
  employee_id SERIAL PRIMARY KEY,
  role_id INT REFERENCES roles(role_id),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  position VARCHAR(100),
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(50),
  license_number VARCHAR(100),
  license_expiry DATE,
  status VARCHAR(50) DEFAULT 'Active',
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  created_by INT REFERENCES employees(employee_id),
  updated_by INT REFERENCES employees(employee_id)
);

CREATE INDEX idx_employees_email ON employees(email);
CREATE INDEX idx_employees_role ON employees(role_id);
CREATE INDEX idx_employees_status ON employees(status);

-- ============================================
-- VEHICLE CATEGORIES
-- ============================================

CREATE TABLE vehiclecategories (
  category_id SERIAL PRIMARY KEY,
  category_name VARCHAR(100) NOT NULL,
  description TEXT,
  base_rate DECIMAL(12, 2),
  per_km_rate DECIMAL(10, 2),
  per_hour_rate DECIMAL(10, 2),
  seating_capacity INT,
  image_url TEXT,
  status VARCHAR(50) DEFAULT 'Active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- ============================================
-- VEHICLES
-- ============================================

CREATE TABLE vehicles (
  vehicle_id SERIAL PRIMARY KEY,
  category_id INT REFERENCES vehiclecategories(category_id),
  plate_number VARCHAR(50) UNIQUE NOT NULL,
  vehicle_name VARCHAR(255) NOT NULL,
  model VARCHAR(100),
  manufacturer VARCHAR(100),
  year INT,
  color VARCHAR(50),
  fuel_type VARCHAR(50) DEFAULT 'Gasoline',
  seating_capacity INT DEFAULT 4,
  mileage DECIMAL(12, 2) DEFAULT 0,
  fuel_level DECIMAL(5, 2) DEFAULT 100,
  license_plate_expiry DATE,
  insurance_expiry DATE,
  registration_expiry DATE,
  purchase_date DATE,
  purchase_price DECIMAL(14, 2),
  image_url TEXT,
  vehicle_status VARCHAR(50) DEFAULT 'Available',
  last_service_date DATE,
  next_service_mileage DECIMAL(12, 2),
  next_service_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  created_by INT REFERENCES employees(employee_id),
  updated_by INT REFERENCES employees(employee_id)
);

CREATE INDEX idx_vehicles_plate ON vehicles(plate_number);
CREATE INDEX idx_vehicles_category ON vehicles(category_id);
CREATE INDEX idx_vehicles_status ON vehicles(vehicle_status);

-- ============================================
-- DRIVERS
-- ============================================

CREATE TABLE drivers (
  driver_id SERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(employee_id),
  license_number VARCHAR(100),
  license_expiry DATE,
  license_type VARCHAR(50),
  license_class VARCHAR(50),
  years_of_experience INT DEFAULT 0,
  performance_score DECIMAL(3, 2) DEFAULT 0,
  total_trips INT DEFAULT 0,
  total_distance DECIMAL(12, 2) DEFAULT 0,
  total_hours DECIMAL(10, 2) DEFAULT 0,
  rating DECIMAL(2, 1) DEFAULT 0,
  driver_status VARCHAR(50) DEFAULT 'Available',
  current_latitude DECIMAL(10, 7),
  current_longitude DECIMAL(10, 7),
  last_location_update TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  created_by INT REFERENCES employees(employee_id),
  updated_by INT REFERENCES employees(employee_id)
);

CREATE INDEX idx_drivers_employee ON drivers(employee_id);
CREATE INDEX idx_drivers_status ON drivers(driver_status);

-- ============================================
-- ROUTES
-- ============================================

CREATE TABLE routes (
  route_id SERIAL PRIMARY KEY,
  route_name VARCHAR(255) NOT NULL,
  origin VARCHAR(255) NOT NULL,
  origin_latitude DECIMAL(10, 7),
  origin_longitude DECIMAL(10, 7),
  destination VARCHAR(255) NOT NULL,
  destination_latitude DECIMAL(10, 7),
  destination_longitude DECIMAL(10, 7),
  estimated_distance DECIMAL(10, 2),
  estimated_duration INT,
  waypoints JSONB,
  status VARCHAR(50) DEFAULT 'Active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_routes_name ON routes(route_name);

-- ============================================
-- VEHICLE RESERVATIONS
-- ============================================

CREATE TABLE vehiclereservations (
  reservation_id SERIAL PRIMARY KEY,
  vehicle_id INT REFERENCES vehicles(vehicle_id),
  driver_id INT REFERENCES drivers(driver_id),
  guest_name VARCHAR(255),
  guest_phone VARCHAR(50),
  guest_email VARCHAR(255),
  pickup_location TEXT NOT NULL,
  dropoff_location TEXT,
  pickup_latitude DECIMAL(10, 7),
  pickup_longitude DECIMAL(10, 7),
  dropoff_latitude DECIMAL(10, 7),
  dropoff_longitude DECIMAL(10, 7),
  reservation_date DATE NOT NULL,
  pickup_time TIME NOT NULL,
  estimated_return_time TIME,
  purpose VARCHAR(255),
  notes TEXT,
  passenger_count INT DEFAULT 1,
  status VARCHAR(50) DEFAULT 'Pending',
  ai_vehicle_recommendation JSONB,
  ai_driver_recommendation JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  created_by INT REFERENCES employees(employee_id),
  updated_by INT REFERENCES employees(employee_id)
);

CREATE INDEX idx_reservations_date ON vehiclereservations(reservation_date);
CREATE INDEX idx_reservations_status ON vehiclereservations(status);
CREATE INDEX idx_reservations_vehicle ON vehiclereservations(vehicle_id);

-- ============================================
-- DISPATCH SCHEDULES
-- ============================================

CREATE TABLE dispatchschedules (
  dispatch_id SERIAL PRIMARY KEY,
  reservation_id INT REFERENCES vehiclereservations(reservation_id),
  vehicle_id INT REFERENCES vehicles(vehicle_id),
  driver_id INT REFERENCES drivers(driver_id),
  route_id INT REFERENCES routes(route_id),
  dispatch_number VARCHAR(50) UNIQUE NOT NULL,
  scheduled_departure TIMESTAMPTZ,
  scheduled_arrival TIMESTAMPTZ,
  actual_departure TIMESTAMPTZ,
  actual_arrival TIMESTAMPTZ,
  estimated_distance DECIMAL(10, 2),
  estimated_duration INT,
  status VARCHAR(50) DEFAULT 'Pending',
  priority VARCHAR(20) DEFAULT 'Normal',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  created_by INT REFERENCES employees(employee_id),
  updated_by INT REFERENCES employees(employee_id)
);

CREATE INDEX idx_dispatch_reservation ON dispatchschedules(reservation_id);
CREATE INDEX idx_dispatch_vehicle ON dispatchschedules(vehicle_id);
CREATE INDEX idx_dispatch_driver ON dispatchschedules(driver_id);
CREATE INDEX idx_dispatch_status ON dispatchschedules(status);
CREATE INDEX idx_dispatch_date ON dispatchschedules(scheduled_departure);

-- ============================================
-- TRIPS
-- ============================================

CREATE TABLE trips (
  trip_id SERIAL PRIMARY KEY,
  vehicle_id INT NOT NULL REFERENCES vehicles(vehicle_id),
  driver_id INT NOT NULL REFERENCES drivers(driver_id),
  dispatch_id INT REFERENCES dispatchschedules(dispatch_id),
  route_id INT REFERENCES routes(route_id),
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  distance DECIMAL(10, 2) DEFAULT 0,
  estimated_distance DECIMAL(10, 2),
  estimated_duration INT,
  actual_duration INT,
  origin TEXT,
  destination TEXT,
  trip_status VARCHAR(50) DEFAULT 'Pending',
  start_odometer DECIMAL(12, 2),
  end_odometer DECIMAL(12, 2),
  fuel_consumed DECIMAL(10, 2),
  avg_speed DECIMAL(5, 2),
  max_speed DECIMAL(5, 2),
  idle_time INT DEFAULT 0,
  route_data JSONB,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  created_by INT REFERENCES employees(employee_id),
  updated_by INT REFERENCES employees(employee_id)
);

CREATE INDEX idx_trips_vehicle ON trips(vehicle_id);
CREATE INDEX idx_trips_driver ON trips(driver_id);
CREATE INDEX idx_trips_status ON trips(trip_status);
CREATE INDEX idx_trips_date ON trips(start_time);

-- ============================================
-- GPS TRACKING
-- ============================================

CREATE TABLE gpstracking (
  tracking_id BIGSERIAL PRIMARY KEY,
  vehicle_id INT NOT NULL REFERENCES vehicles(vehicle_id),
  trip_id INT REFERENCES trips(trip_id),
  driver_id INT REFERENCES drivers(driver_id),
  latitude DECIMAL(10, 7) NOT NULL,
  longitude DECIMAL(10, 7) NOT NULL,
  speed DECIMAL(5, 2) DEFAULT 0,
  heading DECIMAL(5, 2) DEFAULT 0,
  altitude DECIMAL(8, 2) DEFAULT 0,
  accuracy DECIMAL(5, 2) DEFAULT 0,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tracking_vehicle ON gpstracking(vehicle_id);
CREATE INDEX idx_tracking_trip ON gpstracking(trip_id);
CREATE INDEX idx_tracking_time ON gpstracking(recorded_at);

-- Enable partitioning for time-series performance (requires TimescaleDB extension if available)
-- SELECT create_hypertable('gpstracking', 'recorded_at', if_not_exists => TRUE);
-- Standard index-based approach used instead

-- ============================================
-- VEHICLE MAINTENANCE
-- ============================================

CREATE TABLE vehiclemaintenance (
  maintenance_id SERIAL PRIMARY KEY,
  vehicle_id INT NOT NULL REFERENCES vehicles(vehicle_id),
  maintenance_type VARCHAR(50) NOT NULL DEFAULT 'Routine',
  description TEXT,
  maintenance_date DATE NOT NULL,
  completed_date DATE,
  cost DECIMAL(12, 2) DEFAULT 0,
  mileage_at_service DECIMAL(12, 2),
  service_provider VARCHAR(255),
  service_center VARCHAR(255),
  next_schedule_date DATE,
  next_schedule_mileage DECIMAL(12, 2),
  status VARCHAR(50) DEFAULT 'Scheduled',
  priority VARCHAR(20) DEFAULT 'Normal',
  is_recurring BOOLEAN DEFAULT FALSE,
  recurring_interval_days INT,
  recurring_interval_km DECIMAL(10, 2),
  remarks TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  created_by INT REFERENCES employees(employee_id),
  updated_by INT REFERENCES employees(employee_id)
);

CREATE INDEX idx_maintenance_vehicle ON vehiclemaintenance(vehicle_id);
CREATE INDEX idx_maintenance_date ON vehiclemaintenance(maintenance_date);
CREATE INDEX idx_maintenance_status ON vehiclemaintenance(status);

-- ============================================
-- VEHICLE INSPECTION
-- ============================================

CREATE TABLE vehicleinspection (
  inspection_id SERIAL PRIMARY KEY,
  vehicle_id INT NOT NULL REFERENCES vehicles(vehicle_id),
  driver_id INT REFERENCES drivers(driver_id),
  inspection_type VARCHAR(50) NOT NULL,
  inspection_date DATE NOT NULL,
  checklist JSONB,
  findings TEXT,
  severity VARCHAR(20),
  status VARCHAR(50) DEFAULT 'Pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- VEHICLE DOCUMENTS
-- ============================================

CREATE TABLE vehicledocuments (
  document_id SERIAL PRIMARY KEY,
  vehicle_id INT NOT NULL REFERENCES vehicles(vehicle_id),
  document_type VARCHAR(100) NOT NULL,
  document_number VARCHAR(255),
  file_url TEXT NOT NULL,
  expiry_date DATE,
  status VARCHAR(50) DEFAULT 'Active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- ============================================
-- VEHICLE ASSIGNMENT
-- ============================================

CREATE TABLE vehicleassignment (
  assignment_id SERIAL PRIMARY KEY,
  vehicle_id INT NOT NULL REFERENCES vehicles(vehicle_id),
  driver_id INT NOT NULL REFERENCES drivers(driver_id),
  assigned_date DATE NOT NULL,
  returned_date DATE,
  status VARCHAR(50) DEFAULT 'Active',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- FUEL STATIONS
-- ============================================

CREATE TABLE fuelstations (
  station_id SERIAL PRIMARY KEY,
  station_name VARCHAR(255) NOT NULL,
  address TEXT,
  latitude DECIMAL(10, 7),
  longitude DECIMAL(10, 7),
  phone VARCHAR(50),
  fuel_types_available JSONB,
  status VARCHAR(50) DEFAULT 'Active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- ============================================
-- FUEL RECORDS
-- ============================================

CREATE TABLE fuelrecords (
  fuel_record_id SERIAL PRIMARY KEY,
  vehicle_id INT NOT NULL REFERENCES vehicles(vehicle_id),
  driver_id INT REFERENCES drivers(driver_id),
  station_id INT REFERENCES fuelstations(station_id),
  trip_id INT REFERENCES trips(trip_id),
  liters DECIMAL(10, 2) NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  price_per_liter DECIMAL(10, 2),
  odometer DECIMAL(12, 2),
  fuel_type VARCHAR(50),
  fuel_date DATE NOT NULL,
  receipt_url TEXT,
  status VARCHAR(50) DEFAULT 'Completed',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  created_by INT REFERENCES employees(employee_id),
  updated_by INT REFERENCES employees(employee_id)
);

CREATE INDEX idx_fuel_vehicle ON fuelrecords(vehicle_id);
CREATE INDEX idx_fuel_date ON fuelrecords(fuel_date);

-- ============================================
-- FUEL CONSUMPTION
-- ============================================

CREATE TABLE fuelconsumption (
  consumption_id SERIAL PRIMARY KEY,
  vehicle_id INT NOT NULL REFERENCES vehicles(vehicle_id),
  trip_id INT REFERENCES trips(trip_id),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  total_liters DECIMAL(12, 2) DEFAULT 0,
  total_amount DECIMAL(14, 2) DEFAULT 0,
  total_distance DECIMAL(12, 2) DEFAULT 0,
  avg_km_per_liter DECIMAL(8, 2),
  cost_per_km DECIMAL(8, 2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- FUEL REQUESTS
-- ============================================

CREATE TABLE fuelrequests (
  request_id SERIAL PRIMARY KEY,
  vehicle_id INT NOT NULL REFERENCES vehicles(vehicle_id),
  driver_id INT REFERENCES drivers(driver_id),
  requested_liters DECIMAL(10, 2) NOT NULL,
  current_fuel_level DECIMAL(5, 2),
  required_until DATE,
  purpose TEXT,
  status VARCHAR(50) DEFAULT 'Pending',
  approved_liters DECIMAL(10, 2),
  approved_by INT REFERENCES employees(employee_id),
  approved_at TIMESTAMPTZ,
  remarks TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- FUEL ALLOCATIONS
-- ============================================

CREATE TABLE fuelallocations (
  allocation_id SERIAL PRIMARY KEY,
  vehicle_id INT NOT NULL REFERENCES vehicles(vehicle_id),
  month DATE NOT NULL,
  allocated_liters DECIMAL(12, 2) DEFAULT 0,
  allocated_amount DECIMAL(14, 2) DEFAULT 0,
  actual_liters DECIMAL(12, 2) DEFAULT 0,
  actual_amount DECIMAL(14, 2) DEFAULT 0,
  status VARCHAR(50) DEFAULT 'Active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- DRIVER ATTENDANCE
-- ============================================

CREATE TABLE driverattendance (
  attendance_id SERIAL PRIMARY KEY,
  driver_id INT NOT NULL REFERENCES drivers(driver_id),
  date DATE NOT NULL,
  time_in TIMESTAMPTZ,
  time_out TIMESTAMPTZ,
  check_in_method VARCHAR(50) DEFAULT 'Manual',
  check_in_location TEXT,
  check_in_latitude DECIMAL(10, 7),
  check_in_longitude DECIMAL(10, 7),
  status VARCHAR(50) DEFAULT 'Present',
  remarks TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_attendance_driver ON driverattendance(driver_id);
CREATE INDEX idx_attendance_date ON driverattendance(date);

-- ============================================
-- DRIVER INCIDENTS
-- ============================================

CREATE TABLE driverincidents (
  incident_id SERIAL PRIMARY KEY,
  driver_id INT NOT NULL REFERENCES drivers(driver_id),
  vehicle_id INT REFERENCES vehicles(vehicle_id),
  trip_id INT REFERENCES trips(trip_id),
  incident_type VARCHAR(100) NOT NULL,
  incident_date TIMESTAMPTZ NOT NULL,
  description TEXT,
  location TEXT,
  severity VARCHAR(20) DEFAULT 'Minor',
  is_at_fault BOOLEAN DEFAULT FALSE,
  actions_taken TEXT,
  status VARCHAR(50) DEFAULT 'Open',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- TRIP COST ANALYSIS
-- ============================================

CREATE TABLE tripcostanalysis (
  cost_id SERIAL PRIMARY KEY,
  trip_id INT NOT NULL REFERENCES trips(trip_id),
  fuel_cost DECIMAL(12, 2) DEFAULT 0,
  toll_fees DECIMAL(10, 2) DEFAULT 0,
  parking_fees DECIMAL(10, 2) DEFAULT 0,
  driver_cost DECIMAL(12, 2) DEFAULT 0,
  maintenance_cost DECIMAL(12, 2) DEFAULT 0,
  miscellaneous_cost DECIMAL(12, 2) DEFAULT 0,
  total_cost DECIMAL(14, 2) DEFAULT 0,
  cost_per_km DECIMAL(8, 2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- TRIP PERFORMANCE
-- ============================================

CREATE TABLE tripperformance (
  performance_id SERIAL PRIMARY KEY,
  trip_id INT NOT NULL REFERENCES trips(trip_id),
  driver_id INT REFERENCES drivers(driver_id),
  on_time_completion BOOLEAN,
  time_variance INT,
  fuel_efficiency DECIMAL(8, 2),
  avg_speed DECIMAL(5, 2),
  max_speed DECIMAL(5, 2),
  idle_time INT,
  smooth_driving_score DECIMAL(3, 2),
  customer_rating DECIMAL(2, 1),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- NOTIFICATIONS
-- ============================================

CREATE TABLE notifications (
  notification_id SERIAL PRIMARY KEY,
  employee_id INT REFERENCES employees(employee_id),
  user_id UUID REFERENCES auth.users(id),
  title VARCHAR(255) NOT NULL,
  message TEXT,
  type VARCHAR(50) DEFAULT 'Info',
  channel VARCHAR(50) DEFAULT 'in_app',
  reference_type VARCHAR(100),
  reference_id INT,
  is_read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(employee_id);
CREATE INDEX idx_notifications_read ON notifications(is_read);
CREATE INDEX idx_notifications_sent ON notifications(sent_at);

-- ============================================
-- MOBILE DEVICES
-- ============================================

CREATE TABLE mobiledevices (
  device_id SERIAL PRIMARY KEY,
  driver_id INT REFERENCES drivers(driver_id),
  device_token TEXT,
  device_type VARCHAR(20),
  device_name VARCHAR(255),
  app_version VARCHAR(20),
  last_active_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- OFFLINE SYNC
-- ============================================

CREATE TABLE offlinesync (
  sync_id BIGSERIAL PRIMARY KEY,
  device_id INT REFERENCES mobiledevices(device_id),
  table_name VARCHAR(100) NOT NULL,
  record_id INT,
  operation VARCHAR(20) NOT NULL,
  data JSONB,
  sync_status VARCHAR(50) DEFAULT 'Pending',
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- AI RECOMMENDATIONS
-- ============================================

CREATE TABLE ai_recommendations (
  recommendation_id SERIAL PRIMARY KEY,
  recommendation_type VARCHAR(100) NOT NULL,
  reference_type VARCHAR(100),
  reference_id INT,
  recommendation_data JSONB NOT NULL,
  confidence_score DECIMAL(3, 2),
  explanation TEXT,
  user_action VARCHAR(50),
  user_id INT REFERENCES employees(employee_id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ai_type ON ai_recommendations(recommendation_type);
CREATE INDEX idx_ai_reference ON ai_recommendations(reference_type, reference_id);

-- ============================================
-- AI INSIGHTS
-- ============================================

CREATE TABLE ai_insights (
  insight_id SERIAL PRIMARY KEY,
  insight_type VARCHAR(100) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  impact VARCHAR(20),
  category VARCHAR(100),
  related_data JSONB,
  confidence_score DECIMAL(3, 2),
  status VARCHAR(50) DEFAULT 'Active',
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- AUTOMATION RULES
-- ============================================

CREATE TABLE automation_rules (
  rule_id SERIAL PRIMARY KEY,
  rule_name VARCHAR(255) NOT NULL,
  trigger_event VARCHAR(100) NOT NULL,
  conditions JSONB,
  actions JSONB NOT NULL,
  is_enabled BOOLEAN DEFAULT TRUE,
  priority INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- AUTOMATION LOGS
-- ============================================

CREATE TABLE automation_logs (
  log_id BIGSERIAL PRIMARY KEY,
  rule_id INT REFERENCES automation_rules(rule_id),
  trigger_event VARCHAR(100),
  reference_type VARCHAR(100),
  reference_id INT,
  action_taken TEXT,
  result JSONB,
  status VARCHAR(50),
  executed_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- SCHEDULED TASKS
-- ============================================

CREATE TABLE scheduled_tasks (
  task_id SERIAL PRIMARY KEY,
  task_name VARCHAR(255) NOT NULL,
  task_type VARCHAR(100) NOT NULL,
  cron_expression VARCHAR(100),
  config JSONB,
  is_enabled BOOLEAN DEFAULT TRUE,
  last_run TIMESTAMPTZ,
  next_run TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- SCHEDULED REPORTS
-- ============================================

CREATE TABLE scheduled_reports (
  report_id SERIAL PRIMARY KEY,
  report_name VARCHAR(255) NOT NULL,
  report_type VARCHAR(100) NOT NULL,
  period VARCHAR(50) NOT NULL,
  format VARCHAR(20) DEFAULT 'pdf',
  recipients JSONB,
  filters JSONB,
  schedule_cron VARCHAR(100),
  is_enabled BOOLEAN DEFAULT TRUE,
  last_generated TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- AUDIT LOGS
-- ============================================

CREATE TABLE audit_logs (
  log_id BIGSERIAL PRIMARY KEY,
  employee_id INT REFERENCES employees(employee_id),
  action VARCHAR(50) NOT NULL,
  resource VARCHAR(100) NOT NULL,
  resource_id INT,
  old_values JSONB,
  new_values JSONB,
  ip_address VARCHAR(50),
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_resource ON audit_logs(resource, resource_id);
CREATE INDEX idx_audit_employee ON audit_logs(employee_id);
CREATE INDEX idx_audit_created ON audit_logs(created_at);

-- ============================================
-- SYSTEM CONFIG
-- ============================================

CREATE TABLE system_config (
  config_id SERIAL PRIMARY KEY,
  config_key VARCHAR(255) UNIQUE NOT NULL,
  config_value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by INT REFERENCES employees(employee_id)
);

-- ============================================
-- TRIGGERS: updated_at
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_employees_updated_at
  BEFORE UPDATE ON employees FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_vehicles_updated_at
  BEFORE UPDATE ON vehicles FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_drivers_updated_at
  BEFORE UPDATE ON drivers FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_routes_updated_at
  BEFORE UPDATE ON routes FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_reservations_updated_at
  BEFORE UPDATE ON vehiclereservations FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_dispatch_updated_at
  BEFORE UPDATE ON dispatchschedules FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_trips_updated_at
  BEFORE UPDATE ON trips FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_maintenance_updated_at
  BEFORE UPDATE ON vehiclemaintenance FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- TRIGGER: auto-generate dispatch number
-- ============================================

CREATE OR REPLACE FUNCTION generate_dispatch_number()
RETURNS TRIGGER AS $$
DECLARE
  date_part VARCHAR(8);
  seq_part INT;
BEGIN
  date_part := TO_CHAR(NEW.scheduled_departure, 'YYYYMMDD');
  seq_part := nextval('dispatch_number_seq');
  NEW.dispatch_number := 'DSP-' || date_part || '-' || LPAD(seq_part::TEXT, 4, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- SEQUENCES
-- ============================================

CREATE SEQUENCE IF NOT EXISTS dispatch_number_seq START 1;
