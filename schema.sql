-- Structure of the live database, dumped by scripts/dump-schema.mjs.
-- Generated file — edit the database with a migration, then re-dump.
-- Structure only: no data, no owners, no grants, no timestamp (so
-- that a git diff of this file is always a real schema change).

-- ============================ TABLES ============================

CREATE TABLE ai_insights (
  insight_id integer DEFAULT nextval('ai_insights_insight_id_seq'::regclass) NOT NULL,
  insight_type varchar(100) NOT NULL,
  title varchar(255) NOT NULL,
  description text,
  impact varchar(20),
  category varchar(100),
  related_data jsonb,
  confidence_score numeric(3,2),
  status varchar(50) DEFAULT 'Active'::character varying,
  is_read boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT ai_insights_pkey PRIMARY KEY (insight_id)
);

CREATE TABLE ai_recommendations (
  recommendation_id integer DEFAULT nextval('ai_recommendations_recommendation_id_seq'::regclass) NOT NULL,
  recommendation_type varchar(100) NOT NULL,
  reference_type varchar(100),
  reference_id integer,
  recommendation_data jsonb NOT NULL,
  confidence_score numeric(3,2),
  explanation text,
  user_action varchar(50),
  user_id integer,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT ai_recommendations_pkey PRIMARY KEY (recommendation_id)
);

CREATE TABLE ai_report_narratives (
  id integer DEFAULT nextval('ai_report_narratives_id_seq'::regclass) NOT NULL,
  report varchar(20) NOT NULL,
  range_from varchar(30),
  range_to varchar(30),
  mode varchar(20) DEFAULT 'deterministic'::character varying NOT NULL,
  narrative text,
  actions jsonb,
  flag varchar(10) DEFAULT 'success'::character varying NOT NULL,
  generated_at timestamptz DEFAULT now() NOT NULL,
  last_force_at timestamptz,
  force_count integer DEFAULT 0 NOT NULL,
  force_day date DEFAULT CURRENT_DATE NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT ai_report_narratives_pkey PRIMARY KEY (id)
);

CREATE TABLE ailogs (
  log_id integer DEFAULT nextval('ailogs_log_id_seq'::regclass) NOT NULL,
  feature_used varchar(50) NOT NULL,
  provider_name varchar(50),
  model_name varchar(100),
  prompt_tokens integer DEFAULT 0,
  completion_tokens integer DEFAULT 0,
  total_tokens integer DEFAULT 0,
  duration_ms integer DEFAULT 0,
  status varchar(20) DEFAULT 'Success'::character varying,
  error_message text,
  user_email varchar(255),
  created_at timestamptz DEFAULT now(),
  CONSTRAINT ailogs_pkey PRIMARY KEY (log_id)
);

CREATE TABLE aiproviders (
  provider_id integer DEFAULT nextval('aiproviders_provider_id_seq'::regclass) NOT NULL,
  provider_name varchar(50) NOT NULL,
  display_name varchar(100) NOT NULL,
  base_url varchar(255),
  api_key text,
  model_name varchar(100) NOT NULL,
  temperature numeric(3,2) DEFAULT 0.70,
  max_tokens integer DEFAULT 1500,
  timeout_ms integer DEFAULT 10000,
  is_enabled boolean DEFAULT true,
  is_default boolean DEFAULT false,
  custom_headers jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  target_feature varchar(50) DEFAULT 'default'::character varying,
  CONSTRAINT aiproviders_pkey PRIMARY KEY (provider_id)
);

CREATE TABLE audit_logs (
  log_id bigint DEFAULT nextval('audit_logs_log_id_seq'::regclass) NOT NULL,
  employee_id integer,
  action varchar(50) NOT NULL,
  resource varchar(100) NOT NULL,
  resource_id integer,
  old_values jsonb,
  new_values jsonb,
  ip_address varchar(50),
  user_agent text,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT audit_logs_pkey PRIMARY KEY (log_id)
);

CREATE TABLE booking_channels (
  channel_id integer DEFAULT nextval('booking_channels_channel_id_seq'::regclass) NOT NULL,
  channel_name varchar(100) NOT NULL,
  source_system varchar(50),
  description text,
  status varchar(50) DEFAULT 'Active'::character varying,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT booking_channels_pkey PRIMARY KEY (channel_id)
);

CREATE TABLE device_tokens (
  device_token_id integer DEFAULT nextval('device_tokens_device_token_id_seq'::regclass) NOT NULL,
  employee_id integer,
  token text NOT NULL,
  platform varchar(20) DEFAULT 'android'::character varying NOT NULL,
  active boolean DEFAULT true NOT NULL,
  last_seen_at timestamptz DEFAULT now() NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT device_tokens_pkey PRIMARY KEY (device_token_id),
  CONSTRAINT device_tokens_token_key UNIQUE (token)
);

CREATE TABLE dispatchschedules (
  dispatch_id integer DEFAULT nextval('dispatchschedules_dispatch_id_seq'::regclass) NOT NULL,
  vehicle_id integer,
  driver_id integer,
  route_id integer,
  dispatch_number varchar(50) NOT NULL,
  scheduled_departure timestamptz,
  scheduled_arrival timestamptz,
  actual_departure timestamptz,
  actual_arrival timestamptz,
  status varchar(50) DEFAULT 'Pending'::character varying,
  priority varchar(20) DEFAULT 'Normal'::character varying,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz,
  created_by integer,
  updated_by integer,
  request_id integer,
  cancel_reason text,
  CONSTRAINT chk_dispatch_status CHECK (((status)::text = ANY ((ARRAY['Scheduled'::character varying, 'In Progress'::character varying, 'Completed'::character varying, 'Cancelled'::character varying, 'Pending Reassignment'::character varying])::text[]))),
  CONSTRAINT dispatchschedules_pkey PRIMARY KEY (dispatch_id),
  CONSTRAINT dispatchschedules_dispatch_number_key UNIQUE (dispatch_number)
);

CREATE TABLE driver_consents (
  consent_id integer DEFAULT nextval('driver_consents_consent_id_seq'::regclass) NOT NULL,
  driver_id integer NOT NULL,
  policy_version integer NOT NULL,
  accepted_at timestamptz DEFAULT now() NOT NULL,
  accepted_via varchar(20) DEFAULT 'web'::character varying NOT NULL,
  ip_address varchar(50),
  created_at timestamptz DEFAULT now(),
  CONSTRAINT driver_consents_accepted_via_check CHECK (((accepted_via)::text = ANY ((ARRAY['web'::character varying, 'mobile'::character varying])::text[]))),
  CONSTRAINT driver_consents_pkey PRIMARY KEY (consent_id)
);

CREATE TABLE driver_leave_balances (
  balance_id integer DEFAULT nextval('driver_leave_balances_balance_id_seq'::regclass) NOT NULL,
  driver_id integer NOT NULL,
  leave_type varchar(50) NOT NULL,
  allocated_days numeric DEFAULT 0 NOT NULL,
  used_days numeric DEFAULT 0 NOT NULL,
  CONSTRAINT driver_leave_balances_pkey PRIMARY KEY (balance_id),
  CONSTRAINT driver_leave_balances_driver_id_leave_type_key UNIQUE (driver_id, leave_type)
);

CREATE TABLE driver_leave_requests (
  leave_request_id integer DEFAULT nextval('driver_leave_requests_leave_request_id_seq'::regclass) NOT NULL,
  driver_id integer NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  leave_type varchar(50) DEFAULT 'Vacation Leave'::character varying NOT NULL,
  reason text,
  status varchar(20) DEFAULT 'Pending'::character varying NOT NULL,
  requested_at timestamptz DEFAULT now() NOT NULL,
  reviewed_by integer,
  reviewed_at timestamptz,
  review_notes text,
  start_time time,
  end_time time,
  CONSTRAINT chk_leave_interval CHECK ((end_date >= start_date)),
  CONSTRAINT driver_leave_requests_status_check CHECK (((status)::text = ANY ((ARRAY['Pending'::character varying, 'Approved'::character varying, 'Declined'::character varying])::text[]))),
  CONSTRAINT driver_leave_requests_pkey PRIMARY KEY (leave_request_id)
);

CREATE TABLE driver_vehicle_assignments (
  assignment_id integer DEFAULT nextval('driver_vehicle_assignments_assignment_id_seq'::regclass) NOT NULL,
  driver_id integer NOT NULL,
  vehicle_id integer NOT NULL,
  assigned_from date DEFAULT CURRENT_DATE NOT NULL,
  assigned_until date,
  release_reason varchar(100),
  notes text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by integer,
  updated_by integer,
  CONSTRAINT chk_dva_interval CHECK (((assigned_until IS NULL) OR (assigned_until >= assigned_from))),
  CONSTRAINT driver_vehicle_assignments_pkey PRIMARY KEY (assignment_id)
);

CREATE TABLE driver_work_schedules (
  schedule_id integer DEFAULT nextval('driver_work_schedules_schedule_id_seq'::regclass) NOT NULL,
  driver_id integer NOT NULL,
  day_of_week smallint NOT NULL,
  shift_start time NOT NULL,
  shift_end time NOT NULL,
  break_start time,
  break_end time,
  is_rest_day boolean DEFAULT false NOT NULL,
  created_by integer,
  updated_by integer,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT chk_sched_break CHECK ((((break_start IS NULL) AND (break_end IS NULL)) OR ((break_start IS NOT NULL) AND (break_end IS NOT NULL) AND (break_end > break_start)))),
  CONSTRAINT chk_sched_rest_day CHECK (((NOT is_rest_day) OR ((shift_start = '00:00:00'::time without time zone) AND (shift_end = '00:00:00'::time without time zone)))),
  CONSTRAINT chk_sched_shift CHECK ((is_rest_day OR (shift_end > shift_start))),
  CONSTRAINT driver_work_schedules_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6))),
  CONSTRAINT driver_work_schedules_pkey PRIMARY KEY (schedule_id)
);

