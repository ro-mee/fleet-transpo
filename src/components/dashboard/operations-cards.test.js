import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DocumentComplianceCard,
  DocumentDonutChart,
  FleetReadinessCard,
  FulfillmentPerformanceCard,
  IncidentRiskCard,
  MaintenancePressureCard,
  RecentDispatcherActivity,
  RequestPipelineCard,
  calculateComplianceMetrics,
  calculateJourneyMetrics,
  formatRelativeTime,
  getRecentDispatchActivities,
} from "@/components/dashboard/operations-cards";

describe("operations-cards", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("formatRelativeTime", () => {
    it("handles null or undefined safely", () => {
      expect(formatRelativeTime(null)).toBe("Recently");
      expect(formatRelativeTime(undefined)).toBe("Recently");
      expect(formatRelativeTime("invalid-date")).toBe("Recently");
    });

    it("formats recent seconds as Just now", () => {
      const now = new Date();
      expect(formatRelativeTime(now.toISOString())).toBe("Just now");
    });

    it("formats minutes correctly", () => {
      const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000);
      expect(formatRelativeTime(fiveMinsAgo.toISOString())).toBe("5 mins ago");

      const oneMinAgo = new Date(Date.now() - 65 * 1000);
      expect(formatRelativeTime(oneMinAgo.toISOString())).toBe("1 min ago");
    });

    it("formats hours correctly", () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      expect(formatRelativeTime(twoHoursAgo.toISOString())).toBe("2 hours ago");

      const oneHourAgo = new Date(Date.now() - 65 * 60 * 1000);
      expect(formatRelativeTime(oneHourAgo.toISOString())).toBe("1 hour ago");
    });

    it("formats days correctly", () => {
      const oneDayAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
      expect(formatRelativeTime(oneDayAgo.toISOString())).toBe("1 day ago");

      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      expect(formatRelativeTime(threeDaysAgo.toISOString())).toBe("3 days ago");
    });
  });

  describe("component exports", () => {
    it("exports all 5 core operations cards and sub-cards as functions", () => {
      expect(typeof RequestPipelineCard).toBe("function");
      expect(typeof DocumentComplianceCard).toBe("function");
      expect(typeof FleetReadinessCard).toBe("function");
      expect(typeof MaintenancePressureCard).toBe("function");
      expect(typeof IncidentRiskCard).toBe("function");
      expect(typeof FulfillmentPerformanceCard).toBe("function");
      expect(typeof RecentDispatcherActivity).toBe("function");
    });
  });

  describe("calculateJourneyMetrics", () => {
    it("handles empty requests array safely without division by zero", () => {
      const metrics = calculateJourneyMetrics([]);
      expect(metrics.totalRequests).toBe(0);
      expect(metrics.pendingDisplay).toBe(0);
      expect(metrics.assigned).toBe(0);
      expect(metrics.inProgress).toBe(0);
      expect(metrics.completed).toBe(0);
      expect(metrics.cancelled).toBe(0);
      expect(metrics.assignedConversion).toBe(0);
      expect(metrics.inProgressConversion).toBe(0);
      expect(metrics.completedConversion).toBe(0);
      expect(metrics.cancelledConversion).toBe(0);
      expect(metrics.shares.pending).toBe("0.0");
    });

    it("aggregates Scheduled requests into pendingDisplay without creating separate stage", () => {
      const sample = [
        { fleet_status: "Pending" },
        { fleet_status: "Pending" },
        { fleet_status: "Scheduled" },
        { fleet_status: "Assigned" },
      ];
      const metrics = calculateJourneyMetrics(sample);
      expect(metrics.totalRequests).toBe(4);
      expect(metrics.counts["Pending"]).toBe(2);
      expect(metrics.counts["Scheduled"]).toBe(1);
      // Scheduled is included in pendingDisplay
      expect(metrics.pendingDisplay).toBe(3);
      expect(metrics.assigned).toBe(1);
    });

    it("calculates stage-to-stage conversions and shares correctly", () => {
      // Create a test dataset reflecting real counts
      const requests = [
        ...Array(100).fill({ fleet_status: "Pending" }),
        ...Array(28).fill({ fleet_status: "Scheduled" }), // pendingDisplay = 128
        ...Array(68).fill({ fleet_status: "Assigned" }),
        ...Array(54).fill({ fleet_status: "In Progress" }),
        ...Array(50).fill({ fleet_status: "Completed" }),
        ...Array(14).fill({ fleet_status: "Cancelled" }),
      ];
      const metrics = calculateJourneyMetrics(requests);

      expect(metrics.totalRequests).toBe(100 + 28 + 68 + 54 + 50 + 14); // 314
      expect(metrics.pendingDisplay).toBe(128);
      expect(metrics.assigned).toBe(68);
      expect(metrics.inProgress).toBe(54);
      expect(metrics.completed).toBe(50);
      expect(metrics.cancelled).toBe(14);

      // Conversion: 68 / 128 = 53.125% -> 53%
      expect(metrics.assignedConversion).toBe(53);
      // Conversion: 54 / 68 = 79.41% -> 79%
      expect(metrics.inProgressConversion).toBe(79);
      // Conversion: 50 / 54 = 92.59% -> 93%
      expect(metrics.completedConversion).toBe(93);
    });
  });

  describe("RequestPipelineCard rendering", () => {
    it("renders the Request Journey flow with exact required footers and no prohibited wording", () => {
      const requests = [
        { fleet_status: "Pending" },
        { fleet_status: "Scheduled" },
        { fleet_status: "Assigned" },
        { fleet_status: "In Progress" },
        { fleet_status: "Completed" },
        { fleet_status: "Cancelled" },
      ];

      const html = renderToStaticMarkup(
        React.createElement(RequestPipelineCard, { requests })
      );

      // Header and controls
      expect(html).toContain("Request Journey");
      expect(html).toContain("total requests from intake to completion");
      expect(html).toContain("Volume");
      expect(html).toContain("Conversion %");

      // Stages
      expect(html).toContain("Pending");
      expect(html).toContain("Assigned");
      expect(html).toContain("In Progress");
      expect(html).toContain("Completed");
      expect(html).toContain("Cancelled");

      // MANDATORY footers
      expect(html).toContain("Needs assignment");
      expect(html).toContain("Driver + vehicle secured");
      expect(html).toContain("On the move");
      expect(html).toContain("Arrived successfully");
      expect(html).toContain("Request withdrawn");

      // FORBIDDEN wording
      expect(html).not.toContain("Delivered successfully");
      expect(html).not.toContain("Unassigned");

      // Explanatory callout note
      expect(html).toContain(
        "Some requests are cancelled due to changes in demand, customer requests, or operational constraints."
      );

      // Explanatory callout note
      expect(html).toContain(
        "Some requests are cancelled due to changes in demand, customer requests, or operational constraints."
      );

      // Fulfillment SLA Performance card in Row 2
      expect(html).toContain("Fulfillment &amp; SLA");
      expect(html).toContain("Service reliability");
      expect(html).toContain("Optimal fulfillment");
    });

    it("renders both desktop grid and mobile/tablet vertical stepper containers for responsive adaptation", () => {
      const requests = [
        { fleet_status: "Pending" },
        { fleet_status: "Assigned" },
        { fleet_status: "In Progress" },
        { fleet_status: "Completed" },
        { fleet_status: "Cancelled" },
      ];

      const html = renderToStaticMarkup(
        React.createElement(RequestPipelineCard, { requests })
      );

      // Desktop grid container
      expect(html).toContain("hidden lg:block");
      expect(html).toContain("grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]");

      // Mobile/Tablet vertical phase rail stepper container
      expect(html).toContain("block lg:hidden");
      expect(html).toContain("Exception Branch");
      expect(html).toContain("↓");

      // Verify no horizontal overflow min-w forced container
      expect(html).not.toContain("min-w-[1520px]");
      expect(html).not.toContain("w-[1080px]");
    });

    it("renders loading and error states properly", () => {
      const loadingHtml = renderToStaticMarkup(
        React.createElement(RequestPipelineCard, {
          query: { isLoading: true },
        })
      );
      expect(loadingHtml).toContain("animate-pulse");

      const errorHtml = renderToStaticMarkup(
        React.createElement(RequestPipelineCard, {
          query: { isError: true, data: null },
          requests: [],
        })
      );
      expect(errorHtml).toContain("Request pipeline is unavailable.");
    });
  });

  describe("calculateComplianceMetrics", () => {
    it("handles empty document data safely without division by zero", () => {
      const metrics = calculateComplianceMetrics();
      expect(metrics.docTracked).toBe(0);
      expect(metrics.docValid).toBe(0);
      expect(metrics.docExpired).toBe(0);
      expect(metrics.docExpiring30).toBe(0);
      expect(metrics.docExpiring90).toBe(0);
      expect(metrics.validPercent).toBe(100);
      expect(metrics.expiredPercent).toBe(0);
      expect(metrics.due30Percent).toBe(0);
      expect(metrics.due90Percent).toBe(0);
      expect(metrics.urgentDocs).toEqual([]);
    });

    it("correctly computes percentages and metrics matching mockup example (37 total, 30 valid, 4 expired, 3 due 30d)", () => {
      const sample = {
        totals: {
          total: 37,
          expired: 4,
          expiring30: 3,
          expiring90: 0,
        },
        items: [
          { vehicle: "Rome Lorente", document_type: "Driver License", days_left: -5 },
          { vehicle: "Joseph Lims", document_type: "Driver License", days_left: -2 },
          { vehicle: "ABC 1454", document_type: "Insurance", days_left: -1 },
          { vehicle: "XYZ 9876", document_type: "Registration", days_left: -10 },
          { vehicle: "Fleet Van 1", document_type: "Oil Inspection", days_left: 5 },
          { vehicle: "Fleet Van 2", document_type: "Permit", days_left: 12 },
          { vehicle: "Fleet Truck", document_type: "Safety Cert", days_left: 28 },
          { vehicle: "Safe Vehicle", document_type: "Registration", days_left: 150 },
        ],
      };

      const metrics = calculateComplianceMetrics(sample);
      expect(metrics.docTracked).toBe(37);
      expect(metrics.docValid).toBe(30);
      expect(metrics.docExpired).toBe(4);
      expect(metrics.docExpiring30).toBe(3);
      expect(metrics.docExpiring90).toBe(0);

      // 30 / 37 = 81.08% -> 81%
      expect(metrics.validPercent).toBe(81);
      // 4 / 37 = 10.81% -> 11%
      expect(metrics.expiredPercent).toBe(11);
      // 3 / 37 = 8.11% -> 8%
      expect(metrics.due30Percent).toBe(8);
      // 0 / 37 = 0%
      expect(metrics.due90Percent).toBe(0);

      // Urgent docs: days_left <= 30, sorted ascending
      expect(metrics.urgentDocs.length).toBe(7);
      expect(metrics.urgentDocs[0].days_left).toBe(-10);
      expect(metrics.urgentDocs[1].days_left).toBe(-5);
      expect(metrics.urgentDocs[2].days_left).toBe(-2);
      expect(metrics.urgentDocs[3].days_left).toBe(-1);
      expect(metrics.urgentDocs[4].days_left).toBe(5);
      expect(metrics.urgentDocs[5].days_left).toBe(12);
      expect(metrics.urgentDocs[6].days_left).toBe(28);
    });
  });

  describe("DocumentDonutChart", () => {
    it("renders empty circle track when total is 0", () => {
      const html = renderToStaticMarkup(
        React.createElement(DocumentDonutChart, {
          total: 0,
          valid: 0,
          expired: 0,
          expiring30: 0,
          expiring90: 0,
        })
      );
      expect(html).toContain("Total documents");
      expect(html).toContain("<svg");
      expect(html).toContain('r="72"');
    });

    it("renders colored segment strokes when total > 0", () => {
      const html = renderToStaticMarkup(
        React.createElement(DocumentDonutChart, {
          total: 37,
          valid: 30,
          expired: 4,
          expiring30: 3,
          expiring90: 0,
        })
      );
      expect(html).toContain("37");
      expect(html).toContain("Total documents");
      // Emerald green
      expect(html).toContain("#00b074");
      // Rose red
      expect(html).toContain("#f43f5e");
      // Amber gold
      expect(html).toContain("#f59e0b");
      // stroke-dasharray and dashoffset
      expect(html).toContain("stroke-dasharray");
      expect(html).toContain("stroke-dashoffset");
    });
  });

  describe("DocumentComplianceCard rendering", () => {
    it("renders full 3-zone layout with correct counts, percentages, and expiring soon items", () => {
      const documents = {
        totals: {
          total: 37,
          expired: 4,
          expiring30: 3,
          expiring90: 0,
        },
        items: [
          { vehicle: "Rome Lorente", document_type: "Driver License", days_left: -1 },
          { vehicle: "Joseph Lims", document_type: "Driver License", days_left: -2 },
          { vehicle: "ABC 1454", document_type: "Insurance", days_left: -3 },
          { vehicle: "Extra Doc 1", document_type: "Permit", days_left: 2 },
          { vehicle: "Extra Doc 2", document_type: "Inspection", days_left: 5 },
          { vehicle: "Extra Doc 3", document_type: "Safety", days_left: 10 },
          { vehicle: "Extra Doc 4", document_type: "Emission", days_left: 20 },
        ],
      };

      const html = renderToStaticMarkup(
        React.createElement(DocumentComplianceCard, { documents })
      );

      // Header
      expect(html).toContain("Document compliance");
      expect(html).toContain("Expired and upcoming expiries across tracked documents.");
      expect(html).toContain("View compliance register");
      expect(html).toContain('href="/fleet/documents"');

      // Left summary card
      expect(html).toContain("81%");
      expect(html).toContain("documents valid");
      expect(html).toContain("30 of 37 documents");

      // Donut Chart center
      expect(html).toContain("37");
      expect(html).toContain("Total documents");

      // 4 Stat Cards
      expect(html).toContain("Expired");
      expect(html).toContain("4");
      expect(html).toContain("11%");

      expect(html).toContain("Due ≤30d");
      expect(html).toContain("3");
      expect(html).toContain("8%");

      expect(html).toContain("Due 31–90d");
      expect(html).toContain("0");
      expect(html).toContain("0%");

      expect(html).toContain("Valid");
      expect(html).toContain("30");
      // 81% is present

      // Expiring soon section
      expect(html).toContain("Expiring soon");
      expect(html).toContain("Documents with upcoming or expired dates.");
      expect(html).toContain("Rome Lorente");
      expect(html).toContain("Joseph Lims");
      expect(html).toContain("ABC 1454");
      expect(html).toContain("Insurance");
      expect(html).toContain("Driver License");

      // +4 more button (7 urgent docs minus 3 shown)
      expect(html).toContain("+4 more");
    });

    it("renders all-valid state when no urgent documents exist", () => {
      const documents = {
        totals: {
          total: 10,
          expired: 0,
          expiring30: 0,
          expiring90: 0,
        },
        items: [
          { vehicle: "Vehicle A", document_type: "Registration", days_left: 100 },
        ],
      };

      const html = renderToStaticMarkup(
        React.createElement(DocumentComplianceCard, { documents })
      );

      expect(html).toContain("100%");
      expect(html).toContain("documents valid");
      expect(html).toContain("10 of 10 documents");
      expect(html).toContain("All tracked documents are currently valid.");
      expect(html).not.toContain("+");
    });

    it("renders loading and error states properly", () => {
      const loadingHtml = renderToStaticMarkup(
        React.createElement(DocumentComplianceCard, {
          query: { isLoading: true },
        })
      );
      expect(loadingHtml).toContain("animate-pulse");

      const errorHtml = renderToStaticMarkup(
        React.createElement(DocumentComplianceCard, {
          query: { isError: true, data: null },
          documents: { items: [], totals: {} },
        })
      );
      expect(errorHtml).toContain("Document compliance is unavailable.");
    });
  });

  describe("FulfillmentPerformanceCard rendering", () => {
    it("handles zero total requests with safe 100% defaults", () => {
      const html = renderToStaticMarkup(
        React.createElement(FulfillmentPerformanceCard, {
          completed: 0,
          cancelled: 0,
          totalRequests: 0,
        })
      );
      expect(html).toContain("Fulfillment &amp; SLA");
      expect(html).toContain("Service reliability");
      expect(html).toContain("Optimal fulfillment");
      expect(html).toContain("100%");
    });

    it("calculates fulfillment rate and on-time rate when completed and cancelled are present", () => {
      const html = renderToStaticMarkup(
        React.createElement(FulfillmentPerformanceCard, {
          completed: 50,
          cancelled: 10,
          totalRequests: 100,
        })
      );
      // 50 / (50 + 10) = 83%
      expect(html).toContain("83%");
      expect(html).toContain("Fulfillment");
      expect(html).toContain("On-Time");
    });
  });

  describe("FleetReadinessCard rendering", () => {
    it("calculates vehicle and driver readiness percentages and status chips correctly", () => {
      const vehicles = [
        { vehicle_id: "v1", vehicle_status: "Available" },
        { vehicle_id: "v2", vehicle_status: "Available" },
        { vehicle_id: "v3", vehicle_status: "In Use" },
        { vehicle_id: "v4", vehicle_status: "Under Maintenance" },
      ];
      const drivers = [
        { driver_id: "d1", status: "available" },
        { driver_id: "d2", status: "on_trip" },
        { driver_id: "d3", status: "on_leave" },
        { driver_id: "d4", status: "off_duty" },
      ];

      const html = renderToStaticMarkup(
        React.createElement(FleetReadinessCard, { vehicles, drivers })
      );

      // Header
      expect(html).toContain("Fleet asset readiness");
      expect(html).toContain("Live vehicle availability and driver workforce deployment.");
      expect(html).toContain("Manage fleet assets");
      expect(html).toContain('href="/fleet"');

      // Vehicle section (3 operational out of 4 = 75%)
      expect(html).toContain("Vehicle Fleet");
      expect(html).toContain("75%");
      expect(html).toContain("operational (3/4)");
      expect(html).toContain("Available");
      expect(html).toContain("On Trip");
      expect(html).toContain("In Shop");
      expect(html).toContain("Other");

      // Driver section (2 active out of 4 = 50%)
      expect(html).toContain("Driver Workforce");
      expect(html).toContain("50%");
      expect(html).toContain("deployed (2/4)");
      expect(html).toContain("Standby");
      expect(html).toContain("On Leave");
      expect(html).toContain("Off Duty");

      // Footer
      expect(html).toContain("Active fleet capacity ready for dispatch");
      expect(html).toContain("View roster →");
    });

    it("renders loading and error states properly", () => {
      const loadingHtml = renderToStaticMarkup(
        React.createElement(FleetReadinessCard, {
          query: { isLoading: true },
        })
      );
      expect(loadingHtml).toContain("animate-pulse");

      const errorHtml = renderToStaticMarkup(
        React.createElement(FleetReadinessCard, {
          query: { isError: true, data: null },
          vehicles: [],
          drivers: [],
        })
      );
      expect(errorHtml).toContain("Fleet asset readiness is unavailable.");
    });
  });

  describe("MaintenancePressureCard rendering", () => {
    it("renders active maintenance work items with plate, type, and status", () => {
      const maintenance = [
        {
          maintenance_id: "m1",
          vehicles: { plate_number: "ABC 1234" },
          maintenance_type: "Oil Change",
          status: "In Progress",
          description: "Routine 10k km engine oil replacement",
          maintenance_date: "2026-09-28T08:00:00Z",
        },
        {
          maintenance_id: "m2",
          vehicles: { plate_number: "XYZ 5678" },
          maintenance_type: "Brake Pad Inspection",
          status: "Scheduled",
          description: "Front brake pads worn down",
          maintenance_date: "2026-09-29T10:00:00Z",
        },
      ];

      const html = renderToStaticMarkup(
        React.createElement(MaintenancePressureCard, { maintenance })
      );

      expect(html).toContain("Maintenance pressure");
      expect(html).toContain("Active work orders and service schedule.");
      expect(html).toContain("Open maintenance");
      expect(html).toContain("ABC 1234");
      expect(html).toContain("Oil Change");
      expect(html).toContain("In Progress");
      expect(html).toContain("XYZ 5678");
      expect(html).toContain("Brake Pad Inspection");
      expect(html).toContain("Scheduled");
    });

    it("renders clean empty state when no active maintenance work orders exist", () => {
      const html = renderToStaticMarkup(
        React.createElement(MaintenancePressureCard, { maintenance: [] })
      );

      expect(html).toContain("No active maintenance work");
      expect(html).toContain("All vehicles are currently operating within service intervals.");
    });

    it("renders loading and error states properly", () => {
      const loadingHtml = renderToStaticMarkup(
        React.createElement(MaintenancePressureCard, {
          query: { isLoading: true },
        })
      );
      expect(loadingHtml).toContain("animate-pulse");

      const errorHtml = renderToStaticMarkup(
        React.createElement(MaintenancePressureCard, {
          query: { isError: true, data: null },
          maintenance: [],
        })
      );
      expect(errorHtml).toContain("Maintenance attention is unavailable.");
    });
  });

  describe("IncidentRiskCard rendering", () => {
    it("renders 4 metric tiles and calm all-clear panel when open incidents is 0", () => {
      const incidents = {
        open: 0,
        critical_major_open: 0,
        assistance_open: 0,
        maintenance_pending: 0,
      };

      const html = renderToStaticMarkup(
        React.createElement(IncidentRiskCard, { incidents })
      );

      expect(html).toContain("Incident risk &amp; safety");
      expect(html).toContain("Current safety incidents and attention queue.");
      expect(html).toContain("Incident center");
      expect(html).toContain("Open");
      expect(html).toContain("Critical / major");
      expect(html).toContain("Assistance");
      expect(html).toContain("Maint pending");
      expect(html).toContain("No active incident risks");
      expect(html).toContain("All clear — there are no open incidents requiring attention right now.");
    });

    it("renders active alert panel when open incidents exist", () => {
      const incidents = {
        open: 3,
        critical_major_open: 1,
        assistance_open: 1,
        maintenance_pending: 1,
      };

      const html = renderToStaticMarkup(
        React.createElement(IncidentRiskCard, { incidents })
      );

      expect(html).toContain("3 active incident risks");
      expect(html).toContain("Review open and critical items in the incident center.");
      expect(html).toContain("Open incident center");
    });

    it("renders loading and error states properly", () => {
      const loadingHtml = renderToStaticMarkup(
        React.createElement(IncidentRiskCard, {
          query: { isLoading: true },
        })
      );
      expect(loadingHtml).toContain("animate-pulse");

      const errorHtml = renderToStaticMarkup(
        React.createElement(IncidentRiskCard, {
          query: { isError: true, data: null },
          incidents: {},
        })
      );
      expect(errorHtml).toContain("Incident risk is unavailable.");
    });
  });

  describe("getRecentDispatchActivities", () => {
    it("handles empty dispatches and requests safely", () => {
      const activities = getRecentDispatchActivities({}, []);
      expect(activities).toEqual([]);
    });

    it("extracts and formats dispatch items from different status buckets", () => {
      const dispatches = {
        inProgress: [
          {
            dispatch_id: 101,
            status: "In Progress",
            drivers: { first_name: "Juan", last_name: "Dela Cruz" },
            vehicles: { plate_number: "ABC 1234" },
            transportation_requests: { pickup_location: "Terminal 1", dropoff_location: "BGC" },
            scheduled_departure: "2026-09-28T09:00:00Z",
          },
        ],
        completed: [
          {
            dispatch_id: 102,
            status: "Completed",
            drivers: { first_name: "Maria", last_name: "Santos" },
            vehicles: { plate_number: "XYZ 5678" },
            transportation_requests: { dropoff_location: "Makati Med" },
            updated_at: "2026-09-28T08:30:00Z",
          },
        ],
        pendingReassignment: [
          {
            dispatch_id: 103,
            status: "Pending Reassignment",
            vehicles: { plate_number: "DEF 9999" },
            transportation_requests: { guest_name: "Executive VIP" },
            updated_at: "2026-09-28T09:15:00Z",
          },
        ],
      };

      const activities = getRecentDispatchActivities(dispatches, []);
      expect(activities.length).toBe(3);
      // Sorted by timestamp descending (103 at 09:15, 101 at 09:00, 102 at 08:30)
      expect(activities[0].title).toBe("Executive VIP · DEF 9999");
      expect(activities[0].action).toBe("Needs reassignment");
      expect(activities[0].status).toBe("Attention");

      expect(activities[1].title).toBe("Juan Dela Cruz · ABC 1234");
      expect(activities[1].action).toBe("Trip in motion");
      expect(activities[1].detail).toBe("Terminal 1 → BGC");
      expect(activities[1].status).toBe("On trip");

      expect(activities[2].title).toBe("Maria Santos · XYZ 5678");
      expect(activities[2].action).toBe("Arrived at destination");
      expect(activities[2].detail).toBe("Makati Med");
      expect(activities[2].status).toBe("Completed");
    });

    it("falls back to requests when dispatches object has no entries", () => {
      const requests = [
        {
          request_id: 42,
          fleet_status: "Assigned",
          guest_name: "Dr. Gomez",
          pickup_location: "Hotel",
          dropoff_location: "Office",
          updated_at: "2026-09-28T10:00:00Z",
        },
      ];

      const activities = getRecentDispatchActivities({}, requests);
      expect(activities.length).toBe(1);
      expect(activities[0].title).toBe("Dr. Gomez");
      expect(activities[0].action).toBe("Vehicle & driver assigned");
      expect(activities[0].status).toBe("Assigned");
    });
  });

  describe("RecentDispatcherActivity rendering", () => {
    it("renders activity stream items with title, detail, relative time, and status badge", () => {
      const activities = [
        {
          id: "act-1",
          action: "Trip in motion",
          title: "Juan Dela Cruz · ABC 1234",
          detail: "Terminal 1 → BGC",
          timestamp: new Date().toISOString(),
          status: "On trip",
          tone: "primary",
          href: "/dispatch/101",
        },
      ];

      const html = renderToStaticMarkup(
        React.createElement(RecentDispatcherActivity, { activities })
      );

      expect(html).toContain("Dispatcher Activity");
      expect(html).toContain("Live dispatch stream");
      expect(html).toContain("Trip in motion");
      expect(html).toContain("Juan Dela Cruz · ABC 1234");
      expect(html).toContain("Terminal 1 → BGC");
      expect(html).toContain("On trip");
      expect(html).toContain("Just now");
      expect(html).toContain("View all trips");
    });

    it("renders clean empty state when activities is empty", () => {
      const html = renderToStaticMarkup(
        React.createElement(RecentDispatcherActivity, { activities: [] })
      );

      expect(html).toContain("No recent dispatch activity");
      expect(html).toContain("Dispatched trips and vehicle assignments will appear here.");
    });
  });
});


