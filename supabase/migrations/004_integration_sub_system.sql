-- ============================================
-- FLEET TRANSPORTATION MANAGEMENT SYSTEM
-- Migration 004: Sub-System Integration
-- 
-- Purpose:
--   Refactor the fleet system to operate as a
--   sub-system integrated with a parent
--   Booking/Reservation System (PMS, POS, etc.)
--
-- Changes:
--   1. Add service_types table (fleet-specific categorization)
--   2. Add integration_log table (parent system sync)
--   3. Alter vehiclereservations for sub-system linkage
--   4. Add RLS policies for new tables
-- ============================================

-- ============================================
-- SERVICE TYPES
-- Fleet-specific service categorization.
-- Parent system handles guest/booking data;
-- this table defines what type of fleet
-- service is being requested.
-- ============================================

CREATE TABLE IF NOT EXISTS service_types (
  service_type_id SERIAL PRIMARY KEY,
  service_name VARCHAR(100) NOT NULL,
  description TEXT,
  requires_vehicle BOOLEAN DEFAULT TRUE,
  requires_driver BOOLEAN DEFAULT TRUE,
  default_category_id INT REFERENCES vehiclecategories(category_id),
  icon VARCHAR(50),
  color VARCHAR(20),
  sort_order INT DEFAULT 0,
  status VARCHAR(50) DEFAULT 'Active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

COMMENT ON TABLE service_types IS
  'Fleet service categories. Parent system manages guests/bookings; this table defines what fleet-specific service is needed (Airport Transfer, Food Delivery, Shuttle, etc.)';

-- ============================================
-- BOOKING CHANNELS
-- Reference table for where the booking
-- originated in the parent system.
-- ============================================

CREATE TABLE IF NOT EXISTS booking_channels (
  channel_id SERIAL PRIMARY KEY,
  channel_name VARCHAR(100) NOT NULL,
  source_system VARCHAR(50),
  description TEXT,
  status VARCHAR(50) DEFAULT 'Active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE booking_channels IS
  'Origin of the booking within the parent system (Front Desk, Concierge, Restaurant POS, Online, etc.)';

-- ============================================
-- INTEGRATION LOG
-- Tracks all communication between the fleet
-- sub-system and the parent booking system.
-- Supports eventual consistency and audit.
-- ============================================

CREATE TABLE IF NOT EXISTS integration_log (
  log_id BIGSERIAL PRIMARY KEY,
  direction VARCHAR(20) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  source_system VARCHAR(50) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  reference_type VARCHAR(100),
  reference_id INT,
  external_booking_id VARCHAR(255),
  payload JSONB,
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'failed', 'skipped')),
  error_message TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_integration_status ON integration_log(status);
CREATE INDEX idx_integration_external ON integration_log(external_booking_id);
CREATE INDEX idx_integration_created ON integration_log(created_at);
CREATE INDEX idx_integration_event ON integration_log(event_type);

COMMENT ON TABLE integration_log IS
  'Audit trail for all data exchange between fleet sub-system and parent booking/PMS/POS system. Inbound = parent -> fleet, Outbound = fleet -> parent.';

-- ============================================
-- MODIFY vehiclereservations
-- Add sub-system integration fields while
-- keeping backward-compatible guest info
-- as denormalized cache.
-- ============================================

ALTER TABLE vehiclereservations
  ADD COLUMN IF NOT EXISTS service_type_id INT REFERENCES service_types(service_type_id),
  ADD COLUMN IF NOT EXISTS external_booking_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS integration_source VARCHAR(50),
  ADD COLUMN IF NOT EXISTS booking_channel_id INT REFERENCES booking_channels(channel_id),
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS guest_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS room_number VARCHAR(20),
  ADD COLUMN IF NOT EXISTS bill_to_room BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_reservations_external ON vehiclereservations(external_booking_id);
CREATE INDEX IF NOT EXISTS idx_reservations_service ON vehiclereservations(service_type_id);
CREATE INDEX IF NOT EXISTS idx_reservations_channel ON vehiclereservations(booking_channel_id);

COMMENT ON COLUMN vehiclereservations.external_booking_id IS
  'Reference ID from the parent booking system (PMS reservation ID, POS order ID, etc.)';
COMMENT ON COLUMN vehiclereservations.integration_source IS
  'Name of the parent system: PMS, POS, RestoBooking, etc.';
COMMENT ON COLUMN vehiclereservations.service_type_id IS
  'Fleet service category — what kind of transport is this?';
COMMENT ON COLUMN vehiclereservations.booking_channel_id IS
  'Where the booking originated (Front Desk, Concierge, Online, etc.)';
COMMENT ON COLUMN vehiclereservations.guest_id IS
  'Guest ID from parent system (denormalized for quick reference)';
COMMENT ON COLUMN vehiclereservations.room_number IS
  'Hotel room number for billing and guest identification';
COMMENT ON COLUMN vehiclereservations.bill_to_room IS
  'Whether this transport charge should be posted to the guest room bill';

-- ============================================
-- RLS POLICIES FOR NEW TABLES
-- ============================================

ALTER TABLE service_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "All authenticated can view service types"
  ON service_types FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Admin can manage service types"
  ON service_types FOR ALL
  USING (has_role(ARRAY['admin', 'fleet_manager', 'system_admin']));

CREATE POLICY "All authenticated can view booking channels"
  ON booking_channels FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Admin can manage booking channels"
  ON booking_channels FOR ALL
  USING (has_role(ARRAY['admin', 'system_admin']));

CREATE POLICY "Admin can view integration logs"
  ON integration_log FOR SELECT
  USING (has_role(ARRAY['admin', 'system_admin']));

CREATE POLICY "System can insert integration logs"
  ON integration_log FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- ============================================
-- TRIGGER: log reservation creation to integration_log
-- ============================================

CREATE OR REPLACE FUNCTION log_reservation_integration()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.external_booking_id IS NOT NULL THEN
    INSERT INTO integration_log (
      direction,
      source_system,
      event_type,
      reference_type,
      reference_id,
      external_booking_id,
      payload,
      status
    ) VALUES (
      'outbound',
      COALESCE(NEW.integration_source, 'fleet'),
      'reservation_' || LOWER(NEW.status),
      'reservation',
      NEW.reservation_id,
      NEW.external_booking_id,
      jsonb_build_object(
        'reservation_id', NEW.reservation_id,
        'status', NEW.status,
        'service_type_id', NEW.service_type_id,
        'vehicle_id', NEW.vehicle_id,
        'driver_id', NEW.driver_id,
        'pickup_time', NEW.pickup_time,
        'reservation_date', NEW.reservation_date
      ),
      'processed'
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_log_reservation_integration
  AFTER INSERT OR UPDATE OF status ON vehiclereservations
  FOR EACH ROW
  EXECUTE FUNCTION log_reservation_integration();

-- ============================================
-- updated_at trigger for service_types
-- ============================================

CREATE TRIGGER update_service_types_updated_at
  BEFORE UPDATE ON service_types FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