CREATE TABLE driverattendance (
  attendance_id integer DEFAULT nextval('driverattendance_attendance_id_seq'::regclass) NOT NULL,
  driver_id integer NOT NULL,
  date date DEFAULT CURRENT_DATE NOT NULL,
  time_in timestamptz,
  time_out timestamptz,
  check_in_method varchar(50) DEFAULT 'manual'::character varying,
  face_capture_url text,
  face_confidence numeric(5,4),
  face_verified boolean DEFAULT false,
  check_in_latitude numeric(10,7),
  check_in_longitude numeric(10,7),
  status varchar(50) DEFAULT 'Present'::character varying,
  remarks text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT driverattendance_check_in_method_check CHECK (((check_in_method)::text = ANY ((ARRAY['manual'::character varying, 'face_recognition'::character varying])::text[]))),
  CONSTRAINT driverattendance_status_check CHECK (((status)::text = ANY ((ARRAY['Present'::character varying, 'Late'::character varying, 'Absent'::character varying, 'Half-Day'::character varying, 'On Leave'::character varying])::text[]))),
  CONSTRAINT driverattendance_pkey PRIMARY KEY (attendance_id)
);

CREATE TABLE driverincidents (
  incident_id integer DEFAULT nextval('driverincidents_incident_id_seq'::regclass) NOT NULL,
  driver_id integer NOT NULL,
  vehicle_id integer,
  trip_id integer,
  incident_type varchar(100) NOT NULL,
  incident_date timestamptz DEFAULT now() NOT NULL,
  description text,
  location text,
  severity varchar(20) DEFAULT 'Minor'::character varying,
  is_at_fault boolean DEFAULT false,
  actions_taken text,
  status varchar(50) DEFAULT 'Open'::character varying,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz,
  latitude numeric(10,7),
  longitude numeric(10,7),
  assistance_needed text[],
  expense_amount numeric(12,2),
  client_submission_id varchar(64),
  photo_urls text[] DEFAULT '{}'::text[],
  CONSTRAINT chk_driverincidents_status CHECK (((status)::text = ANY ((ARRAY['Open'::character varying, 'Resolved'::character varying])::text[]))),
  CONSTRAINT driverincidents_pkey PRIMARY KEY (incident_id)
);

CREATE TABLE drivers (
  driver_id integer DEFAULT nextval('drivers_driver_id_seq'::regclass) NOT NULL,
  employee_id integer NOT NULL,
  license_number varchar(100),
  license_expiry date,
  license_type varchar(50),
  license_class varchar(50),
  years_of_experience integer DEFAULT 0,
  driver_status varchar(50) DEFAULT 'Available'::character varying,
  current_latitude numeric(10,7),
  current_longitude numeric(10,7),
  last_location_update timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz,
  created_by integer,
  updated_by integer,
  face_image_url text,
  address text,
  sex varchar(20),
  birthdate date,
  nationality varchar(100),
  emergency_contact_name varchar(255),
  emergency_contact_phone varchar(50),
  emergency_contact_address text,
  license_image_url text,
  license_back_image_url text,
  suspension_reason varchar(50),
  CONSTRAINT chk_driver_status CHECK (((driver_status)::text = ANY ((ARRAY['Available'::character varying, 'On Trip'::character varying, 'Off Duty'::character varying, 'On Leave'::character varying, 'Suspended'::character varying])::text[]))),
  CONSTRAINT drivers_pkey PRIMARY KEY (driver_id)
);

CREATE TABLE employees (
  employee_id integer DEFAULT nextval('employees_employee_id_seq'::regclass) NOT NULL,
  role_id integer,
  user_id uuid,
  first_name varchar(100) NOT NULL,
  last_name varchar(100) NOT NULL,
  position varchar(100),
  email varchar(255) NOT NULL,
  phone varchar(50),
  status varchar(50) DEFAULT 'Active'::character varying,
  avatar_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz,
  created_by integer,
  updated_by integer,
  password_hash text,
  CONSTRAINT employees_pkey PRIMARY KEY (employee_id),
  CONSTRAINT employees_email_key UNIQUE (email)
);

CREATE TABLE fuelallocations (
  allocation_id integer DEFAULT nextval('fuelallocations_allocation_id_seq'::regclass) NOT NULL,
  vehicle_id integer NOT NULL,
  allocation_month date NOT NULL,
  allocated_liters numeric(12,2) NOT NULL,
  created_by integer,
  updated_by integer,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT fuelallocations_allocated_liters_check CHECK ((allocated_liters > (0)::numeric)),
  CONSTRAINT fuelallocations_allocation_month_check CHECK ((allocation_month = (date_trunc('month'::text, (allocation_month)::timestamp with time zone))::date)),
  CONSTRAINT fuelallocations_pkey PRIMARY KEY (allocation_id),
  CONSTRAINT fuelallocations_vehicle_id_allocation_month_key UNIQUE (vehicle_id, allocation_month)
);

CREATE TABLE fuelrecords (
  fuel_record_id integer DEFAULT nextval('fuelrecords_fuel_record_id_seq'::regclass) NOT NULL,
  vehicle_id integer NOT NULL,
  driver_id integer,
  trip_id integer,
  liters numeric(10,2) NOT NULL,
  amount numeric(12,2) NOT NULL,
  price_per_liter numeric(10,2),
  odometer numeric(12,2),
  fuel_type varchar(50),
  fuel_date date NOT NULL,
  receipt_url text,
  status varchar(50) DEFAULT 'Pending'::character varying,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz,
  created_by integer,
  updated_by integer,
  station_name varchar(255),
  rejection_reason text,
  approved_by integer,
  approved_at timestamptz,
  client_submission_id varchar(64),
  fuel_request_id integer,
  receipt_fuel_type text,
  receipt_scan_data jsonb,
  flags jsonb,
  receipt_transaction_id varchar(64),
  review_remarks text,
  CONSTRAINT chk_fuel_status CHECK (((status)::text = ANY ((ARRAY['Pending'::character varying, 'Approved'::character varying, 'Rejected'::character varying, 'Completed'::character varying])::text[]))),
  CONSTRAINT fuelrecords_pkey PRIMARY KEY (fuel_record_id)
);

CREATE TABLE fuelrequests (
  fuel_request_id integer DEFAULT nextval('fuelrequests_fuel_request_id_seq'::regclass) NOT NULL,
  vehicle_id integer NOT NULL,
  driver_id integer NOT NULL,
  trip_id integer,
  requested_liters numeric(10,2) NOT NULL,
  approved_liters numeric(10,2),
  purpose text,
  status varchar(20) DEFAULT 'Pending'::character varying NOT NULL,
  review_notes text,
  approved_by integer,
  approved_at timestamptz,
  fulfilled_at timestamptz,
  client_submission_id varchar(64),
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  current_fuel_level_percent numeric(5,2),
  recommended_liters numeric(10,2),
  forecast_distance_km numeric(10,2),
  allocation_month date NOT NULL,
  calculation_snapshot jsonb,
  gauge_photo_url text,
  CONSTRAINT chk_fuelrequest_approved_liters CHECK (((approved_liters IS NULL) OR ((approved_liters > (0)::numeric) AND (approved_liters <= (1000)::numeric)))),
  CONSTRAINT chk_fuelrequest_current_level CHECK (((current_fuel_level_percent IS NULL) OR ((current_fuel_level_percent >= (0)::numeric) AND (current_fuel_level_percent <= (100)::numeric)))),
  CONSTRAINT fuelrequests_requested_liters_check CHECK (((requested_liters > (0)::numeric) AND (requested_liters <= (1000)::numeric))),
  CONSTRAINT fuelrequests_status_check CHECK (((status)::text = ANY ((ARRAY['Pending'::character varying, 'Approved'::character varying, 'Rejected'::character varying, 'Fulfilled'::character varying])::text[]))),
  CONSTRAINT fuelrequests_pkey PRIMARY KEY (fuel_request_id)
);

CREATE TABLE gpstracking (
  tracking_id bigint DEFAULT nextval('gpstracking_tracking_id_seq'::regclass) NOT NULL,
  vehicle_id integer NOT NULL,
  trip_id integer,
  latitude numeric(10,7) NOT NULL,
  longitude numeric(10,7) NOT NULL,
  speed numeric(5,2) DEFAULT 0,
  heading numeric(5,2) DEFAULT 0,
  altitude numeric(8,2) DEFAULT 0,
  accuracy numeric(5,2) DEFAULT 0,
  recorded_at timestamptz DEFAULT now(),
  CONSTRAINT gpstracking_pkey PRIMARY KEY (tracking_id)
);

CREATE TABLE integration_log (
  log_id bigint DEFAULT nextval('integration_log_log_id_seq'::regclass) NOT NULL,
  direction varchar(20) NOT NULL,
  source_system varchar(50) NOT NULL,
  event_type varchar(100) NOT NULL,
  reference_type varchar(100),
  reference_id integer,
  external_booking_id varchar(255),
  payload jsonb,
  status varchar(50) DEFAULT 'pending'::character varying,
  error_message text,
  processed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT integration_log_direction_check CHECK (((direction)::text = ANY ((ARRAY['inbound'::character varying, 'outbound'::character varying])::text[]))),
  CONSTRAINT integration_log_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'processed'::character varying, 'failed'::character varying, 'skipped'::character varying])::text[]))),
  CONSTRAINT integration_log_pkey PRIMARY KEY (log_id)
);

