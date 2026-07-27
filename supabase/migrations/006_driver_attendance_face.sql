-- ============================================
-- FLEET TRANSPORTATION MANAGEMENT SYSTEM
-- Migration 006: Driver Attendance + Face Recognition
--
-- Purpose:
--   Restore driverattendance table with face
--   recognition support for check-in/check-out.
--
-- Changes:
--   1. Add face_image_url to drivers (reference photo)
--   2. Create driverattendance with face recognition fields
--   3. Create storage bucket for face captures
--   4. Add RLS policies
-- ============================================

-- ============================================
-- 1. ADD face_image_url TO drivers
-- Reference photo used for face recognition
-- matching during attendance check-in
-- ============================================

ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS face_image_url TEXT;

COMMENT ON COLUMN drivers.face_image_url IS
  'Reference face photo URL used for face recognition attendance verification';

-- ============================================
-- 2. CREATE driverattendance TABLE
-- Supports both manual and face recognition
-- check-in/check-out methods
-- ============================================

CREATE TABLE IF NOT EXISTS driverattendance (
  attendance_id SERIAL PRIMARY KEY,
  driver_id INT NOT NULL REFERENCES drivers(driver_id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  time_in TIMESTAMPTZ,
  time_out TIMESTAMPTZ,
  check_in_method VARCHAR(50) DEFAULT 'manual'
    CHECK (check_in_method IN ('manual', 'face_recognition')),
  face_capture_url TEXT,
  face_confidence DECIMAL(5, 4),
  face_verified BOOLEAN DEFAULT FALSE,
  check_in_latitude DECIMAL(10, 7),
  check_in_longitude DECIMAL(10, 7),
  status VARCHAR(50) DEFAULT 'Present'
    CHECK (status IN ('Present', 'Late', 'Absent', 'Half-Day', 'On Leave')),
  remarks TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attendance_driver ON driverattendance(driver_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON driverattendance(date);
CREATE INDEX IF NOT EXISTS idx_attendance_status ON driverattendance(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_driver_date ON driverattendance(driver_id, date);

COMMENT ON TABLE driverattendance IS
  'Driver attendance records with face recognition support. Each driver has one record per date.';

COMMENT ON COLUMN driverattendance.check_in_method IS
  'How the driver checked in: manual (standard) or face_recognition (AI-based)';

COMMENT ON COLUMN driverattendance.face_capture_url IS
  'URL of the face image captured during check-in for verification';

COMMENT ON COLUMN driverattendance.face_confidence IS
  'Face recognition confidence score (0.0000 to 1.0000). Higher = better match with reference photo.';

COMMENT ON COLUMN driverattendance.face_verified IS
  'Whether face recognition successfully matched the driver reference photo';

-- ============================================
-- 3. TRIGGER: updated_at
-- ============================================

CREATE TRIGGER update_driverattendance_updated_at
  BEFORE UPDATE ON driverattendance
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================
-- 4. RLS POLICIES
-- ============================================

ALTER TABLE driverattendance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Drivers can view own attendance"
  ON driverattendance FOR SELECT
  USING (
    driver_id IN (
      SELECT d.driver_id FROM drivers d
      JOIN employees e ON d.employee_id = e.employee_id
      WHERE e.user_id = auth.uid()
    )
    OR has_role(ARRAY['admin', 'fleet_manager', 'dispatcher'])
  );

CREATE POLICY "Drivers can check in"
  ON driverattendance FOR INSERT
  WITH CHECK (
    driver_id IN (
      SELECT d.driver_id FROM drivers d
      JOIN employees e ON d.employee_id = e.employee_id
      WHERE e.user_id = auth.uid()
    )
  );

CREATE POLICY "Drivers can update own check-out"
  ON driverattendance FOR UPDATE
  USING (
    driver_id IN (
      SELECT d.driver_id FROM drivers d
      JOIN employees e ON d.employee_id = e.employee_id
      WHERE e.user_id = auth.uid()
    )
    OR has_role(ARRAY['admin', 'fleet_manager'])
  );

CREATE POLICY "Admin can manage all attendance"
  ON driverattendance FOR ALL
  USING (has_role(ARRAY['admin', 'fleet_manager']));

-- ============================================
-- 5. STORAGE BUCKET FOR FACE IMAGES
-- ============================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('face-captures', 'face-captures', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Drivers can upload own face capture"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'face-captures'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Authenticated can view face captures"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'face-captures'
    AND auth.role() = 'authenticated'
  );