CREATE TABLE locations (
  location_id integer DEFAULT nextval('locations_location_id_seq'::regclass) NOT NULL,
  name varchar(255) NOT NULL,
  address text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  created_at timestamptz DEFAULT now(),
  is_active boolean DEFAULT true NOT NULL,
  retired_at timestamptz,
  CONSTRAINT locations_pkey PRIMARY KEY (location_id)
);

CREATE TABLE mobile_refresh_tokens (
  id bigint DEFAULT nextval('mobile_refresh_tokens_id_seq'::regclass) NOT NULL,
  employee_id integer NOT NULL,
  token_hash text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT mobile_refresh_tokens_pkey PRIMARY KEY (id),
  CONSTRAINT mobile_refresh_tokens_token_hash_key UNIQUE (token_hash)
);

CREATE TABLE notification_preferences (
  employee_id integer NOT NULL,
  event_key varchar(60) NOT NULL,
  channel varchar(20) DEFAULT 'in_app'::character varying NOT NULL,
  enabled boolean DEFAULT true NOT NULL,
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT notification_preferences_channel_check CHECK (((channel)::text = ANY ((ARRAY['in_app'::character varying, 'email'::character varying, 'push'::character varying])::text[]))),
  CONSTRAINT notification_preferences_pkey PRIMARY KEY (employee_id, event_key, channel)
);

CREATE TABLE notifications (
  notification_id integer DEFAULT nextval('notifications_notification_id_seq'::regclass) NOT NULL,
  employee_id integer,
  user_id uuid,
  title varchar(255) NOT NULL,
  message text,
  type varchar(50) DEFAULT 'Info'::character varying,
  channel varchar(50) DEFAULT 'in_app'::character varying,
  reference_type varchar(100),
  reference_id integer,
  is_read boolean DEFAULT false,
  read_at timestamptz,
  sent_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  pushed_at timestamptz,
  CONSTRAINT notifications_pkey PRIMARY KEY (notification_id)
);

CREATE TABLE push_outbox (
  id bigint DEFAULT nextval('push_outbox_id_seq'::regclass) NOT NULL,
  employee_id integer NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  channel_id text DEFAULT 'default'::text NOT NULL,
  reference_type text,
  reference_id integer,
  status text DEFAULT 'pending'::text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  sent_at timestamptz,
  error text,
  CONSTRAINT push_outbox_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'error'::text]))),
  CONSTRAINT push_outbox_pkey PRIMARY KEY (id)
);

CREATE TABLE recommendation_snapshots (
  snapshot_id integer DEFAULT nextval('recommendation_snapshots_snapshot_id_seq'::regclass) NOT NULL,
  request_id integer NOT NULL,
  generated_at timestamptz DEFAULT now() NOT NULL,
  valid_until timestamptz,
  pair_json jsonb NOT NULL,
  vehicle_id integer,
  driver_id integer,
  designated_driver_id integer,
  pair_score numeric,
  confidence numeric,
  reason_type varchar(20) DEFAULT 'designated'::character varying,
  replacement_reason text,
  fleet_status varchar(50),
  driver_status varchar(50),
  is_consumed boolean DEFAULT false NOT NULL,
  consumed_at timestamptz,
  created_by integer,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT recommendation_snapshots_reason_type_check CHECK (((reason_type)::text = ANY ((ARRAY['designated'::character varying, 'replacement'::character varying])::text[]))),
  CONSTRAINT recommendation_snapshots_pkey PRIMARY KEY (snapshot_id)
);

CREATE TABLE reservation_events (
  event_id bigint DEFAULT nextval('reservation_events_event_id_seq'::regclass) NOT NULL,
  request_id integer NOT NULL,
  event_type varchar(50) NOT NULL,
  from_status varchar(50),
  to_status varchar(50),
  actor_id integer,
  actor_role varchar(50),
  description text,
  metadata jsonb,
  occurred_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT reservation_events_pkey PRIMARY KEY (event_id)
);

CREATE TABLE roles (
  role_id integer DEFAULT nextval('roles_role_id_seq'::regclass) NOT NULL,
  role_name varchar(100) NOT NULL,
  description text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT roles_pkey PRIMARY KEY (role_id),
  CONSTRAINT roles_role_name_key UNIQUE (role_name)
);

CREATE TABLE routes (
  route_id integer DEFAULT nextval('routes_route_id_seq'::regclass) NOT NULL,
  route_name varchar(255) NOT NULL,
  origin varchar(255) NOT NULL,
  destination varchar(255) NOT NULL,
  estimated_distance numeric(10,2),
  estimated_duration integer,
  status varchar(50) DEFAULT 'Active'::character varying,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz,
  origin_location_id integer,
  destination_location_id integer,
  estimate_source varchar(30),
  estimate_updated_at timestamptz,
  CONSTRAINT routes_endpoint_pair_check CHECK ((((origin_location_id IS NULL) AND (destination_location_id IS NULL)) OR ((origin_location_id IS NOT NULL) AND (destination_location_id IS NOT NULL) AND (origin_location_id <> destination_location_id)))),
  CONSTRAINT routes_estimate_source_check CHECK (((estimate_source IS NULL) OR ((estimate_source)::text = ANY ((ARRAY['TomTom'::character varying, 'Manual'::character varying, 'Legacy / Unknown'::character varying])::text[])))),
  CONSTRAINT routes_positive_estimates_check CHECK ((((estimated_distance IS NULL) OR (estimated_distance > (0)::numeric)) AND ((estimated_duration IS NULL) OR (estimated_duration > 0)))),
  CONSTRAINT routes_status_check CHECK (((status)::text = ANY ((ARRAY['Active'::character varying, 'Inactive'::character varying])::text[]))),
  CONSTRAINT routes_pkey PRIMARY KEY (route_id)
);

CREATE TABLE schema_migrations (
  filename text NOT NULL,
  checksum text NOT NULL,
  applied_at timestamptz DEFAULT now() NOT NULL,
  applied_by text,
  CONSTRAINT schema_migrations_pkey PRIMARY KEY (filename)
);

CREATE TABLE service_types (
  service_type_id integer DEFAULT nextval('service_types_service_type_id_seq'::regclass) NOT NULL,
  service_name varchar(100) NOT NULL,
  description text,
  requires_vehicle boolean DEFAULT true,
  requires_driver boolean DEFAULT true,
  default_category_id integer,
  icon varchar(50),
  color varchar(20),
  sort_order integer DEFAULT 0,
  status varchar(50) DEFAULT 'Active'::character varying,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT service_types_pkey PRIMARY KEY (service_type_id)
);

CREATE TABLE substitute_vehicle_schedules (
  substitute_id integer DEFAULT nextval('substitute_vehicle_schedules_substitute_id_seq'::regclass) NOT NULL,
  vehicle_id integer NOT NULL,
  substitute_driver_id integer NOT NULL,
  effective_from date DEFAULT CURRENT_DATE NOT NULL,
  effective_until date,
  notes text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by integer,
  updated_by integer,
  CONSTRAINT chk_sub_interval CHECK (((effective_until IS NULL) OR (effective_until >= effective_from))),
  CONSTRAINT substitute_vehicle_schedules_pkey PRIMARY KEY (substitute_id)
);

CREATE TABLE system_settings (
  setting_key varchar(100) NOT NULL,
  setting_value jsonb NOT NULL,
  updated_at timestamptz DEFAULT now(),
  updated_by integer,
  CONSTRAINT system_settings_pkey PRIMARY KEY (setting_key)
);

CREATE TABLE transportation_requests (
  request_id integer DEFAULT nextval('transportation_requests_request_id_seq'::regclass) NOT NULL,
  external_booking_id varchar(255),
  source_system varchar(50) DEFAULT 'PMS'::character varying NOT NULL,
  booking_reference varchar(100),
  guest_name varchar(255),
  pickup_location text NOT NULL,
  dropoff_location text,
  pickup_datetime timestamptz NOT NULL,
  passenger_count integer DEFAULT 1 NOT NULL,
  special_requests text,
  service_type_id integer,
  priority varchar(20) DEFAULT 'Normal'::character varying NOT NULL,
  booking_status varchar(50) DEFAULT 'Pending'::character varying,
  fleet_status varchar(50) DEFAULT 'Pending'::character varying NOT NULL,
  status_reason text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz,
  reservation_number varchar(30),
  requested_vehicle_type varchar(100),
  requested_category_id integer,
  estimated_distance numeric(10,2),
  estimated_duration integer,
  vehicle_id integer,
  driver_id integer,
  ai_vehicle_recommendation jsonb,
  ai_driver_recommendation jsonb,
  reviewed_by integer,
  reviewed_at timestamptz,
  approved_by integer,
  approved_at timestamptz,
  is_vip boolean DEFAULT false NOT NULL,
  is_emergency boolean DEFAULT false NOT NULL,
  derived_priority varchar(20),
  CONSTRAINT chk_transport_derived_priority CHECK (((derived_priority IS NULL) OR ((derived_priority)::text = ANY ((ARRAY['Overdue'::character varying, 'Critical'::character varying, 'High'::character varying, 'Medium'::character varying, 'Normal'::character varying, 'Future'::character varying])::text[])))),
  CONSTRAINT chk_transport_fleet_status CHECK (((fleet_status)::text = ANY ((ARRAY['Pending'::character varying, 'Scheduled'::character varying, 'Assigned'::character varying, 'In Progress'::character varying, 'Completed'::character varying, 'Cancelled'::character varying])::text[]))),
  CONSTRAINT chk_transport_priority CHECK (((priority)::text = ANY ((ARRAY['Urgent'::character varying, 'High'::character varying, 'Medium'::character varying, 'Low'::character varying])::text[]))),
  CONSTRAINT transportation_requests_pkey PRIMARY KEY (request_id),
  CONSTRAINT transportation_requests_external_booking_id_key UNIQUE (external_booking_id),
  CONSTRAINT transportation_requests_reservation_number_key UNIQUE (reservation_number)
);

CREATE TABLE trips (
  trip_id integer DEFAULT nextval('trips_trip_id_seq'::regclass) NOT NULL,
  vehicle_id integer NOT NULL,
  driver_id integer NOT NULL,
  dispatch_id integer,
  route_id integer,
  start_time timestamptz,
  end_time timestamptz,
  distance numeric(10,2) DEFAULT 0,
  actual_duration integer,
  trip_status varchar(50) DEFAULT 'Pending'::character varying,
  start_odometer numeric(12,2),
  end_odometer numeric(12,2),
  fuel_consumed numeric(10,2),
  avg_speed numeric(5,2),
  max_speed numeric(5,2),
  idle_time integer DEFAULT 0,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz,
  created_by integer,
  updated_by integer,
  fuel_cost numeric(12,2) DEFAULT 0,
  toll_fees numeric(10,2) DEFAULT 0,
  parking_fees numeric(10,2) DEFAULT 0,
  driver_cost numeric(12,2) DEFAULT 0,
  maintenance_cost numeric(12,2) DEFAULT 0,
  miscellaneous_cost numeric(12,2) DEFAULT 0,
  total_cost numeric(14,2) DEFAULT 0,
  cost_per_km numeric(8,2),
  on_time_completion boolean,
  time_variance integer,
  fuel_efficiency numeric(8,2),
  smooth_driving_score numeric(3,2),
  customer_rating numeric(2,1),
  performance_notes text,
  CONSTRAINT chk_trip_status CHECK (((trip_status)::text = ANY ((ARRAY['Assigned'::character varying, 'Pending'::character varying, 'Approved'::character varying, 'Vehicle Assigned'::character varying, 'Driver Assigned'::character varying, 'Dispatched'::character varying, 'Driver Accepted'::character varying, 'Trip Started'::character varying, 'At Pickup'::character varying, 'Passenger Onboard'::character varying, 'En Route'::character varying, 'Drop-off'::character varying, 'Arrived'::character varying, 'In Progress'::character varying, 'Completed'::character varying, 'Cancelled'::character varying])::text[]))),
  CONSTRAINT trips_pkey PRIMARY KEY (trip_id)
);

CREATE TABLE uvvrp_exemptions (
  exemption_id integer DEFAULT nextval('uvvrp_exemptions_exemption_id_seq'::regclass) NOT NULL,
  vehicle_id integer NOT NULL,
  category varchar(100) NOT NULL,
  reason text,
  approved_by integer,
  approved_at timestamptz DEFAULT now(),
  expires_on date,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT uvvrp_exemptions_pkey PRIMARY KEY (exemption_id)
);

CREATE TABLE uvvrp_violations (
  violation_id integer DEFAULT nextval('uvvrp_violations_violation_id_seq'::regclass) NOT NULL,
  vehicle_id integer NOT NULL,
  dispatch_id integer,
  scheduled_departure timestamptz,
  weekday varchar(20),
  plate_digit integer,
  action varchar(30) DEFAULT 'blocked'::character varying NOT NULL,
  reason text,
  created_by integer,
  decided_by integer,
  decided_at timestamptz,
  decision_reason text,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT uvvrp_violations_pkey PRIMARY KEY (violation_id)
);

CREATE TABLE vehiclecategories (
  category_id integer DEFAULT nextval('vehiclecategories_category_id_seq'::regclass) NOT NULL,
  category_name varchar(100) NOT NULL,
  description text,
  base_rate numeric(12,2),
  per_km_rate numeric(10,2),
  per_hour_rate numeric(10,2),
  seating_capacity integer,
  image_url text,
  status varchar(50) DEFAULT 'Active'::character varying,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT vehiclecategories_pkey PRIMARY KEY (category_id)
);

CREATE TABLE vehicledocuments (
  document_id integer DEFAULT nextval('vehicledocuments_document_id_seq'::regclass) NOT NULL,
  vehicle_id integer NOT NULL,
  document_type varchar(100) NOT NULL,
  document_number varchar(255),
  file_url text NOT NULL,
  expiry_date date,
  status varchar(50) DEFAULT 'Active'::character varying,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT vehicledocuments_pkey PRIMARY KEY (document_id)
);

CREATE TABLE vehicleinspection (
  inspection_id integer DEFAULT nextval('vehicleinspection_inspection_id_seq'::regclass) NOT NULL,
  vehicle_id integer NOT NULL,
  driver_id integer,
  inspection_type varchar(50) NOT NULL,
  inspection_date date NOT NULL,
  checklist jsonb,
  findings text,
  severity varchar(20),
  status varchar(50) DEFAULT 'Pending'::character varying,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  trip_id integer,
  client_submission_id varchar(64),
  CONSTRAINT vehicleinspection_pkey PRIMARY KEY (inspection_id)
);

CREATE TABLE vehiclemaintenance (
  maintenance_id integer DEFAULT nextval('vehiclemaintenance_maintenance_id_seq'::regclass) NOT NULL,
  vehicle_id integer NOT NULL,
  maintenance_type varchar(50) DEFAULT 'Routine'::character varying NOT NULL,
  description text,
  maintenance_date date NOT NULL,
  completed_date date,
  cost numeric(12,2) DEFAULT 0,
  mileage_at_service numeric(12,2),
  service_provider varchar(255),
  service_center varchar(255),
  next_schedule_date date,
  next_schedule_mileage numeric(12,2),
  status varchar(50) DEFAULT 'Scheduled'::character varying,
  priority varchar(20) DEFAULT 'Normal'::character varying,
  is_recurring boolean DEFAULT false,
  recurring_interval_days integer,
  recurring_interval_km numeric(10,2),
  remarks text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz,
  created_by integer,
  updated_by integer,
  source_incident_id integer,
  completed_by integer,
  completed_at timestamptz,
  CONSTRAINT vehiclemaintenance_pkey PRIMARY KEY (maintenance_id)
);

CREATE TABLE vehicles (
  vehicle_id integer DEFAULT nextval('vehicles_vehicle_id_seq'::regclass) NOT NULL,
  category_id integer,
  plate_number varchar(50) NOT NULL,
  vehicle_name varchar(255) NOT NULL,
  model varchar(100),
  manufacturer varchar(100),
  year integer,
  color varchar(50),
  fuel_type varchar(50) DEFAULT 'Gasoline'::character varying,
  seating_capacity integer DEFAULT 4,
  mileage numeric(12,2) DEFAULT 0,
  fuel_level numeric(5,2) DEFAULT 100,
  license_plate_expiry date,
  insurance_expiry date,
  registration_expiry date,
  purchase_date date,
  purchase_price numeric(14,2),
  image_url text,
  vehicle_status varchar(50) DEFAULT 'Available'::character varying,
  last_service_date date,
  next_service_mileage numeric(12,2),
  next_service_date date,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz,
  created_by integer,
  updated_by integer,
  service_interval_km integer,
  service_interval_days integer,
  tank_capacity_l numeric(10,2),
  fuel_efficiency_kmpl numeric(8,2),
  CONSTRAINT chk_vehicle_fuel_efficiency CHECK (((fuel_efficiency_kmpl IS NULL) OR ((fuel_efficiency_kmpl > (0)::numeric) AND (fuel_efficiency_kmpl <= (100)::numeric)))),
  CONSTRAINT chk_vehicle_status CHECK (((vehicle_status)::text = ANY ((ARRAY['Available'::character varying, 'Reserved'::character varying, 'In Use'::character varying, 'Under Maintenance'::character varying, 'Decommissioned'::character varying])::text[]))),
  CONSTRAINT chk_vehicle_tank_capacity CHECK (((tank_capacity_l IS NULL) OR ((tank_capacity_l > (0)::numeric) AND (tank_capacity_l <= (1000)::numeric)))),
  CONSTRAINT vehicles_pkey PRIMARY KEY (vehicle_id),
  CONSTRAINT vehicles_plate_number_key UNIQUE (plate_number)
);

-- ========================= FOREIGN KEYS =========================
-- Separate so the tables above can be created in any order.

ALTER TABLE ai_recommendations ADD CONSTRAINT ai_recommendations_user_id_fkey FOREIGN KEY (user_id) REFERENCES employees(employee_id);
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(employee_id);
ALTER TABLE device_tokens ADD CONSTRAINT device_tokens_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(employee_id) ON DELETE CASCADE;
ALTER TABLE dispatchschedules ADD CONSTRAINT dispatchschedules_created_by_fkey FOREIGN KEY (created_by) REFERENCES employees(employee_id);
ALTER TABLE dispatchschedules ADD CONSTRAINT dispatchschedules_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(driver_id);
ALTER TABLE dispatchschedules ADD CONSTRAINT dispatchschedules_request_id_fkey FOREIGN KEY (request_id) REFERENCES transportation_requests(request_id);
ALTER TABLE dispatchschedules ADD CONSTRAINT dispatchschedules_route_id_fkey FOREIGN KEY (route_id) REFERENCES routes(route_id);
ALTER TABLE dispatchschedules ADD CONSTRAINT dispatchschedules_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES employees(employee_id);
ALTER TABLE dispatchschedules ADD CONSTRAINT dispatchschedules_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES vehicles(vehicle_id);
ALTER TABLE driver_consents ADD CONSTRAINT driver_consents_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(driver_id) ON DELETE CASCADE;
ALTER TABLE driver_leave_balances ADD CONSTRAINT driver_leave_balances_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(driver_id) ON DELETE CASCADE;
ALTER TABLE driver_leave_requests ADD CONSTRAINT driver_leave_requests_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(driver_id) ON DELETE CASCADE;
ALTER TABLE driver_leave_requests ADD CONSTRAINT driver_leave_requests_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES employees(employee_id);
ALTER TABLE driver_vehicle_assignments ADD CONSTRAINT driver_vehicle_assignments_created_by_fkey FOREIGN KEY (created_by) REFERENCES employees(employee_id);
ALTER TABLE driver_vehicle_assignments ADD CONSTRAINT driver_vehicle_assignments_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(driver_id) ON DELETE CASCADE;
ALTER TABLE driver_vehicle_assignments ADD CONSTRAINT driver_vehicle_assignments_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES employees(employee_id);
ALTER TABLE driver_vehicle_assignments ADD CONSTRAINT driver_vehicle_assignments_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES vehicles(vehicle_id) ON DELETE CASCADE;
ALTER TABLE driver_work_schedules ADD CONSTRAINT driver_work_schedules_created_by_fkey FOREIGN KEY (created_by) REFERENCES employees(employee_id);
ALTER TABLE driver_work_schedules ADD CONSTRAINT driver_work_schedules_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(driver_id) ON DELETE CASCADE;
ALTER TABLE driver_work_schedules ADD CONSTRAINT driver_work_schedules_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES employees(employee_id);
ALTER TABLE driverattendance ADD CONSTRAINT driverattendance_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(driver_id) ON DELETE CASCADE;
ALTER TABLE driverincidents ADD CONSTRAINT driverincidents_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(driver_id);
ALTER TABLE driverincidents ADD CONSTRAINT driverincidents_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES trips(trip_id);
ALTER TABLE driverincidents ADD CONSTRAINT driverincidents_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES vehicles(vehicle_id);
ALTER TABLE drivers ADD CONSTRAINT drivers_created_by_fkey FOREIGN KEY (created_by) REFERENCES employees(employee_id);
ALTER TABLE drivers ADD CONSTRAINT drivers_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(employee_id);
ALTER TABLE drivers ADD CONSTRAINT drivers_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES employees(employee_id);
ALTER TABLE employees ADD CONSTRAINT employees_created_by_fkey FOREIGN KEY (created_by) REFERENCES employees(employee_id);
ALTER TABLE employees ADD CONSTRAINT employees_role_id_fkey FOREIGN KEY (role_id) REFERENCES roles(role_id);
ALTER TABLE employees ADD CONSTRAINT employees_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES employees(employee_id);
ALTER TABLE employees ADD CONSTRAINT employees_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE fuelallocations ADD CONSTRAINT fuelallocations_created_by_fkey FOREIGN KEY (created_by) REFERENCES employees(employee_id);
ALTER TABLE fuelallocations ADD CONSTRAINT fuelallocations_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES employees(employee_id);
ALTER TABLE fuelallocations ADD CONSTRAINT fuelallocations_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES vehicles(vehicle_id);
ALTER TABLE fuelrecords ADD CONSTRAINT fk_fuelrecords_fuel_request FOREIGN KEY (fuel_request_id) REFERENCES fuelrequests(fuel_request_id);
ALTER TABLE fuelrecords ADD CONSTRAINT fuelrecords_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES employees(employee_id);
ALTER TABLE fuelrecords ADD CONSTRAINT fuelrecords_created_by_fkey FOREIGN KEY (created_by) REFERENCES employees(employee_id);
ALTER TABLE fuelrecords ADD CONSTRAINT fuelrecords_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(driver_id);
ALTER TABLE fuelrecords ADD CONSTRAINT fuelrecords_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES trips(trip_id);
ALTER TABLE fuelrecords ADD CONSTRAINT fuelrecords_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES employees(employee_id);
ALTER TABLE fuelrecords ADD CONSTRAINT fuelrecords_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES vehicles(vehicle_id);
ALTER TABLE fuelrequests ADD CONSTRAINT fuelrequests_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES employees(employee_id);
ALTER TABLE fuelrequests ADD CONSTRAINT fuelrequests_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(driver_id);
ALTER TABLE fuelrequests ADD CONSTRAINT fuelrequests_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES trips(trip_id);
ALTER TABLE fuelrequests ADD CONSTRAINT fuelrequests_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES vehicles(vehicle_id);
ALTER TABLE gpstracking ADD CONSTRAINT gpstracking_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES trips(trip_id);
ALTER TABLE gpstracking ADD CONSTRAINT gpstracking_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES vehicles(vehicle_id);
ALTER TABLE mobile_refresh_tokens ADD CONSTRAINT mobile_refresh_tokens_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(employee_id) ON DELETE CASCADE;
ALTER TABLE notification_preferences ADD CONSTRAINT notification_preferences_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(employee_id) ON DELETE CASCADE;
ALTER TABLE notifications ADD CONSTRAINT notifications_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(employee_id);
ALTER TABLE notifications ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
ALTER TABLE recommendation_snapshots ADD CONSTRAINT recommendation_snapshots_created_by_fkey FOREIGN KEY (created_by) REFERENCES employees(employee_id);
ALTER TABLE recommendation_snapshots ADD CONSTRAINT recommendation_snapshots_designated_driver_id_fkey FOREIGN KEY (designated_driver_id) REFERENCES drivers(driver_id);
ALTER TABLE recommendation_snapshots ADD CONSTRAINT recommendation_snapshots_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(driver_id);
ALTER TABLE recommendation_snapshots ADD CONSTRAINT recommendation_snapshots_request_id_fkey FOREIGN KEY (request_id) REFERENCES transportation_requests(request_id) ON DELETE CASCADE;
ALTER TABLE recommendation_snapshots ADD CONSTRAINT recommendation_snapshots_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES vehicles(vehicle_id);
ALTER TABLE reservation_events ADD CONSTRAINT reservation_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES employees(employee_id);
ALTER TABLE reservation_events ADD CONSTRAINT reservation_events_request_id_fkey FOREIGN KEY (request_id) REFERENCES transportation_requests(request_id) ON DELETE CASCADE;
ALTER TABLE routes ADD CONSTRAINT routes_destination_location_id_fkey FOREIGN KEY (destination_location_id) REFERENCES locations(location_id);
ALTER TABLE routes ADD CONSTRAINT routes_origin_location_id_fkey FOREIGN KEY (origin_location_id) REFERENCES locations(location_id);
ALTER TABLE service_types ADD CONSTRAINT service_types_default_category_id_fkey FOREIGN KEY (default_category_id) REFERENCES vehiclecategories(category_id);
ALTER TABLE substitute_vehicle_schedules ADD CONSTRAINT substitute_vehicle_schedules_created_by_fkey FOREIGN KEY (created_by) REFERENCES employees(employee_id);
ALTER TABLE substitute_vehicle_schedules ADD CONSTRAINT substitute_vehicle_schedules_substitute_driver_id_fkey FOREIGN KEY (substitute_driver_id) REFERENCES drivers(driver_id) ON DELETE CASCADE;
ALTER TABLE substitute_vehicle_schedules ADD CONSTRAINT substitute_vehicle_schedules_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES employees(employee_id);
ALTER TABLE substitute_vehicle_schedules ADD CONSTRAINT substitute_vehicle_schedules_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES vehicles(vehicle_id) ON DELETE CASCADE;
ALTER TABLE transportation_requests ADD CONSTRAINT transportation_requests_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES employees(employee_id);
ALTER TABLE transportation_requests ADD CONSTRAINT transportation_requests_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(driver_id);
ALTER TABLE transportation_requests ADD CONSTRAINT transportation_requests_requested_category_id_fkey FOREIGN KEY (requested_category_id) REFERENCES vehiclecategories(category_id);
ALTER TABLE transportation_requests ADD CONSTRAINT transportation_requests_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES employees(employee_id);
ALTER TABLE transportation_requests ADD CONSTRAINT transportation_requests_service_type_id_fkey FOREIGN KEY (service_type_id) REFERENCES service_types(service_type_id);
ALTER TABLE transportation_requests ADD CONSTRAINT transportation_requests_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES vehicles(vehicle_id);
ALTER TABLE trips ADD CONSTRAINT trips_created_by_fkey FOREIGN KEY (created_by) REFERENCES employees(employee_id);
ALTER TABLE trips ADD CONSTRAINT trips_dispatch_id_fkey FOREIGN KEY (dispatch_id) REFERENCES dispatchschedules(dispatch_id);
ALTER TABLE trips ADD CONSTRAINT trips_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(driver_id);
ALTER TABLE trips ADD CONSTRAINT trips_route_id_fkey FOREIGN KEY (route_id) REFERENCES routes(route_id);
ALTER TABLE trips ADD CONSTRAINT trips_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES employees(employee_id);
ALTER TABLE trips ADD CONSTRAINT trips_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES vehicles(vehicle_id);
ALTER TABLE uvvrp_exemptions ADD CONSTRAINT uvvrp_exemptions_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES employees(employee_id);
ALTER TABLE uvvrp_exemptions ADD CONSTRAINT uvvrp_exemptions_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES vehicles(vehicle_id);
ALTER TABLE uvvrp_violations ADD CONSTRAINT uvvrp_violations_created_by_fkey FOREIGN KEY (created_by) REFERENCES employees(employee_id);
ALTER TABLE uvvrp_violations ADD CONSTRAINT uvvrp_violations_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES employees(employee_id);
ALTER TABLE uvvrp_violations ADD CONSTRAINT uvvrp_violations_dispatch_id_fkey FOREIGN KEY (dispatch_id) REFERENCES dispatchschedules(dispatch_id);
ALTER TABLE uvvrp_violations ADD CONSTRAINT uvvrp_violations_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES vehicles(vehicle_id);
ALTER TABLE vehicledocuments ADD CONSTRAINT vehicledocuments_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES vehicles(vehicle_id) ON DELETE CASCADE;
ALTER TABLE vehicleinspection ADD CONSTRAINT vehicleinspection_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(driver_id);
ALTER TABLE vehicleinspection ADD CONSTRAINT vehicleinspection_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES trips(trip_id);
ALTER TABLE vehicleinspection ADD CONSTRAINT vehicleinspection_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES vehicles(vehicle_id);
ALTER TABLE vehiclemaintenance ADD CONSTRAINT vehiclemaintenance_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES employees(employee_id);
ALTER TABLE vehiclemaintenance ADD CONSTRAINT vehiclemaintenance_created_by_fkey FOREIGN KEY (created_by) REFERENCES employees(employee_id);
ALTER TABLE vehiclemaintenance ADD CONSTRAINT vehiclemaintenance_source_incident_id_fkey FOREIGN KEY (source_incident_id) REFERENCES driverincidents(incident_id);
ALTER TABLE vehiclemaintenance ADD CONSTRAINT vehiclemaintenance_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES employees(employee_id);
ALTER TABLE vehiclemaintenance ADD CONSTRAINT vehiclemaintenance_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES vehicles(vehicle_id);
ALTER TABLE vehicles ADD CONSTRAINT vehicles_category_id_fkey FOREIGN KEY (category_id) REFERENCES vehiclecategories(category_id);
ALTER TABLE vehicles ADD CONSTRAINT vehicles_created_by_fkey FOREIGN KEY (created_by) REFERENCES employees(employee_id);
ALTER TABLE vehicles ADD CONSTRAINT vehicles_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES employees(employee_id);

-- ============================ INDEXES ===========================
-- Constraint-backed indexes omitted: the constraints create them.

CREATE INDEX idx_ai_reference ON public.ai_recommendations USING btree (reference_type, reference_id);
CREATE INDEX idx_ai_report_narrative_force_day ON public.ai_report_narratives USING btree (force_day);
CREATE INDEX idx_ai_type ON public.ai_recommendations USING btree (recommendation_type);
CREATE INDEX idx_attendance_date ON public.driverattendance USING btree (date);
CREATE INDEX idx_attendance_driver ON public.driverattendance USING btree (driver_id);
CREATE UNIQUE INDEX idx_attendance_driver_date ON public.driverattendance USING btree (driver_id, date);
CREATE INDEX idx_attendance_status ON public.driverattendance USING btree (status);
CREATE INDEX idx_audit_created ON public.audit_logs USING btree (created_at);
CREATE INDEX idx_audit_employee ON public.audit_logs USING btree (employee_id);
CREATE INDEX idx_audit_resource ON public.audit_logs USING btree (resource, resource_id);
CREATE INDEX idx_device_tokens_employee_active ON public.device_tokens USING btree (employee_id) WHERE active;
CREATE INDEX idx_dispatch_active_departure ON public.dispatchschedules USING btree (scheduled_departure) WHERE (deleted_at IS NULL);
CREATE INDEX idx_dispatch_date ON public.dispatchschedules USING btree (scheduled_departure);
CREATE INDEX idx_dispatch_driver ON public.dispatchschedules USING btree (driver_id);
CREATE INDEX idx_dispatch_request ON public.dispatchschedules USING btree (request_id);
CREATE INDEX idx_dispatch_status ON public.dispatchschedules USING btree (status);
CREATE INDEX idx_dispatch_vehicle ON public.dispatchschedules USING btree (vehicle_id);
CREATE INDEX idx_dispatchschedules_request_id ON public.dispatchschedules USING btree (request_id);
CREATE INDEX idx_driver_consents_driver ON public.driver_consents USING btree (driver_id, accepted_at DESC);
CREATE INDEX idx_driverincidents_driver ON public.driverincidents USING btree (driver_id, created_at DESC);
CREATE INDEX idx_driverincidents_status ON public.driverincidents USING btree (status, incident_date DESC);
CREATE INDEX idx_drivers_employee ON public.drivers USING btree (employee_id);
CREATE INDEX idx_drivers_face ON public.drivers USING btree (face_image_url);
CREATE INDEX idx_drivers_status ON public.drivers USING btree (driver_status);
CREATE INDEX idx_dva_driver_history ON public.driver_vehicle_assignments USING btree (driver_id, assigned_from DESC);
CREATE INDEX idx_dva_vehicle_history ON public.driver_vehicle_assignments USING btree (vehicle_id, assigned_from DESC);
CREATE INDEX idx_dws_driver ON public.driver_work_schedules USING btree (driver_id);
CREATE INDEX idx_employees_email ON public.employees USING btree (email);
CREATE INDEX idx_employees_role ON public.employees USING btree (role_id);
CREATE INDEX idx_employees_status ON public.employees USING btree (status);
CREATE INDEX idx_fuel_date ON public.fuelrecords USING btree (fuel_date);
CREATE INDEX idx_fuel_vehicle ON public.fuelrecords USING btree (vehicle_id);
CREATE INDEX idx_fuelallocations_month ON public.fuelallocations USING btree (allocation_month, vehicle_id);
CREATE INDEX idx_fuelrecords_analytics ON public.fuelrecords USING btree (vehicle_id, fuel_date, status) WHERE (deleted_at IS NULL);
CREATE INDEX idx_fuelrecords_receipt_txn ON public.fuelrecords USING btree (receipt_transaction_id) WHERE ((receipt_transaction_id IS NOT NULL) AND (deleted_at IS NULL));
CREATE INDEX idx_fuelrequests_allocation_month ON public.fuelrequests USING btree (allocation_month, vehicle_id);
CREATE INDEX idx_fuelrequests_driver_created ON public.fuelrequests USING btree (driver_id, created_at DESC);
CREATE INDEX idx_fuelrequests_status_created ON public.fuelrequests USING btree (status, created_at DESC);
CREATE INDEX idx_integration_event ON public.integration_log USING btree (event_type);
CREATE INDEX idx_integration_external ON public.integration_log USING btree (external_booking_id);
CREATE INDEX idx_integration_status ON public.integration_log USING btree (status);
CREATE INDEX idx_leave_balances_driver ON public.driver_leave_balances USING btree (driver_id);
CREATE INDEX idx_leave_driver ON public.driver_leave_requests USING btree (driver_id, start_date DESC);
CREATE INDEX idx_leave_status ON public.driver_leave_requests USING btree (status);
CREATE INDEX idx_locations_active_name ON public.locations USING btree (is_active, name);
CREATE INDEX idx_locations_name ON public.locations USING btree (name);
CREATE INDEX idx_maintenance_date ON public.vehiclemaintenance USING btree (maintenance_date);
CREATE INDEX idx_maintenance_status ON public.vehiclemaintenance USING btree (status);
CREATE INDEX idx_maintenance_vehicle ON public.vehiclemaintenance USING btree (vehicle_id);
CREATE INDEX idx_mobile_refresh_tokens_employee ON public.mobile_refresh_tokens USING btree (employee_id);
CREATE INDEX idx_notification_preferences_employee ON public.notification_preferences USING btree (employee_id);
CREATE INDEX idx_notifications_read ON public.notifications USING btree (is_read);
CREATE INDEX idx_notifications_sent ON public.notifications USING btree (sent_at);
CREATE INDEX idx_notifications_user ON public.notifications USING btree (employee_id);
CREATE INDEX idx_push_outbox_employee ON public.push_outbox USING btree (employee_id, status);
CREATE INDEX idx_push_outbox_pending ON public.push_outbox USING btree (status, id) WHERE (status = 'pending'::text);
CREATE INDEX idx_rec_snapshots_request ON public.recommendation_snapshots USING btree (request_id, generated_at DESC);
CREATE INDEX idx_rec_snapshots_validity ON public.recommendation_snapshots USING btree (valid_until) WHERE (is_consumed = false);
CREATE INDEX idx_reservation_events_request_timeline ON public.reservation_events USING btree (request_id, occurred_at DESC);
CREATE INDEX idx_routes_dest_loc ON public.routes USING btree (destination_location_id);
CREATE INDEX idx_routes_name ON public.routes USING btree (route_name);
CREATE INDEX idx_routes_origin_loc ON public.routes USING btree (origin_location_id);
CREATE INDEX idx_sub_driver ON public.substitute_vehicle_schedules USING btree (substitute_driver_id, effective_from DESC);
CREATE INDEX idx_sub_vehicle_history ON public.substitute_vehicle_schedules USING btree (vehicle_id, effective_from DESC);
CREATE INDEX idx_sub_vehicle_range ON public.substitute_vehicle_schedules USING btree (vehicle_id, effective_from, effective_until);
CREATE INDEX idx_tracking_time ON public.gpstracking USING btree (recorded_at);
CREATE INDEX idx_tracking_trip ON public.gpstracking USING btree (trip_id);
CREATE INDEX idx_tracking_vehicle ON public.gpstracking USING btree (vehicle_id);
CREATE INDEX idx_transport_requests_category ON public.transportation_requests USING btree (requested_category_id);
CREATE INDEX idx_transport_requests_derived_priority ON public.transportation_requests USING btree (derived_priority);
CREATE INDEX idx_transport_requests_driver ON public.transportation_requests USING btree (driver_id);
CREATE INDEX idx_transport_requests_external ON public.transportation_requests USING btree (external_booking_id);
CREATE INDEX idx_transport_requests_flags ON public.transportation_requests USING btree (is_vip, is_emergency);
CREATE INDEX idx_transport_requests_fleet_status ON public.transportation_requests USING btree (fleet_status);
CREATE INDEX idx_transport_requests_pickup ON public.transportation_requests USING btree (pickup_datetime);
CREATE INDEX idx_transport_requests_reservation_number ON public.transportation_requests USING btree (reservation_number);
CREATE INDEX idx_transport_requests_vehicle ON public.transportation_requests USING btree (vehicle_id);
CREATE INDEX idx_trips_analytics ON public.trips USING btree (vehicle_id, start_time, trip_status) WHERE (deleted_at IS NULL);
CREATE INDEX idx_trips_created_at ON public.trips USING btree (deleted_at, created_at DESC);
CREATE INDEX idx_trips_date ON public.trips USING btree (start_time);
CREATE INDEX idx_trips_driver ON public.trips USING btree (driver_id);
CREATE INDEX idx_trips_driver_start ON public.trips USING btree (driver_id, start_time);
CREATE INDEX idx_trips_on_time ON public.trips USING btree (on_time_completion);
CREATE INDEX idx_trips_rating ON public.trips USING btree (customer_rating);
CREATE INDEX idx_trips_status ON public.trips USING btree (trip_status);
CREATE INDEX idx_trips_vehicle ON public.trips USING btree (vehicle_id);
CREATE INDEX idx_trips_vehicle_start ON public.trips USING btree (vehicle_id, start_time);
CREATE INDEX idx_uvvrp_exemptions_active ON public.uvvrp_exemptions USING btree (active);
CREATE INDEX idx_uvvrp_exemptions_vehicle ON public.uvvrp_exemptions USING btree (vehicle_id) WHERE active;
CREATE INDEX idx_uvvrp_violations_action ON public.uvvrp_violations USING btree (action, created_at DESC);
CREATE INDEX idx_uvvrp_violations_vehicle ON public.uvvrp_violations USING btree (vehicle_id, scheduled_departure);
CREATE INDEX idx_vehicledocuments_expiry ON public.vehicledocuments USING btree (expiry_date);
CREATE INDEX idx_vehicledocuments_type ON public.vehicledocuments USING btree (document_type);
CREATE INDEX idx_vehicledocuments_vehicle ON public.vehicledocuments USING btree (vehicle_id);
CREATE INDEX idx_vehicleinspection_trip ON public.vehicleinspection USING btree (trip_id, inspection_date DESC, created_at DESC);
CREATE INDEX idx_vehicleinspection_vehicle_date ON public.vehicleinspection USING btree (vehicle_id, inspection_date DESC, created_at DESC);
CREATE INDEX idx_vehiclemaintenance_source_incident ON public.vehiclemaintenance USING btree (source_incident_id) WHERE (source_incident_id IS NOT NULL);
CREATE INDEX idx_vehicles_category ON public.vehicles USING btree (category_id);
CREATE INDEX idx_vehicles_plate ON public.vehicles USING btree (plate_number);
CREATE INDEX idx_vehicles_status ON public.vehicles USING btree (vehicle_status);
CREATE UNIQUE INDEX uq_ai_report_narrative_key ON public.ai_report_narratives USING btree (report, COALESCE(range_from, '*'::character varying), COALESCE(range_to, '*'::character varying));
CREATE UNIQUE INDEX uq_driverincidents_driver_submission ON public.driverincidents USING btree (driver_id, client_submission_id) WHERE ((deleted_at IS NULL) AND (client_submission_id IS NOT NULL));
CREATE UNIQUE INDEX uq_dva_active_driver ON public.driver_vehicle_assignments USING btree (driver_id) WHERE (assigned_until IS NULL);
CREATE UNIQUE INDEX uq_dva_active_vehicle ON public.driver_vehicle_assignments USING btree (vehicle_id) WHERE (assigned_until IS NULL);
CREATE UNIQUE INDEX uq_dws_driver_day ON public.driver_work_schedules USING btree (driver_id, day_of_week);
CREATE UNIQUE INDEX uq_fuelrecords_driver_submission ON public.fuelrecords USING btree (driver_id, client_submission_id) WHERE ((deleted_at IS NULL) AND (client_submission_id IS NOT NULL));
CREATE UNIQUE INDEX uq_fuelrecords_fuel_request ON public.fuelrecords USING btree (fuel_request_id) WHERE (fuel_request_id IS NOT NULL);
CREATE UNIQUE INDEX uq_fuelrequests_driver_submission ON public.fuelrequests USING btree (driver_id, client_submission_id) WHERE (client_submission_id IS NOT NULL);
CREATE UNIQUE INDEX uq_fuelrequests_open_vehicle ON public.fuelrequests USING btree (vehicle_id) WHERE ((status)::text = ANY ((ARRAY['Pending'::character varying, 'Approved'::character varying])::text[]));
CREATE UNIQUE INDEX uq_rec_snapshot_active ON public.recommendation_snapshots USING btree (request_id) WHERE (is_consumed = false);
CREATE UNIQUE INDEX uq_routes_active_direction ON public.routes USING btree (origin_location_id, destination_location_id) WHERE (((status)::text = 'Active'::text) AND (deleted_at IS NULL) AND (origin_location_id IS NOT NULL) AND (destination_location_id IS NOT NULL));
CREATE UNIQUE INDEX uq_sub_open_vehicle ON public.substitute_vehicle_schedules USING btree (vehicle_id) WHERE (effective_until IS NULL);
CREATE UNIQUE INDEX uq_vehicleinspection_driver_submission ON public.vehicleinspection USING btree (driver_id, client_submission_id) WHERE (client_submission_id IS NOT NULL);

-- ============================= VIEWS ============================

CREATE OR REPLACE VIEW driver_stats AS
SELECT d.driver_id,
    count(DISTINCT t.trip_id) AS total_trips,
    COALESCE(sum(t.distance), (0)::numeric) AS total_distance,
    COALESCE(sum((EXTRACT(epoch FROM (COALESCE(t.end_time, now()) - t.start_time)) / (3600)::numeric)), (0)::numeric) AS total_hours,
    COALESCE(avg(t.customer_rating), (0)::numeric) AS rating,
    COALESCE(avg(t.smooth_driving_score), (0)::numeric) AS performance_score
   FROM (drivers d
     LEFT JOIN trips t ON (((d.driver_id = t.driver_id) AND ((t.trip_status)::text = 'Completed'::text) AND (t.deleted_at IS NULL))))
  GROUP BY d.driver_id;

-- =========================== FUNCTIONS ==========================

CREATE OR REPLACE FUNCTION public.calculate_trip_cost(trip_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  total DECIMAL(10,2);
BEGIN
  SELECT COALESCE(fuel_cost, 0) + COALESCE(maintenance_cost, 0) + COALESCE(toll_fee, 0) + COALESCE(driver_cost, 0)
  INTO total
  FROM trip_cost_analysis
  WHERE trip_cost_analysis.trip_id = calculate_trip_cost.trip_id;
  RETURN total;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.enqueue_dispatch_push()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO push_outbox (employee_id, title, body, channel_id, reference_type, reference_id)
  SELECT
    d.employee_id,
    'Dispatch Assigned',
    'You have been assigned to dispatch ' || NEW.dispatch_number || '.',
    'default',
    'dispatch',
    NEW.dispatch_id
  FROM drivers dr
  JOIN employees d ON dr.employee_id = d.employee_id
  WHERE dr.driver_id = NEW.driver_id;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_dispatch_number()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  chars TEXT := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  suffix TEXT;
  attempt INT;
  ln INT;
BEGIN
  ln := length(chars);
  FOR attempt IN 1..50 LOOP
    suffix := '';
    FOR i IN 1..4 LOOP
      suffix := suffix || substr(chars, 1 + floor(random() * ln)::int, 1);
    END LOOP;
    NEW.dispatch_number := 'DSP-' || suffix;
    -- Collide with an existing row? Re-roll. The UNIQUE constraint is the
    -- final arbiter; this loop just short-circuits the common case.
    IF NOT EXISTS (SELECT 1 FROM dispatchschedules WHERE dispatch_number = NEW.dispatch_number) THEN
      RETURN NEW;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_current_employee_role()
 RETURNS character varying
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  user_role VARCHAR(100);
BEGIN
  SELECT r.role_name INTO user_role
  FROM employees e
  JOIN roles r ON e.role_id = r.role_id
  WHERE e.user_id = auth.uid()
  LIMIT 1;
  RETURN user_role;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_latest_vehicle_positions()
 RETURNS TABLE(vehicle_id uuid, lat numeric, lng numeric, speed numeric, heading numeric, recorded_at timestamp with time zone, plate_number character varying, vehicle_name character varying, vehicle_status character varying, driver_name text, driver_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT DISTINCT ON (v.vehicle_id)
    v.vehicle_id,
    gl.lat,
    gl.lng,
    gl.speed,
    gl.heading,
    gl.recorded_at,
    v.plate_number,
    v.vehicle_name,
    v.vehicle_status,
    CONCAT(e.first_name, ' ', e.last_name) AS driver_name,
    d.driver_id
  FROM vehicles v
  LEFT JOIN LATERAL (
    SELECT * FROM gps_locations
    WHERE vehicle_id = v.vehicle_id
    ORDER BY recorded_at DESC
    LIMIT 1
  ) gl ON true
  LEFT JOIN vehicle_assignment va ON va.vehicle_id = v.vehicle_id AND va.status = 'active'
  LEFT JOIN drivers d ON d.driver_id = va.driver_id
  LEFT JOIN employees e ON e.employee_id = d.employee_id
  WHERE v.deleted_at IS NULL
  ORDER BY v.vehicle_id, gl.recorded_at DESC;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.guard_dispatch_overlap()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  other_id   INTEGER;
  eff_arrival TIMESTAMPTZ;
  excl       TEXT;
BEGIN
  IF NEW.status NOT IN ('Scheduled', 'In Progress') OR NEW.scheduled_departure IS NULL THEN
    RETURN NEW;
  END IF;

  eff_arrival := COALESCE(NEW.scheduled_arrival, NEW.scheduled_departure);
  -- On UPDATE the row being edited already exists; exclude it from the scan.
  excl := CASE WHEN TG_OP = 'UPDATE' THEN 'AND dispatch_id <> ' || OLD.dispatch_id ELSE '' END;

  IF NEW.vehicle_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('dispatch_veh_' || NEW.vehicle_id));
    EXECUTE
      'SELECT dispatch_id FROM dispatchschedules
         WHERE deleted_at IS NULL
           AND status IN (''Scheduled'', ''In Progress'')
           AND vehicle_id = $1
           ' || excl || '
           AND scheduled_departure < $2
           AND COALESCE(scheduled_arrival, scheduled_departure) > $3
         LIMIT 1'
      INTO other_id USING NEW.vehicle_id, eff_arrival, NEW.scheduled_departure;
    IF other_id IS NOT NULL THEN
      RAISE EXCEPTION 'Vehicle % is already dispatched (#%) in this time window', NEW.vehicle_id, other_id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NEW.driver_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('dispatch_drv_' || NEW.driver_id));
    EXECUTE
      'SELECT dispatch_id FROM dispatchschedules
         WHERE deleted_at IS NULL
           AND status IN (''Scheduled'', ''In Progress'')
           AND driver_id = $1
           ' || excl || '
           AND scheduled_departure < $2
           AND COALESCE(scheduled_arrival, scheduled_departure) > $3
         LIMIT 1'
      INTO other_id USING NEW.driver_id, eff_arrival, NEW.scheduled_departure;
    IF other_id IS NOT NULL THEN
      RAISE EXCEPTION 'Driver % is already dispatched (#%) in this time window', NEW.driver_id, other_id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.has_role(required_roles text[])
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  user_role VARCHAR(100);
BEGIN
  user_role := get_current_employee_role();
  RETURN user_role = ANY(required_roles);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_dispatch_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
  SELECT
    d.employee_id,
    'Dispatch Assigned',
    'You have been assigned to dispatch ' || NEW.dispatch_number || '.',
    'Alert',
    'dispatch',
    NEW.dispatch_id
  FROM drivers dr
  JOIN employees d ON dr.employee_id = d.employee_id
  WHERE dr.driver_id = NEW.driver_id;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_document_expiry()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF NEW.expiry_date <= CURRENT_DATE + INTERVAL '30 days' AND NEW.expiry_date > CURRENT_DATE THEN
    INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
    SELECT
      e.employee_id,
      'Document Expiring Soon',
      NEW.document_type || ' for vehicle #' || NEW.vehicle_id || ' expires on ' || NEW.expiry_date,
      'Warning',
      'document',
      NEW.document_id
    FROM employees e
    WHERE e.role_id IN (SELECT role_id FROM roles WHERE role_name IN ('fleet_manager', 'admin'));
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_leave_requested()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
  SELECT
    e.employee_id,
    'New Leave Request',
    'A driver has requested ' || NEW.leave_type || ' from ' || NEW.start_date || ' to ' || NEW.end_date || '.',
    'Info',
    'leave_request',
    NEW.leave_request_id
  FROM employees e
  WHERE e.role_id IN (SELECT role_id FROM roles WHERE role_name IN ('fleet_manager', 'admin'));

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_leave_reviewed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF (NEW.status = 'Approved' OR NEW.status = 'Declined') AND OLD.status = 'Pending' THEN
    INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
    SELECT
      d.employee_id,
      'Leave Request ' || NEW.status,
      'Your leave request from ' || NEW.start_date || ' to ' || NEW.end_date || ' was ' || LOWER(NEW.status) || '.',
      CASE WHEN NEW.status = 'Approved' THEN 'Success' ELSE 'Warning' END,
      'leave_request',
      NEW.leave_request_id
    FROM drivers d
    WHERE d.driver_id = NEW.driver_id;
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_maintenance_due()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF NEW.maintenance_date <= CURRENT_DATE + INTERVAL '7 days' AND (OLD IS NULL OR OLD.maintenance_date > CURRENT_DATE + INTERVAL '7 days') THEN
    INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
    SELECT
      e.employee_id,
      'Maintenance Due Soon',
      'Vehicle maintenance is scheduled for ' || NEW.maintenance_date || '. Type: ' || NEW.maintenance_type,
      'Warning',
      'maintenance',
      NEW.maintenance_id
    FROM employees e
    WHERE e.role_id IN (SELECT role_id FROM roles WHERE role_name IN ('fleet_manager', 'admin'));
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_trip_completed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF NEW.trip_status = 'Completed' AND OLD.trip_status != 'Completed' THEN
    INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
    VALUES (
      (SELECT created_by FROM dispatchschedules WHERE dispatch_id = NEW.dispatch_id),
      'Trip Completed',
      'Trip #' || NEW.trip_id || ' has been completed. Distance: ' || ROUND(NEW.distance::numeric, 1) || ' km',
      'Success',
      'trip',
      NEW.trip_id
    );
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$
;

-- =========================== TRIGGERS ===========================

CREATE TRIGGER trg_dispatch_number BEFORE INSERT ON public.dispatchschedules FOR EACH ROW WHEN ((new.dispatch_number IS NULL)) EXECUTE FUNCTION generate_dispatch_number();
CREATE TRIGGER trg_dispatch_overlap BEFORE INSERT OR UPDATE OF vehicle_id, driver_id, scheduled_departure, scheduled_arrival, status ON public.dispatchschedules FOR EACH ROW EXECUTE FUNCTION guard_dispatch_overlap();
CREATE TRIGGER trigger_enqueue_dispatch_push AFTER INSERT ON public.dispatchschedules FOR EACH ROW EXECUTE FUNCTION enqueue_dispatch_push();
CREATE TRIGGER trigger_notify_dispatch_created AFTER INSERT ON public.dispatchschedules FOR EACH ROW EXECUTE FUNCTION notify_dispatch_created();
CREATE TRIGGER trigger_notify_document_expiry AFTER INSERT OR UPDATE ON public.vehicledocuments FOR EACH ROW EXECUTE FUNCTION notify_document_expiry();
CREATE TRIGGER trigger_notify_leave_requested AFTER INSERT ON public.driver_leave_requests FOR EACH ROW EXECUTE FUNCTION notify_leave_requested();
CREATE TRIGGER trigger_notify_leave_reviewed AFTER UPDATE ON public.driver_leave_requests FOR EACH ROW WHEN (((((new.status)::text = 'Approved'::text) OR ((new.status)::text = 'Declined'::text)) AND ((old.status)::text = 'Pending'::text))) EXECUTE FUNCTION notify_leave_reviewed();
CREATE TRIGGER trigger_notify_maintenance_due AFTER INSERT OR UPDATE ON public.vehiclemaintenance FOR EACH ROW EXECUTE FUNCTION notify_maintenance_due();
CREATE TRIGGER trigger_notify_trip_completed AFTER UPDATE ON public.trips FOR EACH ROW WHEN ((((new.trip_status)::text = 'Completed'::text) AND ((old.trip_status)::text <> 'Completed'::text))) EXECUTE FUNCTION notify_trip_completed();
CREATE TRIGGER update_dispatch_updated_at BEFORE UPDATE ON public.dispatchschedules FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_driverattendance_updated_at BEFORE UPDATE ON public.driverattendance FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_drivers_updated_at BEFORE UPDATE ON public.drivers FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_employees_updated_at BEFORE UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_maintenance_updated_at BEFORE UPDATE ON public.vehiclemaintenance FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_routes_updated_at BEFORE UPDATE ON public.routes FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_service_types_updated_at BEFORE UPDATE ON public.service_types FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_transportation_requests_updated_at BEFORE UPDATE ON public.transportation_requests FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_trips_updated_at BEFORE UPDATE ON public.trips FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_vehicles_updated_at BEFORE UPDATE ON public.vehicles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
